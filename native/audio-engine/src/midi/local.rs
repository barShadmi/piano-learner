//! The bytes that switch the piano's own speakers off and on (Local Control),
//! and what the engine knows about them. Pure: no ports, no threads.

/// What the engine knows about the piano's Local Control.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LocalState {
    /// Local Control was switched off: the piano's own speakers are quiet.
    Off,
    /// Local Control was switched on: the piano plays its own sound too.
    On,
    /// Not connected, or the piano has no output port we could write to.
    Unknown,
}

impl LocalState {
    pub fn as_str(self) -> &'static str {
        match self {
            LocalState::Off => "off",
            LocalState::On => "on",
            LocalState::Unknown => "unknown",
        }
    }

    pub(crate) fn to_u8(self) -> u8 {
        match self {
            LocalState::Off => 0,
            LocalState::On => 1,
            LocalState::Unknown => 2,
        }
    }

    pub(crate) fn from_u8(n: u8) -> Self {
        match n {
            0 => LocalState::Off,
            1 => LocalState::On,
            _ => LocalState::Unknown,
        }
    }
}

/// Control Change 122 on channel 1: `on` = true is 127 (piano speakers play),
/// false is 0 (piano speakers quiet).
pub fn local_control(on: bool) -> [u8; 3] {
    [0xB0, 122, if on { 127 } else { 0 }]
}

/// Control Change 123 on channel 1: All Notes Off.
pub fn all_notes_off() -> [u8; 3] {
    [0xB0, 123, 0]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_off_is_b0_7a_00() {
        assert_eq!(local_control(false), [0xB0, 0x7A, 0x00]);
    }

    #[test]
    fn local_on_is_b0_7a_7f() {
        assert_eq!(local_control(true), [0xB0, 0x7A, 0x7F]);
    }

    #[test]
    fn all_notes_off_is_b0_7b_00() {
        assert_eq!(all_notes_off(), [0xB0, 0x7B, 0x00]);
    }

    #[test]
    fn states_have_their_js_names_and_survive_a_round_trip() {
        for (s, name) in [(LocalState::Off, "off"), (LocalState::On, "on"), (LocalState::Unknown, "unknown")] {
            assert_eq!(s.as_str(), name);
            assert_eq!(LocalState::from_u8(s.to_u8()), s);
        }
    }
}
