use crate::core::command::Command;
use crate::core::tone::ToneVoice;
use crate::core::voice::{note_gain, NoteVoice};
use crate::piano::voice::Start;
use crate::piano::{layer_for_velocity, soft_limit, PianoVoice, SampleBank};
use std::sync::Arc;

/// Number of tone voices, fixed at construction.
pub const VOICES: usize = 8;
/// Number of piano note voices, fixed at construction.
pub const NOTE_VOICES: usize = 64;

/// Gain of the whole piano mix before the limiter (headroom for chords).
const PIANO_MASTER: f32 = 0.5;

/// What the note-voice arrays have in common, so voice choice and key events
/// are written once for the stand-in voice and the piano voice.
trait Slot {
    fn is_active(&self) -> bool;
    fn is_key_down(&self) -> bool;
    fn note(&self) -> u8;
    fn serial(&self) -> u64;
    fn key_up(&mut self, pedal_down: bool);
    fn retrigger_fade(&mut self);
}

macro_rules! slot {
    ($t:ty) => {
        impl Slot for $t {
            fn is_active(&self) -> bool {
                <$t>::is_active(self)
            }
            fn is_key_down(&self) -> bool {
                <$t>::is_key_down(self)
            }
            fn note(&self) -> u8 {
                <$t>::note(self)
            }
            fn serial(&self) -> u64 {
                <$t>::serial(self)
            }
            fn key_up(&mut self, pedal_down: bool) {
                <$t>::key_up(self, pedal_down)
            }
            fn retrigger_fade(&mut self) {
                <$t>::retrigger_fade(self)
            }
        }
    };
}
slot!(NoteVoice);
slot!(PianoVoice);

/// A free voice, else the oldest one whose key is up, else the oldest.
fn voice_to_use<V: Slot>(voices: &[V]) -> usize {
    let mut oldest_up: Option<usize> = None;
    let mut oldest = 0;
    for (i, v) in voices.iter().enumerate() {
        if !v.is_active() {
            return i;
        }
        if !v.is_key_down() && oldest_up.is_none_or(|j| v.serial() < voices[j].serial()) {
            oldest_up = Some(i);
        }
        if v.serial() < voices[oldest].serial() {
            oldest = i;
        }
    }
    oldest_up.unwrap_or(oldest)
}

/// The same note again: every older voice of it, also one already in
/// release, fades out in about 5 ms.
fn retrigger<V: Slot>(voices: &mut [V], note: u8) {
    for v in voices.iter_mut().filter(|v| v.is_active() && v.note() == note) {
        v.retrigger_fade();
    }
}

fn key_off<V: Slot>(voices: &mut [V], note: u8, pedal: bool) {
    for v in voices.iter_mut().filter(|v| v.is_key_down() && v.note() == note) {
        v.key_up(pedal);
    }
}

/// Mixes the tone voices into interleaved output. Never allocates after `new`.
pub struct Mixer {
    voices: [ToneVoice; VOICES],
    notes: [NoteVoice; NOTE_VOICES],
    /// Sampled piano voices, used instead of `notes` while a bank is set.
    piano: [PianoVoice; NOTE_VOICES],
    bank: Option<Arc<SampleBank>>,
    output_rate: f64,
    pedal_down: bool,
    /// Counts note starts so the oldest voice can be found.
    next_serial: u64,
    channels: usize,
    nyquist_hz: f32,
    /// Master volume as heard now, moving towards `master_target`.
    master: f32,
    master_target: f32,
    master_step: f32,
}

/// Master volume ramp time in milliseconds.
const VOLUME_RAMP_MS: u64 = 10;

impl Mixer {
    pub fn new(sample_rate: u32, channels: u16) -> Self {
        Self {
            voices: [ToneVoice::new(sample_rate); VOICES],
            notes: [NoteVoice::new(sample_rate); NOTE_VOICES],
            piano: [PianoVoice::new(sample_rate); NOTE_VOICES],
            bank: None,
            output_rate: f64::from(sample_rate.max(1)),
            pedal_down: false,
            next_serial: 0,
            channels: usize::from(channels.max(1)),
            nyquist_hz: sample_rate as f32 / 2.0,
            master: 1.0,
            master_target: 1.0,
            master_step: 1.0 / ((u64::from(sample_rate.max(1)) * VOLUME_RAMP_MS / 1000).max(1) as f32),
        }
    }

    pub fn handle(&mut self, cmd: Command) {
        match cmd {
            Command::PlayTestTone { frequency_hz, seconds, gain } => {
                if !(frequency_hz.is_finite() && frequency_hz > 0.0 && frequency_hz < self.nyquist_hz && gain.is_finite()) {
                    return;
                }
                let seconds = if seconds.is_finite() { seconds } else { 0.0 };
                let i = self.free_or_quietest_voice();
                self.voices[i].steal(frequency_hz, seconds, gain.clamp(0.0, 1.0));
            }
            Command::StopAll => {
                self.voices.iter_mut().for_each(ToneVoice::release);
                self.notes.iter_mut().for_each(NoteVoice::stop);
                self.piano.iter_mut().for_each(PianoVoice::stop);
            }
            Command::NoteOn { note, velocity, .. } => self.note_on(note, velocity),
            Command::NoteOff { note } => self.note_off(note),
            Command::Sustain(down) => {
                self.pedal_down = down;
                if !down {
                    self.notes.iter_mut().for_each(NoteVoice::pedal_up);
                    self.piano.iter_mut().for_each(PianoVoice::pedal_up);
                }
            }
            Command::AllNotesOff => {
                self.notes.iter_mut().for_each(NoteVoice::stop);
                self.piano.iter_mut().for_each(PianoVoice::stop);
            }
            Command::SetMasterVolume(v) => {
                if v.is_finite() {
                    self.master_target = v.clamp(0.0, 1.0);
                }
            }
        }
    }

