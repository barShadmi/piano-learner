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

/// Lock-free command channel (single producer, single consumer).
pub fn channel(capacity: usize) -> (rtrb::Producer<Command>, rtrb::Consumer<Command>) {
    rtrb::RingBuffer::new(capacity)
}

/// Owned by the render thread: drains commands, then renders.
pub struct EngineCore {
    commands: rtrb::Consumer<Command>,
    /// Notes from the MIDI thread, which is the only producer of this ring.
    midi: rtrb::Consumer<Command>,
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

    pub fn with_midi(commands: rtrb::Consumer<Command>, midi: rtrb::Consumer<Command>, mixer: Mixer) -> Self {
        Self { commands, midi, mixer, bank_link: None }
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
        while let Ok(cmd) = self.midi.pop() {
            self.mixer.handle(cmd);
        }
        self.mixer.render(out);
    }
}

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
        midi_tx.push(Command::NoteOn { note: 69, velocity: 100 }).unwrap();
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
        midi_tx.push(Command::NoteOn { note: 60, velocity: 127 }).unwrap();
        let mut out = [0.0f32; 4800];
        core.process(&mut out);
        assert!(out[480..].iter().all(|s| *s == 0.0), "master volume from the command ring applies");
        assert!(tx.slots() == 16 && midi_tx.slots() == 16, "both rings emptied");
    }

    #[test]
    fn new_keeps_working_without_a_midi_ring() {
        let (mut tx, rx) = channel(16);
        let mut core = EngineCore::new(rx, Mixer::new(48_000, 1));
        tx.push(Command::NoteOn { note: 69, velocity: 100 }).unwrap();
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
        tx.push(Command::NoteOn { note: 69, velocity: 127 }).unwrap();
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
}
