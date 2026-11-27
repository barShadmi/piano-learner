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
}

impl EngineCore {
    /// A core with no MIDI source (an empty ring that nobody writes to).
    pub fn new(commands: rtrb::Consumer<Command>, mixer: Mixer) -> Self {
        let (_unused_producer, midi) = channel(1);
        Self::with_midi(commands, midi, mixer)
    }

    pub fn with_midi(commands: rtrb::Consumer<Command>, midi: rtrb::Consumer<Command>, mixer: Mixer) -> Self {
        Self { commands, midi, mixer }
    }

    pub fn process(&mut self, out: &mut [f32]) {
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
}