    /// Use the sampled piano (or go back to the stand-in voice with `None`).
    /// Returns the bank it replaces; the caller must not drop it on the audio
    /// thread. Stand-in notes fade out; piano voices point into the old bank,
    /// so they are silenced at once.
    pub fn set_bank(&mut self, bank: Option<Arc<SampleBank>>) -> Option<Arc<SampleBank>> {
        self.notes.iter_mut().for_each(NoteVoice::stop);
        self.piano.iter_mut().for_each(PianoVoice::kill);
        std::mem::replace(&mut self.bank, bank)
    }

    pub fn active_voices(&self) -> usize {
        self.voices.iter().filter(|v| v.is_active()).count()
    }

    /// Piano note voices that are sounding (including ones fading out).
    pub fn active_note_voices(&self) -> usize {
        self.notes.iter().filter(|v| v.is_active()).count() + self.piano.iter().filter(|v| v.is_active()).count()
    }

    fn note_on(&mut self, note: u8, velocity: u8) {
        if velocity == 0 {
            return self.note_off(note);
        }
        if note > 127 {
            return;
        }
        if self.bank.is_some() {
            return self.piano_note_on(note, velocity);
        }
        if NoteVoice::frequency(note) >= self.nyquist_hz {
            return;
        }
        // The same note again: older voices of it fade out quickly, a new one starts.
        retrigger(&mut self.notes, note);
        let serial = self.next_serial;
        self.next_serial += 1;
        let i = voice_to_use(&self.notes);
        self.notes[i].steal(note, note_gain(velocity), serial);
    }

    fn piano_note_on(&mut self, note: u8, velocity: u8) {
        let start = self.bank.as_deref().and_then(|bank| {
            let choice = bank.choose(layer_for_velocity(velocity), note)?;
            let sample = bank.samples().get(choice.sample)?;
            let step = 2f64.powf(f64::from(choice.semitones) / 12.0) * f64::from(sample.sample_rate) / self.output_rate;
            Some(Start { sample: choice.sample as u32, gain: bank.gain(choice.sample, velocity), step })
        });
        let Some(start) = start else {
            return;
        };
        retrigger(&mut self.piano, note);
        let serial = self.next_serial;
        self.next_serial += 1;
        let i = voice_to_use(&self.piano);
        self.piano[i].steal(note, start, serial);
    }

    fn note_off(&mut self, note: u8) {
        key_off(&mut self.notes, note, self.pedal_down);
        key_off(&mut self.piano, note, self.pedal_down);
    }

    /// Fill `out` with interleaved frames. A trailing partial frame is zeroed.
    /// Stereo output carries left and right; mono gets their mean; any
    /// further channels get the mean too.
    pub fn render(&mut self, out: &mut [f32]) {
        let mut frames = out.chunks_exact_mut(self.channels);
        for frame in &mut frames {
            let mut mono = 0.0f32;
            for v in &mut self.voices {
                mono += v.next_sample();
            }
            for v in &mut self.notes {
                mono += v.next_sample();
            }
            let (mut left, mut right) = (0.0f32, 0.0f32);
            if let Some(bank) = self.bank.as_deref() {
                for v in &mut self.piano {
                    let (l, r) = v.next_frame(bank);
                    left += l;
                    right += r;
                }
                left = soft_limit(left * PIANO_MASTER);
                right = soft_limit(right * PIANO_MASTER);
            }
            if self.master < self.master_target {
                self.master = (self.master + self.master_step).min(self.master_target);
            } else if self.master > self.master_target {
                self.master = (self.master - self.master_step).max(self.master_target);
            }
            let l = ((mono + left) * self.master).clamp(-1.0, 1.0);
            let r = ((mono + right) * self.master).clamp(-1.0, 1.0);
            if let [only] = frame {
                *only = ((l + r) * 0.5).clamp(-1.0, 1.0);
            } else {
                let mid = ((l + r) * 0.5).clamp(-1.0, 1.0);
                frame.fill(mid);
                frame[0] = l;
                frame[1] = r;
            }
        }
        frames.into_remainder().fill(0.0);
    }

