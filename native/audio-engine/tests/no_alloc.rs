//! Proves the audio path never allocates. The counting allocator is test-only.
use audio_engine::core::{channel, Command, EngineCore, Mixer};
use audio_engine::piano::{bank_link, Sample, SampleBank};
use std::sync::Arc;
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::sync::atomic::{AtomicUsize, Ordering};

static ALLOCS: AtomicUsize = AtomicUsize::new(0);
static FREES: AtomicUsize = AtomicUsize::new(0);

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
        if ARMED.with(|a| a.get()) {
            FREES.fetch_add(1, Ordering::SeqCst);
        }
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
        let _ = midi_tx.push(Command::NoteOn { note, velocity: 1 + (i % 127) as u8, midi_us: 0 });
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
            let _ = tx.push(Command::NoteOn { note: 60, velocity: 90, midi_us: 0 });
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

/// A small bank: a sine on every minor third, four layers, each 0.3 s long.
fn small_bank() -> SampleBank {
    let mut v = Vec::new();
    for layer in 0..4u8 {
        let mut n = 21u8;
        while n <= 108 {
            let hz = 440.0 * 2f64.powf((f64::from(n) - 69.0) / 12.0);
            let mut d = Vec::new();
            for i in 0..14_400 {
                let x = ((2.0 * std::f64::consts::PI * hz * f64::from(i) / 48_000.0).sin() * 12_000.0) as i16;
                d.push(x);
                d.push(x);
            }
            v.push(Sample::new(n, layer, 48_000, 2, d));
            n += 3;
        }
    }
    SampleBank::from_samples(v)
}

fn busy_notes(core: &mut EngineCore, midi_tx: &mut rtrb::Producer<Command>, out: &mut [f32], rounds: u32) {
    for i in 0..rounds {
        let note = 21 + (i % 88) as u8;
        // More than 64 notes held at once forces stealing; the 0.3 s samples also run out by themselves.
        let _ = midi_tx.push(Command::NoteOn { note, velocity: 1 + (i % 127) as u8, midi_us: 0 });
        if i % 3 == 0 {
            let _ = midi_tx.push(Command::NoteOff { note: 21 + ((i + 7) % 88) as u8 });
        }
        if i % 5 == 0 {
            let _ = midi_tx.push(Command::NoteOn { note: 60, velocity: 90, midi_us: 0 }); // same note again
        }
        if i % 97 == 0 {
            let _ = midi_tx.push(Command::Sustain(i % 2 == 0));
        }
        if i % 400 == 0 {
            let _ = midi_tx.push(Command::AllNotesOff);
        }
        core.process(out);
    }
}

#[test]
fn process_never_allocates_with_a_piano_bank_set_on_the_mixer() {
    let (_tx, rx) = channel(64);
    let (mut midi_tx, midi_rx) = channel(256);
    let mut mixer = Mixer::new(48_000, 2);
    assert!(mixer.set_bank(Some(Arc::new(small_bank()))).is_none());
    let mut core = EngineCore::with_midi(rx, midi_rx, mixer);
    let mut out = vec![0.0f32; 2 * 128];

    ARMED.with(|a| a.set(true));
    busy_notes(&mut core, &mut midi_tx, &mut out, 3000);
    ARMED.with(|a| a.set(false));

    assert_eq!(ALLOCS.load(Ordering::SeqCst), 0, "audio path allocated");
}

#[test]
fn process_neither_allocates_nor_frees_when_banks_arrive_through_the_ring() {
    let (_tx, rx) = channel(64);
    let (mut midi_tx, midi_rx) = channel(256);
    let (mut sender, receiver) = bank_link(2);
    let mut core = EngineCore::with_midi(rx, midi_rx, Mixer::new(48_000, 2)).with_bank_link(receiver);
    let mut out = vec![0.0f32; 2 * 128];

    // Stand-in notes are playing when the first bank arrives, piano notes when the second does.
    let (first, second) = (Arc::new(small_bank()), Arc::new(small_bank()));
    sender.send(Arc::clone(&first)).unwrap();
    ARMED.with(|a| a.set(true));
    busy_notes(&mut core, &mut midi_tx, &mut out, 200);
    ARMED.with(|a| a.set(false));
    sender.send(Arc::clone(&second)).unwrap();
    ARMED.with(|a| a.set(true));
    busy_notes(&mut core, &mut midi_tx, &mut out, 200);
    ARMED.with(|a| a.set(false));

    assert_eq!(ALLOCS.load(Ordering::SeqCst), 0, "audio path allocated");
    assert_eq!(FREES.load(Ordering::SeqCst), 0, "audio path freed memory");
    assert_eq!(sender.reclaim(), 1, "the replaced bank came back through the return ring");
}

#[test]
fn process_never_allocates_with_latency_samples_even_when_the_ring_is_full() {
    use audio_engine::core::{clock, LatencySample, MidiInput};
    let (_tx, rx) = channel(64);
    let (mut midi_tx, midi_rx) = channel(256);
    // Small on purpose: it fills up, so both the push and the drop are exercised.
    let (lat_tx, mut lat_rx) = rtrb::RingBuffer::<LatencySample>::new(8);
    let mut core = EngineCore::with_midi(rx, MidiInput::new(midi_rx, lat_tx), Mixer::new(48_000, 2));
    let mut out = vec![0.0f32; 2 * 128];
    clock::init();

    ARMED.with(|a| a.set(true));
    for i in 0..3000u32 {
        let note = 30 + (i % 80) as u8;
        let _ = midi_tx.push(Command::NoteOn { note, velocity: 1 + (i % 127) as u8, midi_us: clock::now_us() });
        if i % 3 == 0 {
            let _ = midi_tx.push(Command::NoteOff { note: 30 + ((i + 7) % 80) as u8 });
        }
        core.process(&mut out);
        if i % 20 == 19 {
            // Drain now and then, like the control side, so the ring is sometimes full and sometimes not.
            ARMED.with(|a| a.set(false));
            while lat_rx.pop().is_ok() {}
            ARMED.with(|a| a.set(true));
        }
    }
    ARMED.with(|a| a.set(false));

    assert_eq!(ALLOCS.load(Ordering::SeqCst), 0, "audio path allocated");
    assert_eq!(FREES.load(Ordering::SeqCst), 0, "audio path freed memory");
}
