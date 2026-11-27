//! Velocity curve: MIDI velocity 1..=127 to gain.

/// Gain 0.0..=1.0 for a MIDI velocity: `(v/127)^1.6`. Velocity 0 is silent,
/// anything above 127 counts as 127.
pub fn gain(velocity: u8) -> f32 {
    if velocity == 0 {
        return 0.0;
    }
    (f32::from(velocity.min(127)) / 127.0).powf(1.6)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_velocity_is_exactly_one() {
        assert_eq!(gain(127), 1.0);
    }

    #[test]
    fn zero_velocity_is_silent_and_one_is_audible() {
        assert_eq!(gain(0), 0.0);
        assert!(gain(1) > 0.0);
    }

    #[test]
    fn curve_is_strictly_increasing() {
        for v in 1..127u8 {
            assert!(gain(v + 1) > gain(v), "not increasing at {v}");
        }
    }

    #[test]
    fn curve_is_v_over_127_to_the_1_6() {
        let expected = (64.0f32 / 127.0).powf(1.6);
        assert!((gain(64) - expected).abs() < 1e-6);
    }

    #[test]
    fn values_above_127_are_treated_as_127() {
        assert_eq!(gain(200), 1.0);
    }
}