    fn free_or_quietest_voice(&self) -> usize {
        let mut best = 0;
        let mut best_env = f32::MAX;
        for (i, v) in self.voices.iter().enumerate() {
            if !v.is_active() {
                return i;
            }
            if v.envelope() < best_env {
                best_env = v.envelope();
                best = i;
            }
        }
        best
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::command::Command;

    const SR: u32 = 48_000;

    fn tone(f: f32, secs: f32, gain: f32) -> Command {
        Command::PlayTestTone { frequency_hz: f, seconds: secs, gain }
    }

    fn render(m: &mut Mixer, frames: usize) -> Vec<f32> {
        let mut out = vec![0.0f32; frames];
        m.render(&mut out);
        out
    }

    fn peak(s: &[f32]) -> f32 {
        s.iter().fold(0.0f32, |a, b| a.max(b.abs()))
    }

    #[test]
    fn silence_when_no_voice() {
        let mut m = Mixer::new(SR, 1);
        assert!(render(&mut m, 512).iter().all(|s| *s == 0.0));
    }

    #[test]
    fn tone_440hz_has_880_zero_crossings_per_second_and_peak_equals_gain() {
        let mut m = Mixer::new(SR, 1);
        m.handle(tone(440.0, 3.0, 0.25));
        render(&mut m, 480); // skip attack
        let s = render(&mut m, SR as usize);
        let crossings = s.windows(2).filter(|w| (w[0] < 0.0) != (w[1] < 0.0)).count();
        assert!((crossings as i32 - 880).abs() <= 2, "crossings {crossings}");
        assert!((peak(&s) - 0.25).abs() < 0.01, "peak {}", peak(&s));
    }

    #[test]
    fn first_sample_is_zero() {
        let mut m = Mixer::new(SR, 1);
        m.handle(tone(440.0, 1.0, 0.5));
        assert_eq!(render(&mut m, 8)[0], 0.0);
    }

    #[test]
    fn tone_ends_within_20ms_after_its_length_then_silence() {
        let mut m = Mixer::new(SR, 1);
        m.handle(tone(440.0, 0.1, 0.5));
        let len = 4800usize;
        let release = 960usize;
        let s = render(&mut m, len + release + 480);
        assert!(s[..len].iter().any(|x| x.abs() > 0.1));
        assert!(s[len + release + 2..].iter().all(|x| *x == 0.0));
        assert_eq!(m.active_voices(), 0);
    }

    #[test]
    fn stop_all_fades_out_within_20ms_without_a_jump() {
        let mut m = Mixer::new(SR, 1);
        m.handle(tone(440.0, 5.0, 0.25));
        let before = render(&mut m, 2000);
        m.handle(Command::StopAll);
        let after = render(&mut m, 960 + 480);
        let mut all = vec![*before.last().unwrap()];
        all.extend_from_slice(&after);
        let max_jump = all.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0f32, f32::max);
        assert!(max_jump < 0.05, "jump {max_jump}");
        assert!(after[960 + 2..].iter().all(|x| *x == 0.0));
        assert_eq!(m.active_voices(), 0);
    }

    #[test]
    fn stereo_channels_carry_the_same_sample() {
        let mut m = Mixer::new(SR, 2);
        m.handle(tone(440.0, 1.0, 0.5));
        let mut out = vec![0.0f32; 2 * 1000];
        m.render(&mut out);
        assert!(out.iter().any(|x| x.abs() > 0.1));
        assert!(out.chunks_exact(2).all(|f| f[0] == f[1]));
    }

    #[test]
    fn master_volume_half_halves_the_peak() {
        let mut full = Mixer::new(SR, 1);
        let mut half = Mixer::new(SR, 1);
        full.handle(tone(440.0, 1.0, 0.8));
        half.handle(tone(440.0, 1.0, 0.8));
        half.handle(Command::SetMasterVolume(0.5));
        let pf = peak(&render(&mut full, 4800));
        let ph = peak(&render(&mut half, 4800));
        assert!((ph - pf * 0.5).abs() < 0.01, "full {pf} half {ph}");
    }

    #[test]
    fn output_is_clamped_to_plus_minus_one() {
        let mut m = Mixer::new(SR, 1);
        for _ in 0..4 {
            m.handle(tone(440.0, 1.0, 1.0));
        }
        let s = render(&mut m, 4800);
        assert!(s.iter().all(|x| (-1.0..=1.0).contains(x)));
        assert!(peak(&s) > 0.99, "four loud voices should reach the clamp");
    }

    #[test]
    fn more_than_eight_tones_do_not_panic_and_cap_at_eight_voices() {
        let mut m = Mixer::new(SR, 1);
        for i in 0..12 {
            m.handle(tone(200.0 + i as f32 * 10.0, 1.0, 0.1));
        }
        render(&mut m, 480);
        assert_eq!(m.active_voices(), 8);
    }

    #[test]
    fn invalid_tone_commands_are_ignored() {
        let mut m = Mixer::new(SR, 1);
        m.handle(tone(f32::NAN, 1.0, 0.5));
        m.handle(tone(0.0, 1.0, 0.5));
        m.handle(tone(-5.0, 1.0, 0.5));
        m.handle(tone(440.0, 1.0, f32::NAN));
        assert_eq!(m.active_voices(), 0);
    }

    #[test]
    fn partial_trailing_frame_is_zeroed() {
        let mut m = Mixer::new(SR, 2);
        let mut out = [9.0f32; 5];
        m.render(&mut out);
        assert!(out.iter().all(|x| *x == 0.0));
    }

