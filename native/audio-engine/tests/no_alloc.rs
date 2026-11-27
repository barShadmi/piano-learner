//! Proves the audio path never allocates. The counting allocator is test-only.
use audio_engine::core::{channel, Command, EngineCore, Mixer};
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::sync::atomic::{AtomicUsize, Ordering};

static ALLOCS: AtomicUsize = AtomicUsize::new(0);

thread_local! {
    static ARMED: Cell<bool> = const { Cell::new(false) };
}

struct Counting;

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        if ARMED.with(|a| a.get()) {
            ALLOCS.fetch_add(1, Ordering::SeqCst);
        }
        System.alloc(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        System.dealloc(p, l)
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        if ARMED.with(|a| a.get()) {
            ALLOCS.fetch_add(1, Ordering::SeqCst);
        }
        System.realloc(p, l, n)
    }
}

#[global_allocator]
static A: Counting = Counting;

#[test]
fn process_never_allocates_with_commands_pending() {
    let (mut tx, rx) = channel(64);
    let mut core = EngineCore::new(rx, Mixer::new(48_000, 2));
    let mut out = vec![0.0f32; 2 * 128];

    ARMED.with(|a| a.set(true));
    for i in 0..1000 {
        let _ = tx.push(Command::PlayTestTone {
            frequency_hz: 220.0 + (i % 12) as f32 * 20.0,
            seconds: 0.05,
            gain: 0.2,
        });
        if i % 50 == 0 {
            let _ = tx.push(Command::StopAll);
        }
        if i % 70 == 0 {
            let _ = tx.push(Command::SetMasterVolume(0.8));
        }
        core.process(&mut out);
    }
    ARMED.with(|a| a.set(false));

    assert_eq!(ALLOCS.load(Ordering::SeqCst), 0, "audio path allocated");
}
