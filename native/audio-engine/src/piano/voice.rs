//! Sample voice: plays one `Sample` resampled with 4-point cubic (Hermite)
//! interpolation, with a damper fade on key up. Never allocates.

use crate::piano::bank::SampleBank;

/// Damper fade after key up, milliseconds.
pub const DAMPER_MS: u32 = 120;
/// Fade for a voice that is being stolen.
pub const STEAL_MS: u32 = 2;
/// Fade for a voice whose own note is pressed again.
pub const RETRIGGER_MS: u32 = 5;
/// Keys above this MIDI note (E6 = 88) have no dampers on a grand piano.
pub const LAST_DAMPED_NOTE: u8 = 88;

/// What a voice plays.
#[derive(Clone, Copy, Debug)]
pub struct Start {
    /// Index into the bank's samples.
    pub sample: u32,
    pub gain: f32,
    /// Source frames per output frame (`2^(semitones/12) * sampleRate / outputRate`).
    pub step: f64,
}

/// True for keys that have a damper (they stop when the key comes up).
pub fn has_damper(note: u8) -> bool {
    note <= LAST_DAMPED_NOTE
}

#[derive(Clone, Copy)]
pub struct PianoVoice {
    damper_step: f32,
    steal_step: f32,
    retrigger_step: f32,
    active: bool,
    fading: bool,
    sample: u32,
    pos: f64,
    step: f64,
    gain: f32,
    env: f32,
    fade_step: f32,
    note: u8,
    pending: Option<(u8, Start)>,
    key_down: bool,
    sustained: bool,
    deferred: bool,
    serial: u64,
}

impl PianoVoice {
    pub fn new(sample_rate: u32) -> Self {
        let sr = u64::from(sample_rate.max(1));
        let step = |ms: u32| 1.0 / ((sr * u64::from(ms) / 1000).max(1) as f32);
        Self {
            damper_step: step(DAMPER_MS),
            steal_step: step(STEAL_MS),
            retrigger_step: step(RETRIGGER_MS),
            active: false,
            fading: false,
            sample: 0,
            pos: 0.0,
            step: 1.0,
            gain: 0.0,
            env: 0.0,
            fade_step: 0.0,
            note: 0,
            pending: None,
            key_down: false,
            sustained: false,
            deferred: false,
            serial: 0,
        }
    }

    fn begin(&mut self, note: u8, start: Start) {
        self.note = note;
        self.sample = start.sample;
        self.gain = start.gain;
        self.step = start.step;
        self.pos = 0.0;
        self.env = 1.0;
        self.fading = false;
        self.active = true;
        self.pending = None;
    }

    /// Fade out at `step` per frame; an already faster fade is kept.
    fn begin_fade(&mut self, step: f32) {
        self.fade_step = if self.fading { self.fade_step.max(step) } else { step };
        self.fading = true;
    }

    /// Start a note. On a voice that still sounds, the old sound fades out in
    /// about 2 ms first and the new note starts after it (no click).
    pub fn steal(&mut self, note: u8, start: Start, serial: u64) {
        self.key_down = true;
        self.sustained = false;
        self.deferred = false;
        self.serial = serial;
        if !self.active {
            self.begin(note, start);
            return;
        }
        self.pending = Some((note, start));
        self.begin_fade(self.steal_step);
    }

    /// The note this voice answers to: the waiting note while a steal fade runs.
    pub fn note(&self) -> u8 {
        self.pending.map_or(self.note, |(n, _)| n)
    }

    pub fn is_key_down(&self) -> bool {
        self.key_down
    }