    #[test]
    fn stolen_voice_fades_out_before_the_ninth_tone_starts() {
        let mut m = Mixer::new(SR, 1);
        // One audible voice (index 0) and seven silent ones fill all eight slots.
        m.handle(tone(440.0, 5.0, 0.25));
        for _ in 0..7 {
            m.handle(tone(300.0, 5.0, 0.0));
        }
        let before = render(&mut m, 507); // voice 0 is near a peak of its sine
        m.handle(tone(880.0, 5.0, 0.25)); // the ninth tone steals a voice
        let after = render(&mut m, 1000);
        let mut all = vec![*before.last().unwrap()];
        all.extend_from_slice(&after);
        let max_jump = all.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0f32, f32::max);
        assert!(max_jump < 0.05, "jump {max_jump}");
        assert_eq!(m.active_voices(), 8);
        assert!(peak(&after[500..]) > 0.2, "the new tone must be heard");
    }

    #[test]
    fn master_volume_ramps_over_about_10ms_instead_of_jumping() {
        let mut m = Mixer::new(SR, 1);
        m.handle(tone(440.0, 5.0, 0.25));
        let before = render(&mut m, 507);
        m.handle(Command::SetMasterVolume(0.0));
        let after = render(&mut m, 1000);
        let mut all = vec![*before.last().unwrap()];
        all.extend_from_slice(&after);
        let max_jump = all.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0f32, f32::max);
        assert!(max_jump < 0.05, "jump {max_jump}");
        assert!(after[480 + 2..].iter().all(|x| *x == 0.0), "reaches 0 within 10 ms");
        assert!(peak(&after[..240]) > 0.05, "still audible part way through the ramp");
    }

    #[test]
    fn frequencies_at_or_above_nyquist_are_ignored() {
        let mut m = Mixer::new(SR, 1);
        m.handle(tone(24_000.0, 1.0, 0.5));
        m.handle(tone(30_000.0, 1.0, 0.5));
        assert_eq!(m.active_voices(), 0);
        m.handle(tone(23_999.0, 1.0, 0.5));
        assert_eq!(m.active_voices(), 1);
    }

    // ---- note voices (stand-in piano) ----

    fn on(note: u8, velocity: u8) -> Command {
        Command::NoteOn { note, velocity, midi_us: 0 }
    }

    fn off(note: u8) -> Command {
        Command::NoteOff { note }
    }

    fn crossings(s: &[f32]) -> usize {
        s.windows(2).filter(|w| (w[0] < 0.0) != (w[1] < 0.0)).count()
    }

    fn max_jump(s: &[f32]) -> f32 {
        s.windows(2).map(|w| (w[1] - w[0]).abs()).fold(0.0f32, f32::max)
    }

    #[test]
    fn note_a4_sounds_at_440_hz() {
        let mut m = Mixer::new(SR, 1);
        m.handle(on(69, 100));
        render(&mut m, 480);
        let s = render(&mut m, SR as usize);
        assert!((crossings(&s) as i32 - 880).abs() <= 2, "crossings {}", crossings(&s));
    }

    #[test]
    fn note_c4_sounds_at_261_6_hz() {
        let mut m = Mixer::new(SR, 1);
        m.handle(on(60, 100));
        render(&mut m, 480);
        let s = render(&mut m, SR as usize);
        // 261.63 Hz gives 523.25 crossings in a second.
        assert!((crossings(&s) as i32 - 523).abs() <= 2, "crossings {}", crossings(&s));
    }

    #[test]
    fn first_note_sample_is_zero_and_full_velocity_peaks_near_0_2() {
        let mut m = Mixer::new(SR, 1);
        m.handle(on(69, 127));
        let s = render(&mut m, 480);
        assert_eq!(s[0], 0.0);
        let p = peak(&s);
        assert!(p > 0.19 && p <= 0.2001, "peak {p}");
    }

    #[test]
    fn harder_keys_are_louder_with_the_curve() {
        let mut soft = Mixer::new(SR, 1);
        let mut hard = Mixer::new(SR, 1);
        soft.handle(on(69, 30));
        hard.handle(on(69, 100));
        let ps = peak(&render(&mut soft, 480));
        let ph = peak(&render(&mut hard, 480));
        assert!(ph > ps * 2.0, "soft {ps} hard {ph}");
        let expected = crate::core::velocity::gain(30) * 0.2;
        assert!((ps - expected).abs() < 0.002, "soft {ps} expected {expected}");
    }

    #[test]
    fn note_off_fades_to_silence_within_100ms_without_a_jump() {
        let mut m = Mixer::new(SR, 1);
        m.handle(on(69, 100));
        let before = render(&mut m, 2000);
        m.handle(off(69));
        let after = render(&mut m, 4800);
        let mut all = vec![*before.last().unwrap()];
        all.extend_from_slice(&after);
        assert!(max_jump(&all) < 0.05, "jump {}", max_jump(&all));
        assert!(after[4800 - 480..].iter().all(|x| *x == 0.0));
        assert_eq!(m.active_note_voices(), 0);
    }

    #[test]
    fn held_note_decays_to_exact_silence_and_frees_its_voice() {
        let mut m = Mixer::new(SR, 1);
        m.handle(on(69, 127));
        let early = render(&mut m, SR as usize); // first second
        let late = render(&mut m, SR as usize * 3 + 24_000); // up to 4.5 s
        assert!(peak(&early) > 0.1);
        assert!(peak(&late[..4800]) < peak(&early[..4800]), "it must decay");
        assert!(late[late.len() - 480..].iter().all(|x| *x == 0.0));
        assert_eq!(m.active_note_voices(), 0, "voice freed when decayed");
    }

    #[test]
    fn decay_never_leaves_denormal_samples() {
        let mut m = Mixer::new(SR, 1);
        m.handle(on(69, 127));
        let s = render(&mut m, SR as usize * 6);
        assert!(s.iter().all(|x| *x == 0.0 || x.abs() >= f32::MIN_POSITIVE));
    }

    #[test]
    fn sustain_keeps_the_note_after_note_off_and_pedal_up_releases_it() {
        let mut m = Mixer::new(SR, 1);
        m.handle(Command::Sustain(true));
        m.handle(on(69, 100));
        render(&mut m, 2000);
        m.handle(off(69));
        let held = render(&mut m, SR as usize);
        assert!(peak(&held[held.len() - 4800..]) > 0.005, "must still sound");
        assert_eq!(m.active_note_voices(), 1);
        m.handle(Command::Sustain(false));
        let after = render(&mut m, 4800);
        assert!(peak(&after[..480]) > 0.0);
        assert!(after[4800 - 480..].iter().all(|x| *x == 0.0));
        assert_eq!(m.active_note_voices(), 0);
    }

    #[test]
    fn pedal_up_does_not_release_keys_that_are_still_down() {
        let mut m = Mixer::new(SR, 1);
        m.handle(Command::Sustain(true));
        m.handle(on(69, 100));
        m.handle(Command::Sustain(false));
        let s = render(&mut m, 9600);
        assert!(peak(&s[s.len() - 480..]) > 0.01);
        assert_eq!(m.active_note_voices(), 1);
    }

    #[test]
    fn note_pressed_with_pedal_down_then_released_waits_for_pedal() {
        let mut m = Mixer::new(SR, 1);
        m.handle(on(69, 100));
        m.handle(Command::Sustain(true));
        m.handle(off(69));
        render(&mut m, 9600);
        assert_eq!(m.active_note_voices(), 1, "pedal went down while key was held");
        m.handle(Command::Sustain(false));
        render(&mut m, 4800);
        assert_eq!(m.active_note_voices(), 0);
    }

    #[test]
    fn repeated_same_note_never_jumps() {
        let mut m = Mixer::new(SR, 1);
        let mut all = vec![0.0f32];
        for _ in 0..40 {
            m.handle(on(96, 64));
            all.extend(render(&mut m, 700));
        }
        assert!(max_jump(&all) < 0.05, "jump {}", max_jump(&all));
        assert!(peak(&all) > 0.02, "it must be audible");
        m.handle(off(96));
        let tail = render(&mut m, 6000); // rest of the 30 ms hold, then the 80 ms release
        assert!(tail[6000 - 480..].iter().all(|x| *x == 0.0), "note off ends the newest voice");
        render(&mut m, 4800);
        assert_eq!(m.active_note_voices(), 0);
    }

    #[test]
    fn retriggered_note_fades_the_old_voice_in_about_5ms_and_starts_a_new_one() {
        let mut m = Mixer::new(SR, 1);
        m.handle(on(69, 100));
        render(&mut m, 2000);
        m.handle(on(69, 100));
        assert_eq!(m.active_note_voices(), 2);
        render(&mut m, 240 + 4); // 5 ms = 240 frames
        assert_eq!(m.active_note_voices(), 1, "old voice gone after the fade");
    }

    #[test]
    fn sixty_five_notes_at_once_cap_at_64_voices_without_big_jumps() {
        let mut m = Mixer::new(SR, 1);
        for n in 36..=100u8 {
            m.handle(on(n, 50));
        }
        let s = render(&mut m, 4800);
        assert!(s.iter().all(|x| x.is_finite()));
        assert!(max_jump(&s) < 0.1, "jump {}", max_jump(&s));
        assert_eq!(m.active_note_voices(), 64);
    }

    #[test]
    fn sixty_five_loud_notes_stay_finite_inside_plus_minus_one() {
        // At velocity 110 the sum of 64 in-phase triangles is steep by nature
        // (about 0.3 per sample), so only the limits are checked here.
        let mut m = Mixer::new(SR, 1);
        for n in 36..=100u8 {
            m.handle(on(n, 110));
        }
        let s = render(&mut m, 4800);
        assert!(s.iter().all(|x| x.is_finite() && (-1.0..=1.0).contains(x)));
        assert_eq!(m.active_note_voices(), 64);
    }

    fn live_notes(m: &Mixer) -> Vec<u8> {
        let mut v: Vec<u8> = m.notes.iter().filter(|v| v.is_active()).map(|v| v.note()).collect();
        v.sort_unstable();
        v
    }

    #[test]
    fn stealing_prefers_the_oldest_released_voice() {
        let mut m = Mixer::new(SR, 1);
        for n in 0..64u8 {
            m.handle(on(n + 30, 40));
        }
        render(&mut m, 480);
        m.handle(off(30 + 10)); // a released voice, not the oldest
        m.handle(on(100, 40));
        render(&mut m, 480);
        let notes = live_notes(&m);
        assert_eq!(notes.len(), 64);
        assert!(!notes.contains(&40), "released note was stolen");
        assert!(notes.contains(&30), "oldest held note survived");
        assert!(notes.contains(&100));
    }

    #[test]
    fn with_nothing_released_the_oldest_voice_is_stolen() {
        let mut m = Mixer::new(SR, 1);
        for n in 0..64u8 {
            m.handle(on(n + 30, 40));
        }
        render(&mut m, 480);
        m.handle(on(100, 40));
        let s = render(&mut m, 480);
        let notes = live_notes(&m);
        assert!(!notes.contains(&30), "oldest was stolen");
        assert!(notes.contains(&31) && notes.contains(&100));
        assert_eq!(notes.len(), 64);
        assert!(max_jump(&s) < 0.1);
    }

    #[test]
    fn quick_tap_in_one_call_still_sounds() {
        let mut m = Mixer::new(SR, 1);
        m.handle(on(69, 100));
        m.handle(off(69));
        let s = render(&mut m, 4800);
        assert!(peak(&s) > 0.05, "peak {}", peak(&s));
        let more = render(&mut m, 9600);
        assert!(more[more.len() - 480..].iter().all(|x| *x == 0.0));
        assert_eq!(m.active_note_voices(), 0);
    }

    #[test]
    fn quick_tap_during_a_steal_still_sounds() {
        let mut m = Mixer::new(SR, 1);
        for n in 0..64u8 {
            m.handle(on(n + 30, 1));
        }
        render(&mut m, 480);
        m.handle(on(100, 127));
        m.handle(off(100)); // before the 2 ms steal fade is over
        let s = render(&mut m, 4800);
        assert!(peak(&s) > 0.05, "peak {}", peak(&s));
        render(&mut m, 9600);
        assert!(!live_notes(&m).contains(&100), "and it ends by itself");
    }

    #[test]
    fn quick_tap_with_pedal_down_keeps_sounding_until_pedal_up() {
        let mut m = Mixer::new(SR, 1);
        m.handle(Command::Sustain(true));
        m.handle(on(69, 100));
        m.handle(off(69));
        render(&mut m, 9600);
        assert_eq!(m.active_note_voices(), 1);
        m.handle(Command::Sustain(false));
        render(&mut m, 4800);
        assert_eq!(m.active_note_voices(), 0);
    }

    #[test]
    fn pedal_up_right_after_a_quick_tap_still_lets_it_sound() {
        let mut m = Mixer::new(SR, 1);
        m.handle(Command::Sustain(true));
        m.handle(on(69, 100));
        m.handle(off(69));
        m.handle(Command::Sustain(false));
        let s = render(&mut m, 4800);
        assert!(peak(&s) > 0.05, "peak {}", peak(&s));
    }

    #[test]
    fn all_notes_off_releases_everything_even_sustained_notes() {
        let mut m = Mixer::new(SR, 1);
        m.handle(Command::Sustain(true));
        m.handle(on(60, 80));
        m.handle(on(64, 80));
        m.handle(off(60));
        render(&mut m, 480);
        m.handle(Command::AllNotesOff);
        let s = render(&mut m, 4800);
        assert!(s[4800 - 480..].iter().all(|x| *x == 0.0));
        assert_eq!(m.active_note_voices(), 0);
    }

    #[test]
    fn stop_all_also_fades_note_voices() {
        let mut m = Mixer::new(SR, 1);
        m.handle(on(60, 80));
        render(&mut m, 480);
        m.handle(Command::StopAll);
        let s = render(&mut m, 4800);
        assert!(s[4800 - 480..].iter().all(|x| *x == 0.0));
        assert_eq!(m.active_note_voices(), 0);
    }

    #[test]
    fn note_on_with_velocity_zero_acts_as_note_off_and_bad_notes_are_ignored() {
        let mut m = Mixer::new(SR, 1);
        m.handle(on(60, 80));
        render(&mut m, 480);
        m.handle(on(60, 0));
        render(&mut m, 6000);
        assert_eq!(m.active_note_voices(), 0);
        m.handle(on(128, 80));
        m.handle(on(255, 80));
        assert_eq!(m.active_note_voices(), 0);
    }

    #[test]
    fn notes_and_test_tones_mix_together() {
        let mut m = Mixer::new(SR, 1);
        m.handle(on(60, 80));
        m.handle(tone(440.0, 1.0, 0.1));
        render(&mut m, 480);
        assert_eq!(m.active_voices(), 1);
        assert_eq!(m.active_note_voices(), 1);
    }

    // ---- sampled piano ----

    use crate::piano::bank::Sample;
    use crate::piano::testing::{grid_bank, note_hz, sine_sample};
    use crate::piano::SampleBank;
    use std::sync::Arc;

    fn with_bank(bank: SampleBank, channels: u16) -> Mixer {
        let mut m = Mixer::new(SR, channels);
        assert!(m.set_bank(Some(Arc::new(bank))).is_none());
        m
    }

    /// One sample of `hz` for key 60 on every layer, so only the pitch can tell layers apart.
    fn layered_bank(freqs: [f64; 4]) -> SampleBank {
        SampleBank::from_samples((0..4u8).map(|l| sine_sample(60, l, freqs[usize::from(l)], 0.5, 3.0)).collect())
    }

    #[test]
    fn a_key_on_a_sampled_note_plays_that_samples_pitch() {
        let mut m = with_bank(grid_bank(3.0), 1);
        m.handle(on(69, 100));
        render(&mut m, 480);
        let s = render(&mut m, SR as usize);
        assert!((crossings(&s) as i32 - 880).abs() <= 9, "crossings {}", crossings(&s));
    }

    #[test]
    fn one_and_two_semitones_up_give_the_right_frequency() {
        for (key, semis) in [(61u8, 1.0f64), (62, 2.0)] {
            let bank = SampleBank::from_samples(vec![sine_sample(60, 0, note_hz(60), 0.5, 3.0)]);
            let mut m = with_bank(bank, 1);
            m.handle(on(key, 100));
            render(&mut m, 480);
            let s = render(&mut m, SR as usize);
            let want = 2.0 * note_hz(60) * 2f64.powf(semis / 12.0);
            let got = crossings(&s) as f64;
            assert!((got / want - 1.0).abs() < 0.01, "key {key}: {got} vs {want}");
        }
    }

    #[test]
    fn velocity_picks_the_layer() {
        let freqs = [200.0, 300.0, 400.0, 500.0];
        let expect = [(1u8, 0usize), (40, 0), (41, 1), (72, 1), (73, 2), (100, 2), (101, 3), (127, 3)];
        for (vel, layer) in expect {
            let mut m = with_bank(layered_bank(freqs), 1);
            m.handle(on(60, vel));
            render(&mut m, 480);
            let s = render(&mut m, SR as usize / 2);
            let want = freqs[layer]; // 2 * f * 0.5 s crossings
            assert!((crossings(&s) as f64 - want).abs() <= 4.0, "velocity {vel}: {} crossings, wanted about {want}", crossings(&s));
        }
    }

    #[test]
    fn a_single_voice_is_scaled_by_the_master_gain_of_one_half() {
        let mut m = with_bank(grid_bank(1.0), 1);
        m.handle(on(69, 127)); // layer 3, sample amplitude 0.8, gain 1.0
        let s = render(&mut m, 4800);
        let p = peak(&s);
        assert!((p - 0.4).abs() < 0.01, "peak {p}");
    }

    #[test]
    fn softer_keys_are_quieter_across_layers() {
        let peak_at = |v: u8| {
            let mut m = with_bank(grid_bank(1.0), 1);
            m.handle(on(69, v));
            peak(&render(&mut m, 4800))
        };
        let (a, b, c) = (peak_at(30), peak_at(70), peak_at(120));
        assert!(a < b && b < c, "{a} {b} {c}");
    }

    #[test]
    fn stereo_samples_keep_their_left_and_right() {
        let mut d = Vec::new();
        for i in 0..48_000 {
            let v = ((i as f32 * 0.05).sin() * 16000.0) as i16;
            d.push(v);
            d.push(0);
        }
        let mut m = with_bank(SampleBank::from_samples(vec![Sample::new(60, 0, 48_000, 2, d)]), 2);
        m.handle(on(60, 100));
        let mut out = vec![0.0f32; 2 * 2000];
        m.render(&mut out);
        assert!(out.chunks_exact(2).any(|f| f[0].abs() > 0.05));
        assert!(out.chunks_exact(2).all(|f| f[1] == 0.0), "right channel is silent");
    }

    #[test]
    fn mono_output_mixes_both_sides() {
        let mut d = Vec::new();
        for _ in 0..48_000 {
            d.push(16384i16);
            d.push(0);
        }
        let mut m = with_bank(SampleBank::from_samples(vec![Sample::new(60, 0, 48_000, 2, d)]), 1);
        m.handle(on(60, 127));
        let s = render(&mut m, 100);
        // (0.5 + 0) / 2 mid, times velocity 127 gain 1.0, times master 0.5
        assert!((s[50] - 0.125).abs() < 0.001, "{}", s[50]);
    }

    #[test]
    fn the_damper_ends_a_note_within_150_ms_of_key_up() {
        let mut m = with_bank(grid_bank(3.0), 1);
        m.handle(on(60, 100));
        render(&mut m, 4800);
        m.handle(off(60));
        let s = render(&mut m, 48_000 * 150 / 1000);
        assert!(peak(&s[..2400]) > 0.02, "still audible while the damper comes down");
        assert_eq!(m.active_note_voices(), 0);
    }

    #[test]
    fn keys_above_e6_keep_sounding_after_key_up_without_the_pedal() {
        let mut m = with_bank(grid_bank(3.0), 1);
        m.handle(on(96, 100));
        render(&mut m, 4800);
        m.handle(off(96));
        let s = render(&mut m, SR as usize);
        assert!(peak(&s[s.len() - 4800..]) > 0.02, "still ringing a second later");
        assert_eq!(m.active_note_voices(), 1);
    }

    #[test]
    fn the_pedal_holds_a_damped_piano_note_and_lifting_it_releases_it() {
        let mut m = with_bank(grid_bank(3.0), 1);
        m.handle(Command::Sustain(true));
        m.handle(on(60, 100));
        render(&mut m, 2000);
        m.handle(off(60));
        let held = render(&mut m, SR as usize / 2);
        assert!(peak(&held[held.len() - 2400..]) > 0.02);
        m.handle(Command::Sustain(false));
        render(&mut m, 48_000 * 150 / 1000);
        assert_eq!(m.active_note_voices(), 0);
    }

    #[test]
    fn a_piano_note_pressed_again_fades_every_older_voice_of_it_including_released_ones_in_5ms() {
        let mut m = with_bank(grid_bank(3.0), 1);
        m.handle(on(60, 100));
        render(&mut m, 2000);
        m.handle(off(60)); // 120 ms damper fade starts
        render(&mut m, 480);
        m.handle(on(60, 100));
        assert_eq!(m.active_note_voices(), 2);
        render(&mut m, 240 + 4);
        assert_eq!(m.active_note_voices(), 1, "the voice in release is gone within 5 ms");
    }

    #[test]
    fn a_stand_in_note_pressed_again_also_fades_a_voice_that_is_in_release() {
        let mut m = Mixer::new(SR, 1);
        m.handle(on(69, 100));
        render(&mut m, 2000);
        m.handle(off(69)); // 80 ms release starts
        render(&mut m, 480);
        m.handle(on(69, 100));
        assert_eq!(m.active_note_voices(), 2);
        render(&mut m, 240 + 4);
        assert_eq!(m.active_note_voices(), 1);
    }

    #[test]
    fn repeated_piano_note_never_jumps() {
        let mut m = with_bank(grid_bank(3.0), 1);
        let mut all = vec![0.0f32];
        for _ in 0..40 {
            m.handle(on(60, 64));
            all.extend(render(&mut m, 700));
        }
        assert!(max_jump(&all) < 0.1, "jump {}", max_jump(&all));
        assert!(peak(&all) > 0.02);
    }

    #[test]
    fn sixty_four_loud_piano_voices_never_pass_one_and_the_limiter_is_at_work() {
        let samples: Vec<Sample> = (0..4u8).map(|l| sine_sample(60, l, 261.63, 1.0, 1.0)).collect();
        let mut m = with_bank(SampleBank::from_samples(samples), 2);
        // Same key pressed 64 times is faded; use many keys that all reach the one sample.
        for n in 58..=62u8 {
            m.handle(on(n, 127));
        }
        let mut loud = 0.0f32;
        for _ in 0..20 {
            let s = render(&mut m, 2 * 480);
            assert!(s.iter().all(|x| x.is_finite() && x.abs() <= 1.0));
            loud = loud.max(peak(&s));
        }
        assert!(loud > 0.7, "five in-phase full-scale voices (2.5 before limiting) must reach the knee, got {loud}");

        let mut m = with_bank(grid_bank(1.0), 2);
        for n in 36..=99u8 {
            m.handle(on(n, 127));
        }
        assert_eq!(m.active_note_voices(), 64);
        let mut loud = 0.0f32;
        for _ in 0..50 {
            let s = render(&mut m, 2 * 480);
            assert!(s.iter().all(|x| x.is_finite() && x.abs() <= 1.0));
            loud = loud.max(peak(&s));
        }
        assert!(loud > 0.7, "peak {loud}");
    }

    #[test]
    fn a_piano_mix_below_the_knee_is_not_touched_by_the_limiter() {
        let mut m = with_bank(grid_bank(1.0), 1);
        m.handle(on(69, 127));
        let s = render(&mut m, 4800);
        // 0.8 * sin * 0.5: exactly the scaled sample, no bending anywhere.
        for (i, x) in s.iter().enumerate().skip(1) {
            let want = 0.8 * (2.0 * std::f64::consts::PI * 440.0 * i as f64 / 48_000.0).sin() as f32 * 0.5;
            assert!((x - want).abs() < 0.002, "frame {i}: {x} vs {want}");
        }
    }

    #[test]
    fn keys_the_bank_cannot_reach_are_ignored() {
        let mut m = with_bank(grid_bank(1.0), 1);
        m.handle(on(10, 100));
        m.handle(on(120, 100));
        assert_eq!(m.active_note_voices(), 0);
    }

    #[test]
    fn setting_a_bank_fades_stand_in_notes_and_swapping_returns_the_old_bank() {
        let mut m = Mixer::new(SR, 1);
        m.handle(on(69, 100));
        render(&mut m, 480);
        let first = Arc::new(grid_bank(1.0));
        assert!(m.set_bank(Some(Arc::clone(&first))).is_none());
        render(&mut m, 4800);
        assert_eq!(m.active_note_voices(), 0, "the stand-in note was released");
        m.handle(on(60, 100));
        render(&mut m, 480);
        let old = m.set_bank(Some(Arc::new(grid_bank(1.0)))).expect("the old bank comes back");
        assert!(Arc::ptr_eq(&old, &first));
        assert_eq!(m.active_note_voices(), 0, "piano voices that pointed into the old bank are gone");
        let back = m.set_bank(None).unwrap();
        drop(back);
        m.handle(on(69, 100));
        assert!(m.active_note_voices() > 0, "no bank: the stand-in plays again");
    }

    #[test]
    fn stop_all_and_all_notes_off_fade_piano_voices() {
        for cmd in [Command::StopAll, Command::AllNotesOff] {
            let mut m = with_bank(grid_bank(3.0), 1);
            m.handle(Command::Sustain(true));
            m.handle(on(60, 100));
            m.handle(on(96, 100));
            m.handle(off(60));
            render(&mut m, 480);
            m.handle(cmd);
            let s = render(&mut m, 48_000 * 150 / 1000);
            assert!(s[s.len() - 480..].iter().all(|x| *x == 0.0));
            assert_eq!(m.active_note_voices(), 0);
        }
    }

    #[test]
    fn sixty_five_piano_notes_cap_at_64_voices() {
        let mut m = with_bank(grid_bank(2.0), 1);
        for n in 36..=100u8 {
            m.handle(on(n, 50));
        }
        let s = render(&mut m, 4800);
        assert!(s.iter().all(|x| x.is_finite()));
        assert_eq!(m.active_note_voices(), 64);
    }
}
