//! Soft limiter for the note mix.

/// Below this level the limiter changes nothing.
pub const KNEE: f32 = 0.7;

/// Leaves `|x| <= 0.7` untouched. Above, bends smoothly towards 1.0 (slope 1
/// at the knee, so no corner) and never goes above 1.0.
pub fn soft_limit(x: f32) -> f32 {
    if x.is_nan() {
        return 0.0;
    }
    let a = x.abs();
    if a <= KNEE {
        return x;
    }
    let width = 1.0 - KNEE;
    let t = (a - KNEE) / width;
    // 1 - 1/(1+t) is t/(1+t) and also behaves for t = infinity.
    let y = KNEE + width * (1.0 - 1.0 / (1.0 + t));
    y.min(1.0).copysign(x)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn below_the_knee_nothing_changes() {
        for i in -700..=700 {
            let x = i as f32 / 1000.0;
            assert_eq!(soft_limit(x), x);
        }
    }

    #[test]
    fn above_the_knee_it_rises_but_stays_at_or_below_one() {
        let mut last = KNEE;
        for i in 0..2000 {
            let x = KNEE + i as f32 * 0.01;
            let y = soft_limit(x);
            assert!(y >= last && y <= 1.0, "x {x} y {y}");
            last = y;
        }
        assert!(soft_limit(1e30) <= 1.0);
        assert!(soft_limit(f32::INFINITY) <= 1.0);
    }

    #[test]
    fn it_is_odd_and_has_no_step_at_the_knee() {
        assert_eq!(soft_limit(-2.0), -soft_limit(2.0));
        let a = soft_limit(KNEE);
        let b = soft_limit(KNEE + 0.001);
        assert!((b - a - 0.001).abs() < 0.0002, "slope near knee {}", (b - a) / 0.001);
    }

    #[test]
    fn not_a_number_becomes_silence() {
        assert_eq!(soft_limit(f32::NAN), 0.0);
    }
}
