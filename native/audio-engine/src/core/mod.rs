//! Platform-free engine core: commands in, interleaved samples out.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};

pub use command::Command;
pub use mixer::Mixer;

/// Status shared with the control side. Written with atomics only.
#[derive(Default)]
pub struct EngineStats {
    pub callbacks: AtomicU64,
    pub last_buffer_frames: AtomicU32,
    pub underruns: AtomicU64,
    pub running: AtomicBool,
    /// Set when the output stopped by itself because the device failed.
    pub failed: AtomicBool,
    /// Playback time minus callback time as the driver reports it, in
    /// microseconds (0 = not measured).
    pub measured_latency_us: AtomicU32,
}

impl EngineStats {
    /// Zero every counter for a new start.
    pub fn reset(&self) {
        self.callbacks.store(0, Ordering::Relaxed);
        self.last_buffer_frames.store(0, Ordering::Relaxed);
        self.underruns.store(0, Ordering::Relaxed);
        self.measured_latency_us.store(0, Ordering::Relaxed);
        self.failed.store(false, Ordering::Relaxed);
        self.running.store(false, Ordering::Release);
    }
}

/// One key press as the audio thread saw it. `midi_us` is when the MIDI
/// callback got the message, `picked_us` when the audio callback that handled
/// it started, both on the `clock` clock.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LatencySample {
    pub note: u8,
    pub midi_us: u64,
    pub picked_us: u64,
}

/// The notes from the MIDI thread, and where the audio thread reports how long
/// each one waited. Without a latency ring nothing is timed.
pub struct MidiInput {
    pub commands: rtrb::Consumer<Command>,
    pub latency: Option<rtrb::Producer<LatencySample>>,
}

impl MidiInput {
    pub fn new(commands: rtrb::Consumer<Command>, latency: rtrb::Producer<LatencySample>) -> Self {
        Self { commands, latency: Some(latency) }
    }
}

impl From<rtrb::Consumer<Command>> for MidiInput {
    fn from(commands: rtrb::Consumer<Command>) -> Self {
        Self { commands, latency: None }
    }
}

/// Lock-free command channel (single producer, single consumer).
pub fn channel(capacity: usize) -> (rtrb::Producer<Command>, rtrb::Consumer<Command>) {
    rtrb::RingBuffer::new(capacity)
}

/// Owned by the render thread: drains commands, then renders.
pub struct EngineCore {
    commands: rtrb::Consumer<Command>,
    /// Notes from the MIDI thread, which is the only producer of this ring.
    midi: MidiInput,
    mixer: Mixer,
    /// Piano banks that arrive while the output runs (see `piano::bank_link`).
    bank_link: Option<crate::piano::BankReceiver>,
}

impl EngineCore {
    /// A core with no MIDI source (an empty ring that nobody writes to).
    pub fn new(commands: rtrb::Consumer<Command>, mixer: Mixer) -> Self {
        let (_unused_producer, midi) = channel(1);
        Self::with_midi(commands, midi, mixer)
    }

    pub fn with_midi(commands: rtrb::Consumer<Command>, midi: impl Into<MidiInput>, mixer: Mixer) -> Self {
        clock::init();
        Self { commands, midi: midi.into(), mixer, bank_link: None }
    }

    /// Accept piano banks through `link`. A replaced bank goes back through
    /// the link, so the audio thread never frees one.
    pub fn with_bank_link(mut self, link: crate::piano::BankReceiver) -> Self {
        self.bank_link = Some(link);
        self
    }

    pub fn process(&mut self, out: &mut [f32]) {
        if let Some(link) = &mut self.bank_link {
            while let Some(bank) = link.next_bank() {
                if let Some(old) = self.mixer.set_bank(Some(bank)) {
                    link.give_back(old);
                }
            }
        }
        while let Ok(cmd) = self.commands.pop() {
            self.mixer.handle(cmd);
        }
        // One clock read per call, and only when notes are being timed.
        let picked_us = if self.midi.latency.is_some() { clock::now_us() } else { 0 };
        while let Ok(cmd) = self.midi.commands.pop() {
            if let (Command::NoteOn { note, midi_us, .. }, Some(latency)) = (cmd, self.midi.latency.as_mut()) {
                // Never waits. A full ring just loses this sample.
                let _ = latency.push(LatencySample { note, midi_us, picked_us });
            }
            self.mixer.handle(cmd);
        }
        self.mixer.render(out);
    }
}

