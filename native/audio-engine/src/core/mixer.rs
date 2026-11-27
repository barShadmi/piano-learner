use crate::core::command::Command;
use crate::core::tone::ToneVoice;

/// Number of tone voices, fixed at construction.
pub const VOICES: usize = 8;

/// Mixes the tone voices into interleaved output. Never allocates after `new`.
pub struct Mixer {
    voices: [ToneVoice; VOICES],
    channels: usize,
    master: f32,
}

impl Mixer {
    pub fn new(sample_rate: u32, channels: u16) -> Self {
        Self {
            voices: [ToneVoice::new(sample_rate); VOICES],
            channels: usize::from(channels.max(1)),
            master: 1.0,
        }
    }

    pub fn handle(&mut self, cmd: Command) {
        match cmd {
            Command::PlayTestTone { frequency_hz, seconds, gain } => {
                if !(frequency_hz.is_finite() && frequency_hz > 0.0 && gain.is_finite()) {
                    return;
                }
                let seconds = if seconds.is_finite() { seconds } else { 0.0 };
                let i = self.free_or_quietest_voice();
                self.voices[i].start(frequency_hz, seconds, gain.clamp(0.0, 1.0));
            }
            Command::StopAll => self.voices.iter_mut().for_each(ToneVoice::release),
            Command::SetMasterVolume(v) => {
                if v.is_finite() {
                    self.master = v.clamp(0.0, 1.0);
                }
            }
        }
    }

    pub fn active_voices(&self) -> usize {
        self.voices.iter().filter(|v| v.is_active()).count()
    }

    /// Fill `out` with interleaved frames. A trailing partial frame is zeroed.
    pub fn render(&mut self, out: &mut [f32]) {
        let mut frames = out.chunks_exact_mut(self.channels);
        for frame in &mut frames {
            let mut sum = 0.0f32;
            for v in &mut self.voices {
                sum += v.next_sample();
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
}
