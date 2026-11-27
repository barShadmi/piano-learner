use crate::core::command::Command;
use crate::core::tone::ToneVoice;
use crate::core::voice::{note_gain, NoteVoice};

/// Number of tone voices, fixed at construction.
pub const VOICES: usize = 8;
/// Number of piano note voices, fixed at construction.
pub const NOTE_VOICES: usize = 64;

/// Mixes the tone voices into interleaved output. Never allocates after `new`.
pub struct Mixer {
    voices: [ToneVoice; VOICES],
    notes: [NoteVoice; NOTE_VOICES],
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
            }
            Command::NoteOn { note, velocity } => self.note_on(note, velocity),
            Command::NoteOff { note } => self.note_off(note),
            Command::Sustain(down) => {
                self.pedal_down = down;
                if !down {
                    self.notes.iter_mut().for_each(NoteVoice::pedal_up);
                }
            }
            Command::AllNotesOff => self.notes.iter_mut().for_each(NoteVoice::stop),
            Command::SetMasterVolume(v) => {
                if v.is_finite() {
                    self.master_target = v.clamp(0.0, 1.0);
                }
            }
        }
    }

    pub fn active_voices(&self) -> usize {
        self.voices.iter().filter(|v| v.is_active()).count()
    }

    /// Piano note voices that are sounding (including ones fading out).
    pub fn active_note_voices(&self) -> usize {
        self.notes.iter().filter(|v| v.is_active()).count()
    }

    fn note_on(&mut self, note: u8, velocity: u8) {
        if velocity == 0 {
            return self.note_off(note);
        }
        if note > 127 || NoteVoice::frequency(note) >= self.nyquist_hz {
            return;
        }
        // The same note again: the old voice fades out quickly, a new one starts.
        for v in self.notes.iter_mut().filter(|v| v.is_live() && v.note() == note) {
            v.retrigger_fade();
        }
        let serial = self.next_serial;
        self.next_serial += 1;
        let i = self.note_voice_to_use();
        self.notes[i].steal(note, note_gain(velocity), serial);
    }

    fn note_off(&mut self, note: u8) {
        let pedal = self.pedal_down;
        for v in self.notes.iter_mut().filter(|v| v.is_key_down() && v.note() == note) {
            v.key_up(pedal);
        }
    }

    /// A free voice, else the oldest one whose key is up, else the oldest.
    fn note_voice_to_use(&self) -> usize {
        let mut oldest_up: Option<usize> = None;
        let mut oldest = 0;
        for (i, v) in self.notes.iter().enumerate() {
            if !v.is_active() {
                return i;
            }
            if !v.is_key_down() && oldest_up.is_none_or(|j| v.serial() < self.notes[j].serial()) {
                oldest_up = Some(i);
            }
            if v.serial() < self.notes[oldest].serial() {
                oldest = i;
            }
        }
        oldest_up.unwrap_or(oldest)
    }

    /// Fill `out` with interleaved frames. A trailing partial frame is zeroed.
    pub fn render(&mut self, out: &mut [f32]) {
        let mut frames = out.chunks_exact_mut(self.channels);
        for frame in &mut frames {
            let mut sum = 0.0f32;
            for v in &mut self.voices {
                sum += v.next_sample();
            }
            for v in &mut self.notes {
                sum += v.next_sample();
            }
            if self.master < self.master_target {
                self.master = (self.master + self.master_step).min(self.master_target);
            } else if self.master > self.master_target {
                self.master = (self.master - self.master_step).max(self.master_target);
            }
            frame.fill((sum * self.master).clamp(-1.0, 1.0));
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
        Command::NoteOn { note, velocity }
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
}
