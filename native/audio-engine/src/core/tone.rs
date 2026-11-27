/// Attack time in milliseconds (linear).
const ATTACK_MS: u32 = 5;
/// Release time in milliseconds (linear, full scale).
const RELEASE_MS: u32 = 20;

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
        self.stage = Stage::Attack;
    }

    /// Begin the fade-out from the current level.
    pub fn release(&mut self) {
        if self.stage != Stage::Idle {
            self.stage = Stage::Release;
        }
    }

    pub fn is_active(&self) -> bool {
        self.stage != Stage::Idle
    }

    pub fn envelope(&self) -> f32 {
        self.env
    }

    /// Next mono sample. The envelope used is the one before this step, so the
    /// first sample of a new voice is exactly 0.
    pub fn next_sample(&mut self) -> f32 {
        if self.stage == Stage::Idle {
            return 0.0;
        }
        let out = (self.phase * std::f64::consts::TAU).sin() as f32 * self.env * self.gain;
        self.phase += self.phase_inc;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
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
                self.env -= self.release_step;
                if self.env <= 0.0 {
                    self.env = 0.0;
                    self.stage = Stage::Idle;
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
}
