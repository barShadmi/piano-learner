# Latency report, round 1

The cloud machine that runs this review has no sound device and no MIDI piano, so the app's delay test cannot run here. The real number comes from Bar's gate check on his PC with the P-121 (Sound → Test the delay → Save report).

What can be checked here: the engine code paths (the reviewers read them), the Rust tests (`cargo test`, `cargo test --release`, including the no-allocation test of the audio callback and the release-build check that the piano loads in time), and the estimate the app uses: key-to-sound = MIDI arrival to the audio callback picking the note up, plus the output buffer and device latency, plus 1 ms for USB. At 128 samples and 48 kHz in WASAPI exclusive mode, the buffer is 2.7 ms.
