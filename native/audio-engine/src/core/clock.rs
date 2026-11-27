//! One clock for the MIDI thread and the audio thread.
//!
//! `Instant::now` does not allocate or take a lock: on Windows it is
//! `QueryPerformanceCounter` (a counter read in user mode) and on Linux it is
//! `clock_gettime(CLOCK_MONOTONIC)` (the vDSO). The `OnceLock` epoch is an
//! atomic load once it is set, so `init` is called from the control side
//! first and the audio thread never runs the one-time setup.

use std::sync::OnceLock;
use std::time::Instant;

static EPOCH: OnceLock<Instant> = OnceLock::new();

/// Fix the zero of the clock now (call it off the audio thread; harmless to repeat).
pub fn init() {
    EPOCH.get_or_init(Instant::now);
}

/// Microseconds since the first `init` or `now_us` call in this process.
/// Only goes forward, on every thread.
pub fn now_us() -> u64 {
    EPOCH.get_or_init(Instant::now).elapsed().as_micros() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use std::thread;

    #[test]
    fn the_clock_never_goes_backwards_across_threads() {
        let before = now_us();
        let barrier = Arc::new(Barrier::new(4));
        let workers: Vec<_> = (0..4)
            .map(|_| {
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    let first = now_us();
                    let mut last = first;
                    for _ in 0..50_000 {
                        let t = now_us();
                        assert!(t >= last, "went backwards: {t} after {last}");
                        last = t;
                    }
                    (first, last)
                })
            })
            .collect();
        let spans: Vec<(u64, u64)> = workers.into_iter().map(|w| w.join().unwrap()).collect();
        let after = now_us();
        for (first, last) in spans {
            assert!(first >= before, "a thread read earlier than a read made before it started");
            assert!(last <= after, "a thread read later than a read made after it finished");
        }
    }

    #[test]
    fn the_midi_stamp_and_the_audio_clock_are_the_same_clock() {
        let a = now_us();
        let m = crate::midi::now_us();
        let b = now_us();
        assert!(a <= m && m <= b, "{a} <= {m} <= {b}");
    }

    #[test]
    fn init_fixes_the_epoch_so_a_later_read_is_small_and_forward() {
        init();
        let a = now_us();
        init();
        assert!(now_us() >= a);
    }
}
