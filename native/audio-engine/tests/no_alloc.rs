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

#[test]
fn process_never_allocates_with_note_commands_from_both_rings() {
    let (mut tx, rx) = channel(64);
    let (mut midi_tx, midi_rx) = channel(256);
    let mut core = EngineCore::with_midi(rx, midi_rx, Mixer::new(48_000, 2));
    let mut out = vec![0.0f32; 2 * 128];

    ARMED.with(|a| a.set(true));
    for i in 0..3000u32 {
        let note = 30 + (i % 80) as u8;
        // More than 64 notes held at once forces stealing.
        let _ = midi_tx.push(Command::NoteOn { note, velocity: 1 + (i % 127) as u8 });
        if i % 3 == 0 {
            let _ = midi_tx.push(Command::NoteOff { note: 30 + ((i + 7) % 80) as u8 });
        }
        if i % 97 == 0 {
            let _ = midi_tx.push(Command::Sustain(i % 2 == 0));
        }
        if i % 400 == 0 {
            let _ = midi_tx.push(Command::AllNotesOff);
        }
        if i % 5 == 0 {
            let _ = tx.push(Command::NoteOn { note: 60, velocity: 90 });
            let _ = tx.push(Command::NoteOff { note: 60 });
        }
        if i % 50 == 0 {
            let _ = tx.push(Command::PlayTestTone { frequency_hz: 440.0, seconds: 0.02, gain: 0.1 });
            let _ = tx.push(Command::StopAll);
        }
        core.process(&mut out);
    }
    ARMED.with(|a| a.set(false));

    assert_eq!(ALLOCS.load(Ordering::SeqCst), 0, "audio path allocated");
}
