/// A small message from the control side to the audio thread. No heap data.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Command {
    PlayTestTone { frequency_hz: f32, seconds: f32, gain: f32 },
    StopAll,
    SetMasterVolume(f32),
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
}
