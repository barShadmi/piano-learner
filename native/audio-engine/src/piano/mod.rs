//! Sampled grand piano: the sample bank, the sample voice and the limiter.
//!
//! Loading (`bank`) happens on a background thread. Everything the audio
//! thread touches (`voice`, `limiter`, lookups on a finished bank) never
//! allocates, locks or frees.

pub mod bank;
pub mod limiter;
pub mod voice;

pub use bank::{layer_for_velocity, parse_file_name, Choice, Sample, SampleBank};
pub use limiter::soft_limit;
pub use voice::PianoVoice;

/// Handoff of a finished bank to a running audio thread.
///
/// The control side keeps the `BankSender`, the audio thread owns the
/// `BankReceiver`. A bank goes in through one rtrb ring; a bank the audio
/// thread replaces goes back through the other, so the audio thread never
/// frees one.
pub struct BankSender {
    to_audio: rtrb::Producer<std::sync::Arc<SampleBank>>,
    from_audio: rtrb::Consumer<std::sync::Arc<SampleBank>>,
}

/// The audio-thread half of the handoff.
pub struct BankReceiver {
    from_control: rtrb::Consumer<std::sync::Arc<SampleBank>>,
    to_control: rtrb::Producer<std::sync::Arc<SampleBank>>,
}

/// Make a linked pair. `capacity` is the size of each ring.
pub fn bank_link(capacity: usize) -> (BankSender, BankReceiver) {
    let capacity = capacity.max(1);
    let (to_audio, from_control) = rtrb::RingBuffer::new(capacity);
    let (to_control, from_audio) = rtrb::RingBuffer::new(capacity);
    (BankSender { to_audio, from_audio }, BankReceiver { from_control, to_control })
}

impl BankSender {
    /// Hand a bank to the audio thread. Returns it if the ring is full.
    /// Also drops banks the audio thread has handed back.
    pub fn send(&mut self, bank: std::sync::Arc<SampleBank>) -> Result<(), std::sync::Arc<SampleBank>> {
        self.reclaim();
        self.to_audio.push(bank).map_err(|rtrb::PushError::Full(b)| b)
    }

    /// Drop every bank the audio thread has handed back. Call this from a
    /// control thread (the engine does it on start, stop and status calls).
    /// Returns how many were dropped.
    pub fn reclaim(&mut self) -> usize {
        let mut n = 0;
        while self.from_audio.pop().is_ok() {
            n += 1;
        }
        n
    }
}

impl BankReceiver {
    /// Audio thread: the next new bank, if any. A bank is only taken while the
    /// return ring has room for the one it replaces, so nothing is ever freed
    /// here.
    pub(crate) fn next_bank(&mut self) -> Option<std::sync::Arc<SampleBank>> {
        if self.to_control.slots() == 0 {
            return None;
        }
        self.from_control.pop().ok()
    }

    /// Audio thread: hand a replaced bank back. There is always room (see
    /// `next_bank`); if there somehow were not, the bank is leaked rather
    /// than freed on the audio thread.
    pub(crate) fn give_back(&mut self, old: std::sync::Arc<SampleBank>) {
        if let Err(rtrb::PushError::Full(b)) = self.to_control.push(old) {
            std::mem::forget(b);
        }
    }
}

#[cfg(test)]
pub(crate) mod testing {
    use super::bank::{Sample, SampleBank};

    /// A stereo 48 kHz sine "sample" at `hz`, `amp` of full scale.
    pub fn sine_sample(note: u8, layer: u8, hz: f64, amp: f64, seconds: f64) -> Sample {
        let frames = (48_000.0 * seconds) as usize;
        let mut data = Vec::with_capacity(frames * 2);
        for i in 0..frames {
            let v = ((2.0 * std::f64::consts::PI * hz * i as f64 / 48_000.0).sin() * amp * 32767.0) as i16;
            data.push(v);
            data.push(v);
        }
        Sample::new(note, layer, 48_000, 2, data)
    }

    pub fn note_hz(note: u8) -> f64 {
        440.0 * 2f64.powf((f64::from(note) - 69.0) / 12.0)
    }

    /// Every minor third A0..C8 on all four layers; each sample sounds at its
    /// own pitch. Layer amplitude grows 0.1, 0.2, 0.4, 0.8.
    pub fn grid_bank(seconds: f64) -> SampleBank {
        let mut v = Vec::new();
        for layer in 0..4u8 {
            let amp = 0.1 * f64::from(1u8 << layer);
            let mut n = 21u8;
            while n <= 108 {
                v.push(sine_sample(n, layer, note_hz(n), amp, seconds));
                n += 3;
            }
        }
        SampleBank::from_samples(v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn bank() -> Arc<SampleBank> {
        Arc::new(SampleBank::from_samples(vec![]))
    }

    #[test]
    fn a_bank_is_only_taken_while_the_return_ring_has_room_for_the_one_it_replaces() {
        let (mut sender, mut receiver) = bank_link(1);
        let (a, b) = (bank(), bank());
        sender.send(Arc::clone(&a)).unwrap();
        assert!(Arc::ptr_eq(&receiver.next_bank().unwrap(), &a));
        receiver.give_back(Arc::clone(&a)); // the return ring (size 1) is now full
        sender.to_audio.push(Arc::clone(&b)).unwrap();
        assert!(receiver.next_bank().is_none(), "no room to give the old one back yet");
        assert_eq!(sender.reclaim(), 1);
        assert!(Arc::ptr_eq(&receiver.next_bank().unwrap(), &b));
    }

    #[test]
    fn send_hands_back_the_bank_when_the_ring_is_full() {
        let (mut sender, _receiver) = bank_link(1);
        sender.send(bank()).unwrap();
        assert!(sender.send(bank()).is_err());
    }
}
