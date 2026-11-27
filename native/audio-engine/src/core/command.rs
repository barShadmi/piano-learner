/// A small message from the control side to the audio thread. No heap data.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Command {
    PlayTestTone { frequency_hz: f32, seconds: f32, gain: f32 },
    StopAll,
    SetMasterVolume(f32),
    /// A piano key went down. `velocity` is 1..=127. `midi_us` is when the MIDI
    /// callback got the message, on the `core::clock` clock (0 = not stamped).
    NoteOn { note: u8, velocity: u8, midi_us: u64 },
    NoteOff { note: u8 },
    /// Sustain pedal: true = down.
    Sustain(bool),
    /// Release every note (also the ones the pedal holds).
    AllNotesOff,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_is_copy() {
        fn needs_copy<T: Copy>() {}
        needs_copy::<Command>();
        let c = Command::SetMasterVolume(0.5);
        let d = c;
        assert_eq!(c, d);
    }

    #[test]
    fn note_commands_are_copy_and_comparable() {
        let c = Command::NoteOn { note: 60, velocity: 90, midi_us: 7 };
        let d = c;
        assert_eq!(c, d);
        assert_ne!(Command::NoteOff { note: 60 }, Command::Sustain(true));
        assert_ne!(Command::AllNotesOff, Command::StopAll);
    }
}