pub mod clock;
mod command;
pub mod midi_msg;
mod mixer;
mod tone;
pub mod velocity;
mod voice;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn process_applies_pending_commands_then_renders() {
        let (mut tx, rx) = channel(16);
        let mut core = EngineCore::new(rx, Mixer::new(48_000, 2));
        tx.push(Command::PlayTestTone { frequency_hz: 440.0, seconds: 1.0, gain: 0.25 }).unwrap();
        let mut out = [0.0f32; 2 * 480];
        core.process(&mut out);
        assert!(out.iter().any(|s| s.abs() > 0.01), "tone should be audible");
    }

    #[test]
    fn process_plays_notes_from_the_midi_ring() {
        let (_tx, rx) = channel(16);
        let (mut midi_tx, midi_rx) = channel(16);
        let mut core = EngineCore::with_midi(rx, midi_rx, Mixer::new(48_000, 2));
        midi_tx.push(Command::NoteOn { note: 69, velocity: 100, midi_us: 0 }).unwrap();
        let mut out = [0.0f32; 2 * 480];
        core.process(&mut out);
        assert!(out.iter().any(|s| s.abs() > 0.01), "note should be audible");
    }

    #[test]
    fn both_rings_are_drained_every_process_call() {
        let (mut tx, rx) = channel(16);
        let (mut midi_tx, midi_rx) = channel(16);
        let mut core = EngineCore::with_midi(rx, midi_rx, Mixer::new(48_000, 1));
        tx.push(Command::SetMasterVolume(0.0)).unwrap();
        midi_tx.push(Command::NoteOn { note: 60, velocity: 127, midi_us: 0 }).unwrap();
        let mut out = [0.0f32; 4800];
        core.process(&mut out);
        assert!(out[480..].iter().all(|s| *s == 0.0), "master volume from the command ring applies");
        assert!(tx.slots() == 16 && midi_tx.slots() == 16, "both rings emptied");
    }

    #[test]
    fn new_keeps_working_without_a_midi_ring() {
        let (mut tx, rx) = channel(16);
        let mut core = EngineCore::new(rx, Mixer::new(48_000, 1));
        tx.push(Command::NoteOn { note: 69, velocity: 100, midi_us: 0 }).unwrap();
        let mut out = [0.0f32; 480];
        core.process(&mut out);
        assert!(out.iter().any(|s| s.abs() > 0.01));
    }

    #[test]
    fn process_with_no_commands_is_silent() {
        let (_tx, rx) = channel(16);
        let mut core = EngineCore::new(rx, Mixer::new(48_000, 2));
        let mut out = [1.0f32; 2 * 64];
        core.process(&mut out);
        assert!(out.iter().all(|s| *s == 0.0));
    }

    #[test]
    fn channel_has_requested_capacity() {
        let (tx, _rx) = channel(4);
        assert_eq!(tx.buffer().capacity(), 4);
    }

    #[test]
    fn stats_start_at_zero_and_not_running() {
        use std::sync::atomic::Ordering::Relaxed;
        let s = EngineStats::default();
        assert_eq!(s.callbacks.load(Relaxed), 0);
        assert_eq!(s.last_buffer_frames.load(Relaxed), 0);
        assert_eq!(s.underruns.load(Relaxed), 0);
        assert!(!s.running.load(Relaxed));
        assert!(!s.failed.load(Relaxed));
        assert_eq!(s.measured_latency_us.load(Relaxed), 0);
    }

    #[test]
    fn reset_zeroes_every_counter() {
        use std::sync::atomic::Ordering::Relaxed;
        let s = EngineStats::default();
        s.callbacks.store(5, Relaxed);
        s.underruns.store(2, Relaxed);
        s.measured_latency_us.store(900, Relaxed);
        s.failed.store(true, Relaxed);
        s.reset();
        assert_eq!(s.callbacks.load(Relaxed), 0);
        assert_eq!(s.underruns.load(Relaxed), 0);
        assert_eq!(s.measured_latency_us.load(Relaxed), 0);
        assert!(!s.failed.load(Relaxed));
    }

    #[test]
    fn a_bank_sent_while_running_is_used_and_the_old_one_comes_back_to_be_dropped_elsewhere() {
        use crate::piano::{bank_link, testing::grid_bank};
        use std::sync::Arc;
        let (mut sender, receiver) = bank_link(2);
        let (mut tx, rx) = channel(16);
        let mut core = EngineCore::new(rx, Mixer::new(48_000, 1)).with_bank_link(receiver);
        let first = Arc::new(grid_bank(0.5));
        sender.send(Arc::clone(&first)).unwrap();
        let mut out = [0.0f32; 480];
        core.process(&mut out);
        assert_eq!(Arc::strong_count(&first), 2, "the audio thread now holds it");
        tx.push(Command::NoteOn { note: 69, velocity: 127, midi_us: 0 }).unwrap();
        core.process(&mut out);
        let p = out.iter().fold(0.0f32, |a, b| a.max(b.abs()));
        assert!((p - 0.4).abs() < 0.02, "piano sample peak (0.8 * master 0.5), not the stand-in: {p}");

        sender.send(Arc::new(grid_bank(0.5))).unwrap();
        core.process(&mut out);
        assert_eq!(Arc::strong_count(&first), 2, "now in the return ring, not freed on the audio thread");
        assert_eq!(sender.reclaim(), 1);
        assert_eq!(Arc::strong_count(&first), 1, "dropped by the control side");
    }

    #[test]
    fn without_a_bank_link_nothing_changes() {
        let (_tx, rx) = channel(16);
        let mut core = EngineCore::new(rx, Mixer::new(48_000, 1));
        let mut out = [0.0f32; 64];
        core.process(&mut out);
        assert!(out.iter().all(|s| *s == 0.0));
    }

    // ---- latency samples ----

    fn latency_core(ring: usize) -> (EngineCore, rtrb::Producer<Command>, rtrb::Consumer<LatencySample>) {
        let (_tx, rx) = channel(16);
        let (midi_tx, midi_rx) = channel(64);
        let (lat_tx, lat_rx) = rtrb::RingBuffer::new(ring);
        let core = EngineCore::with_midi(rx, MidiInput::new(midi_rx, lat_tx), Mixer::new(48_000, 1));
        (core, midi_tx, lat_rx)
    }

    #[test]
    fn a_stamped_midi_note_makes_exactly_one_sample_picked_no_earlier() {
        let (mut core, mut midi_tx, mut lat) = latency_core(16);
        let stamp = clock::now_us();
        midi_tx.push(Command::NoteOn { note: 64, velocity: 80, midi_us: stamp }).unwrap();
        let mut out = [0.0f32; 480];
        core.process(&mut out);
        let s = lat.pop().expect("one sample");
        assert_eq!(s.note, 64);
        assert_eq!(s.midi_us, stamp);
        assert!(s.picked_us >= stamp, "{} >= {stamp}", s.picked_us);
        assert!(lat.pop().is_err(), "exactly one");
        core.process(&mut out);
        assert!(lat.pop().is_err(), "a note is only timed once");
    }

    #[test]
    fn two_notes_in_one_callback_share_one_clock_read() {
        let (mut core, mut midi_tx, mut lat) = latency_core(16);
        let stamp = clock::now_us();
        midi_tx.push(Command::NoteOn { note: 60, velocity: 80, midi_us: stamp }).unwrap();
        midi_tx.push(Command::NoteOn { note: 67, velocity: 80, midi_us: stamp }).unwrap();
        let mut out = [0.0f32; 480];
        core.process(&mut out);
        let (a, b) = (lat.pop().unwrap(), lat.pop().unwrap());
        assert_eq!((a.note, b.note), (60, 67));
        assert_eq!(a.picked_us, b.picked_us);
    }

    #[test]
    fn only_notes_from_the_midi_ring_are_timed() {
        let (mut tx, rx) = channel(16);
        let (mut midi_tx, midi_rx) = channel(16);
        let (lat_tx, mut lat) = rtrb::RingBuffer::new(8);
        let mut core = EngineCore::with_midi(rx, MidiInput::new(midi_rx, lat_tx), Mixer::new(48_000, 1));
        tx.push(Command::NoteOn { note: 60, velocity: 90, midi_us: 5 }).unwrap();
        midi_tx.push(Command::NoteOff { note: 60 }).unwrap();
        midi_tx.push(Command::Sustain(true)).unwrap();
        midi_tx.push(Command::AllNotesOff).unwrap();
        let mut out = [0.0f32; 480];
        core.process(&mut out);
        assert!(lat.pop().is_err(), "no sample for a note on the command ring, or for off, pedal and all-off");
    }

    #[test]
    fn a_full_latency_ring_drops_samples_and_the_note_still_plays() {
        let (mut core, mut midi_tx, mut lat) = latency_core(1);
        for note in [60u8, 62, 64] {
            midi_tx.push(Command::NoteOn { note, velocity: 100, midi_us: clock::now_us() }).unwrap();
        }
        let mut out = [0.0f32; 480];
        core.process(&mut out);
        assert!(out.iter().any(|s| s.abs() > 0.01), "sound is not held back by a full ring");
        assert_eq!(lat.pop().unwrap().note, 60);
        assert!(lat.pop().is_err(), "the other two were dropped");
        assert!(midi_tx.slots() == 64, "the midi ring was emptied");
    }

    #[test]
    fn a_core_without_a_latency_ring_still_plays_and_reads_no_stamps() {
        let (_tx, rx) = channel(16);
        let (mut midi_tx, midi_rx) = channel(16);
        let mut core = EngineCore::with_midi(rx, midi_rx, Mixer::new(48_000, 1));
        midi_tx.push(Command::NoteOn { note: 69, velocity: 100, midi_us: 1 }).unwrap();
        let mut out = [0.0f32; 480];
        core.process(&mut out);
        assert!(out.iter().any(|s| s.abs() > 0.01));
    }
}
