/// Attack time in milliseconds (linear).
const ATTACK_MS: u32 = 5;
/// Release time in milliseconds (linear, full scale).
const RELEASE_MS: u32 = 20;
/// Fade-out time in milliseconds for a voice that is being stolen.
const STEAL_MS: u32 = 2;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Stage {
    Idle,
    Attack,
    Sustain,
    Release,
}

/// One sine voice with a click-free envelope. Never allocates.
#[derive(Clone, Copy)]
pub struct ToneVoice {
    sample_rate: f64,
    attack_step: f32,
    release_step: f32,
    steal_step: f32,
    /// Step used by the release stage that is running now.
    fade_step: f32,
    /// A tone waiting for this voice's fast fade-out to finish: (Hz, seconds, gain).
    pending: Option<(f32, f32, f32)>,
    stage: Stage,
    env: f32,
    gain: f32,
    phase: f64,
    phase_inc: f64,
    remaining: u64,
}

impl ToneVoice {
    pub fn new(sample_rate: u32) -> Self {
        let sr = sample_rate.max(1);
        let frames = |ms: u32| ((u64::from(sr) * u64::from(ms)) / 1000).max(1) as f32;
        Self {
            sample_rate: f64::from(sr),
            attack_step: 1.0 / frames(ATTACK_MS),
            release_step: 1.0 / frames(RELEASE_MS),
            steal_step: 1.0 / frames(STEAL_MS),
            fade_step: 1.0 / frames(RELEASE_MS),
            pending: None,
            stage: Stage::Idle,
            env: 0.0,
            gain: 0.0,
            phase: 0.0,
            phase_inc: 0.0,
            remaining: 0,
        }
    }

    /// Start (or restart) the voice. The caller has checked the numbers.
    pub fn start(&mut self, frequency_hz: f32, seconds: f32, gain: f32) {
        self.phase_inc = f64::from(frequency_hz) / self.sample_rate;
        self.gain = gain;
        self.remaining = (f64::from(seconds.max(0.0)) * self.sample_rate).round() as u64;
        self.phase = 0.0;
        self.env = 0.0;
        self.fade_step = self.release_step;
        self.stage = Stage::Attack;
        self.pending = None;
    }

    /// Start a tone on a voice that may still be sounding: the old tone fades
    /// out over about 2 ms, then the new one starts (no click).
    pub fn steal(&mut self, frequency_hz: f32, seconds: f32, gain: f32) {
        if self.stage == Stage::Idle {
            self.start(frequency_hz, seconds, gain);
        } else {
            self.pending = Some((frequency_hz, seconds, gain));
            self.fade_step = self.steal_step;
            self.stage = Stage::Release;
        }
    }

    /// Begin the fade-out from the current level.
    pub fn release(&mut self) {
        if self.stage != Stage::Idle {
            self.pending = None;
            self.fade_step = self.release_step;
            self.stage = Stage::Release;
        }
    }

    pub fn is_active(&self) -> bool {
        self.stage != Stage::Idle
    }

    pub fn envelope(&self) -> f32 {
        self.env
    }

    #[cfg(test)]
    pub fn phase(&self) -> f64 {
        self.phase
    }

    /// Next mono sample. The envelope used is the one before this step, so the
    /// first sample of a new voice is exactly 0.
    pub fn next_sample(&mut self) -> f32 {
        if self.stage == Stage::Idle {
            return 0.0;
        }
        let out = (self.phase * std::f64::consts::TAU).sin() as f32 * self.env * self.gain;
        self.phase += self.phase_inc;
        self.phase -= self.phase.floor();
        match self.stage {
            Stage::Attack => {
                self.env += self.attack_step;
                if self.env >= 1.0 {
                    self.env = 1.0;
                    self.stage = Stage::Sustain;
                }
                self.count_down();
            }
            Stage::Sustain => self.count_down(),
            Stage::Release => {
                self.env -= self.fade_step;
                if self.env <= 0.0 {
                    self.env = 0.0;
                    self.stage = Stage::Idle;
                    if let Some((hz, secs, gain)) = self.pending.take() {
                        self.start(hz, secs, gain);
                    }
                }
            }
            Stage::Idle => {}
        }
        out
    }

    fn count_down(&mut self) {
        if self.remaining > 0 {
            self.remaining -= 1;
        }
        if self.remaining == 0 {
            self.stage = Stage::Release;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: u32 = 48_000;

    #[test]
    fn attack_starts_at_zero_and_rises_monotonically_over_5ms() {
        let mut v = ToneVoice::new(SR);
        v.start(440.0, 1.0, 1.0);
        let attack_frames = (SR as usize * 5) / 1000; // 240
        let mut prev_env = -1.0f32;
        for i in 0..attack_frames {
            let env = v.envelope();
            let s = v.next_sample();
            if i == 0 {
                assert_eq!(s, 0.0, "first sample must be exactly 0");
            }
            assert!(env > prev_env || (i == 0 && env == 0.0), "envelope must rise at {i}");
            prev_env = env;
        }
        assert!((v.envelope() - 1.0).abs() < 1e-3, "full level after 5 ms");
    }

    #[test]
    fn voice_ends_within_release_time_after_its_length() {
        let mut v = ToneVoice::new(SR);
        v.start(440.0, 0.1, 0.5);
        let sustain = (SR as f32 * 0.1) as usize;
        let release = (SR as usize * 20) / 1000;
        for _ in 0..(sustain + release + 2) {
            v.next_sample();
        }
        assert!(!v.is_active());
        assert_eq!(v.next_sample(), 0.0);
    }

    #[test]
    fn idle_voice_is_silent_and_inactive() {
        let mut v = ToneVoice::new(SR);
        assert!(!v.is_active());
        assert_eq!(v.next_sample(), 0.0);
    }

    #[test]
    fn phase_stays_in_zero_to_one_even_for_huge_steps() {
        let mut v = ToneVoice::new(SR);
        v.start(SR as f32 * 3.5, 1.0, 0.5);
        for _ in 0..1000 {
            v.next_sample();
            assert!((0.0..1.0).contains(&v.phase()), "phase {}", v.phase());
        }
    }
}
