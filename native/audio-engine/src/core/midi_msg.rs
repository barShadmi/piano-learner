//! Raw MIDI bytes to events.

use crate::core::Command;

/// What the engine cares about in the MIDI stream.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MidiEvent {
    NoteOn { note: u8, velocity: u8 },
    NoteOff { note: u8 },
    Sustain(bool),
    AllNotesOff,
}

impl MidiEvent {
    /// The command for the audio thread. A Note On carries `midi_us`, the time
    /// the MIDI callback got it (see `core::clock`).
    pub fn into_command(self, midi_us: u64) -> Command {
        match self {
            MidiEvent::NoteOn { note, velocity } => Command::NoteOn { note, velocity, midi_us },
            other => other.into(),
        }
    }
}

impl From<MidiEvent> for Command {
    /// Unstamped (`midi_us` 0). The MIDI callback uses `into_command`.
    fn from(e: MidiEvent) -> Self {
        match e {
            MidiEvent::NoteOn { note, velocity } => Command::NoteOn { note, velocity, midi_us: 0 },
            MidiEvent::NoteOff { note } => Command::NoteOff { note },
            MidiEvent::Sustain(down) => Command::Sustain(down),
            MidiEvent::AllNotesOff => Command::AllNotesOff,
        }
    }
}

/// Read one complete MIDI message. Any channel. Note On with velocity 0 is a
/// Note Off. Returns `None` for everything else (active sensing, clock,
/// pitch bend, short or malformed messages). Never allocates.
pub fn parse(bytes: &[u8]) -> Option<MidiEvent> {
    let (&status, data) = bytes.split_first()?;
    if status & 0x80 == 0 {
        return None;
    }
    let (&d1, &d2) = (data.first()?, data.get(1)?);
    if (d1 | d2) & 0x80 != 0 {
        return None;
    }
    match status & 0xF0 {
        0x90 if d2 == 0 => Some(MidiEvent::NoteOff { note: d1 }),
        0x90 => Some(MidiEvent::NoteOn { note: d1, velocity: d2 }),
        0x80 => Some(MidiEvent::NoteOff { note: d1 }),
        0xB0 => match d1 {
            64 => Some(MidiEvent::Sustain(d2 >= 64)),
            120 | 123 => Some(MidiEvent::AllNotesOff),
            _ => None,
        },
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::Command;

    #[test]
    fn note_on_on_any_channel() {
        assert_eq!(parse(&[0x90, 60, 100]), Some(MidiEvent::NoteOn { note: 60, velocity: 100 }));
        assert_eq!(parse(&[0x95, 61, 1]), Some(MidiEvent::NoteOn { note: 61, velocity: 1 }));
        assert_eq!(parse(&[0x9F, 108, 127]), Some(MidiEvent::NoteOn { note: 108, velocity: 127 }));
    }

    #[test]
    fn note_on_with_velocity_zero_is_note_off() {
        assert_eq!(parse(&[0x90, 60, 0]), Some(MidiEvent::NoteOff { note: 60 }));
    }

    #[test]
    fn note_off_message_ignores_release_velocity() {
        assert_eq!(parse(&[0x80, 60, 0]), Some(MidiEvent::NoteOff { note: 60 }));
        assert_eq!(parse(&[0x83, 60, 99]), Some(MidiEvent::NoteOff { note: 60 }));
    }

    #[test]
    fn sustain_pedal_threshold_is_64() {
        assert_eq!(parse(&[0xB0, 64, 63]), Some(MidiEvent::Sustain(false)));
        assert_eq!(parse(&[0xB0, 64, 64]), Some(MidiEvent::Sustain(true)));
        assert_eq!(parse(&[0xB0, 64, 127]), Some(MidiEvent::Sustain(true)));
        assert_eq!(parse(&[0xB0, 64, 0]), Some(MidiEvent::Sustain(false)));
    }

    #[test]
    fn all_notes_off_from_cc123_and_cc120() {
        assert_eq!(parse(&[0xB0, 123, 0]), Some(MidiEvent::AllNotesOff));
        assert_eq!(parse(&[0xB2, 120, 0]), Some(MidiEvent::AllNotesOff));
    }

    #[test]
    fn other_channel_sustain_works() {
        assert_eq!(parse(&[0xB9, 64, 100]), Some(MidiEvent::Sustain(true)));
    }

    #[test]
    fn everything_else_is_ignored() {
        assert_eq!(parse(&[0xFE]), None, "active sensing");
        assert_eq!(parse(&[0xF8]), None, "clock");
        assert_eq!(parse(&[0xB0, 1, 50]), None, "mod wheel");
        assert_eq!(parse(&[0xC0, 5]), None, "program change");
        assert_eq!(parse(&[0xE0, 0, 64]), None, "pitch bend");
        assert_eq!(parse(&[0xA0, 60, 10]), None, "aftertouch");
        assert_eq!(parse(&[]), None);
    }

    #[test]
    fn short_or_invalid_messages_are_ignored() {
        assert_eq!(parse(&[0x90]), None);
        assert_eq!(parse(&[0x90, 60]), None);
        assert_eq!(parse(&[0xB0, 64]), None);
        assert_eq!(parse(&[60, 100, 100]), None, "no status byte");
        assert_eq!(parse(&[0x90, 200, 100]), None, "data byte with high bit");
    }

    #[test]
    fn events_convert_to_commands() {
        assert_eq!(
            Command::from(MidiEvent::NoteOn { note: 60, velocity: 90 }),
            Command::NoteOn { note: 60, velocity: 90, midi_us: 0 }
        );
        assert_eq!(Command::from(MidiEvent::NoteOff { note: 60 }), Command::NoteOff { note: 60 });
        assert_eq!(Command::from(MidiEvent::Sustain(true)), Command::Sustain(true));
        assert_eq!(Command::from(MidiEvent::AllNotesOff), Command::AllNotesOff);
    }

    #[test]
    fn a_stamp_goes_only_onto_note_on() {
        assert_eq!(
            MidiEvent::NoteOn { note: 60, velocity: 90 }.into_command(1234),
            Command::NoteOn { note: 60, velocity: 90, midi_us: 1234 }
        );
        assert_eq!(MidiEvent::NoteOff { note: 60 }.into_command(1234), Command::NoteOff { note: 60 });
        assert_eq!(MidiEvent::Sustain(true).into_command(9), Command::Sustain(true));
        assert_eq!(MidiEvent::AllNotesOff.into_command(9), Command::AllNotesOff);
    }

    #[test]
    fn parse_still_returns_the_same_events() {
        assert_eq!(parse(&[0x90, 60, 100]), Some(MidiEvent::NoteOn { note: 60, velocity: 100 }));
    }
}