    pub fn serial(&self) -> u64 {
        self.serial
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    /// The key came up. With the pedal down a damped note keeps sounding;
    /// a key without dampers always rings on.
    pub fn key_up(&mut self, pedal_down: bool) {
        self.key_down = false;
        if !has_damper(self.note()) {
            return;
        }
        if pedal_down {
            self.sustained = true;
        } else {
            self.release();
        }
    }

    /// Pedal lifted: let go of a note the pedal was holding.
    pub fn pedal_up(&mut self) {
        if self.sustained {
            self.release();
        }
    }

    /// Damper down: fade out in 120 ms (after a steal fade, if one runs).
    pub fn release(&mut self) {
        self.key_down = false;
        self.sustained = false;
        if !self.active || !has_damper(self.note()) {
            return;
        }
        if self.pending.is_some() {
            self.deferred = true;
            return;
        }
        self.begin_fade(self.damper_step);
    }

    /// Fade out whatever the key or pedal says (stop-all, all-notes-off).
    pub fn stop(&mut self) {
        self.key_down = false;
        self.sustained = false;
        self.deferred = false;
        if !self.active {
            return;
        }
        if self.pending.take().is_some() {
            return; // the fast steal fade carries on and ends in silence
        }
        self.begin_fade(self.damper_step);
    }

    /// The same note was pressed again: fade this voice in about 5 ms and stop
    /// answering to note events. Works on voices that are already in release.
    pub fn retrigger_fade(&mut self) {
        self.key_down = false;
        self.sustained = false;
        self.deferred = false;
        if !self.active {
            return;
        }
        self.pending = None;
        self.begin_fade(self.retrigger_step);
    }

    /// Silence at once (used when the bank is swapped).
    pub fn kill(&mut self) {
        self.active = false;
        self.fading = false;
        self.env = 0.0;
        self.pending = None;
        self.key_down = false;
        self.sustained = false;
        self.deferred = false;
    }

    /// The sound is over (sample end or fade end): start the waiting note or go idle.
    fn finish(&mut self) {
        match self.pending.take() {
            Some((note, start)) => {
                self.begin(note, start);
                if self.deferred {
                    self.deferred = false;
                    self.begin_fade(self.damper_step);
                }
            }
            None => self.kill(),
        }
    }

    /// Next stereo frame.
    pub fn next_frame(&mut self, bank: &SampleBank) -> (f32, f32) {
        if !self.active {
            return (0.0, 0.0);
        }
        let Some(sample) = bank.samples().get(self.sample as usize) else {
            self.kill();
            return (0.0, 0.0);
        };
        let data = sample.data();
        let frames = data.len() / 2;
        let g = self.env * self.gain;
        let i = self.pos as usize;
        let (l, r) = if i < frames { hermite(data, frames, i, (self.pos - i as f64) as f32) } else { (0.0, 0.0) };
        self.pos += self.step;
        if self.pos >= frames as f64 {
            self.finish();
        } else if self.fading {
            self.env -= self.fade_step;
            if self.env <= 0.0 {
                self.finish();
            }
        }
        (l * g, r * g)
    }
}

/// 4-point cubic (Catmull-Rom / Hermite) at `i + t` for both channels, scaled to +-1.
fn hermite(data: &[i16], frames: usize, i: usize, t: f32) -> (f32, f32) {
    let last = frames - 1;
    let idx = [i.saturating_sub(1), i, (i + 1).min(last), (i + 2).min(last)];
    let at = |ch: usize, k: usize| f32::from(data[idx[k] * 2 + ch]) * (1.0 / 32768.0);
    let one = |ch: usize| {
        let (y0, y1, y2, y3) = (at(ch, 0), at(ch, 1), at(ch, 2), at(ch, 3));
        let c1 = 0.5 * (y2 - y0);
        let c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
        let c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
        ((c3 * t + c2) * t + c1) * t + y1
    };
    (one(0), one(1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::piano::bank::Sample;
    use crate::piano::testing::sine_sample;

    fn ramp_bank() -> SampleBank {
        // Left channel counts up by 1000 per frame, right is its negative.
        let mut d = Vec::new();
        for i in 0..20i16 {
            d.push(i * 1000);
            d.push(-i * 1000);
        }
        SampleBank::from_samples(vec![Sample::new(60, 0, 48_000, 2, d)])
    }

    fn start(step: f64) -> Start {
        Start { sample: 0, gain: 1.0, step }
    }

    fn voice() -> PianoVoice {
        PianoVoice::new(48_000)
    }

    #[test]
    fn whole_steps_return_the_stored_frames_exactly() {
        let bank = ramp_bank();
        let mut v = voice();
        v.steal(60, start(1.0), 0);
        for i in 0..10 {
            let (l, r) = v.next_frame(&bank);
            assert!((l - i as f32 * 1000.0 / 32768.0).abs() < 1e-6, "frame {i} l {l}");
            assert!((r + i as f32 * 1000.0 / 32768.0).abs() < 1e-6);
        }
    }

    #[test]
    fn half_steps_on_a_straight_line_give_the_midpoints() {
        let bank = ramp_bank();
        let mut v = voice();
        v.steal(60, start(0.5), 0);
        v.next_frame(&bank); // the first two frames lean on the clamped edge
        v.next_frame(&bank);
        v.next_frame(&bank);
        v.next_frame(&bank);
        for i in 4..16 {
            let (l, _) = v.next_frame(&bank);
            let want = i as f32 * 0.5 * 1000.0 / 32768.0;
            assert!((l - want).abs() < 1e-5, "step {i} {l} vs {want}");
        }
    }

    #[test]
    fn the_voice_ends_with_the_sample_and_goes_idle() {
        let bank = ramp_bank();
        let mut v = voice();
        v.steal(60, start(1.0), 0);
        assert!(v.is_active());
        for _ in 0..25 {
            v.next_frame(&bank);
        }
        assert!(!v.is_active());
        assert_eq!(v.next_frame(&bank), (0.0, 0.0));
    }

    fn long_bank() -> SampleBank {
        SampleBank::from_samples(vec![
            sine_sample(60, 0, 261.6, 0.5, 3.0),
            sine_sample(96, 0, 2093.0, 0.5, 3.0),
        ])
    }

    fn run(v: &mut PianoVoice, bank: &SampleBank, frames: usize) -> Vec<f32> {
        (0..frames).map(|_| v.next_frame(bank).0).collect()
    }

    #[test]
    fn a_damped_key_fades_out_within_150_ms_after_key_up() {
        let bank = long_bank();
        let mut v = voice();
        v.steal(60, Start { sample: 0, gain: 1.0, step: 1.0 }, 0);
        run(&mut v, &bank, 2000);
        v.key_up(false);
        let s = run(&mut v, &bank, 48_000 * 150 / 1000);
        assert!(!v.is_active(), "gone after 150 ms");
        assert!(s[..2400].iter().any(|x| x.abs() > 0.05), "still audible in the first 50 ms");
    }

    #[test]
    fn keys_above_e6_ring_on_after_key_up() {
        let bank = long_bank();
        let mut v = voice();
        v.steal(96, Start { sample: 1, gain: 1.0, step: 1.0 }, 0);
        run(&mut v, &bank, 2000);
        v.key_up(false);
        let s = run(&mut v, &bank, 48_000 * 500 / 1000);
        assert!(v.is_active());
        assert!(s[s.len() - 480..].iter().any(|x| x.abs() > 0.1));
        assert!(!v.is_key_down());
    }

    #[test]
    fn the_last_damped_key_is_e6() {
        assert!(has_damper(88));
        assert!(!has_damper(89));
    }
}
