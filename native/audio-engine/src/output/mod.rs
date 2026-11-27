//! Output backends: they open the sound device and run `EngineCore` on the
//! render thread. Nothing here is called from the audio callback except the
//! small pure helpers.

use crate::core::{Command, EngineStats};
use crate::midi::{MidiSink, MIDI_CAPACITY};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard, PoisonError};
use std::thread::{self, JoinHandle};
use std::time::Duration;

pub mod cpal_out;
#[cfg(windows)]
pub mod wasapi_exclusive;
#[cfg(all(windows, feature = "asio"))]
pub mod asio_out;

/// Buffer size asked for when the caller does not say.
pub const DEFAULT_BUFFER_FRAMES: u32 = 128;
/// Room for pending commands between the JS side and the render thread.
pub const COMMAND_CAPACITY: usize = 256;
/// Gain of the test tone.
pub const TEST_TONE_GAIN: f32 = 0.25;

/// One sound output the player can choose.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OutputDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    /// "wasapi-exclusive", "wasapi-shared", "asio" or "cpal".
    pub backend: String,
}

/// What the caller asked for. Every field is optional.
#[derive(Clone, Debug, Default)]
pub struct StartConfig {
    pub device_id: Option<String>,
    pub backend: Option<String>,
    pub buffer_frames: Option<u32>,
}

/// What the backend actually opened.
#[derive(Clone, Debug, PartialEq)]
pub struct StartInfo {
    pub backend: String,
    pub device_name: String,
    pub sample_rate: u32,
    pub buffer_frames: u32,
    pub output_latency_ms: f64,
    pub fallback_reason: Option<String>,
}

/// Backend name used when none is given.
pub fn default_backend() -> &'static str {
    if cfg!(windows) {
        "wasapi-exclusive"
    } else {
        "cpal"
    }
}

/// Period in 100 ns units for `frames` at `sample_rate`: never shorter than the
/// device minimum, and always a whole number of frames (the rule IAudioClient
/// applies to exclusive event-driven buffers).
pub fn align_period(frames: u32, sample_rate: u32, min_period_100ns: i64) -> i64 {
    let sr = i64::from(sample_rate.max(1));
    let wanted = (i64::from(frames.max(1)) * 10_000_000 + sr / 2) / sr;
    if wanted >= min_period_100ns {
        return wanted;
    }
    // The minimum is not a whole number of frames: round up to the next frame.
    let whole_frames = (min_period_100ns * sr + 9_999_999) / 10_000_000;
    (whole_frames * 10_000_000 + sr / 2) / sr
}

/// f32 in -1..1 to a 16-bit sample: clamped, rounded to nearest, NaN is silence.
pub fn f32_to_i16(x: f32) -> i16 {
    if x.is_nan() {
        return 0;
    }
    (x.clamp(-1.0, 1.0) * 32_767.0).round() as i16
}

/// Message used when a driver refuses the buffer size we asked for.
pub const BUFFER_REFUSED: &str = "The sound device refused that buffer size.";

/// Snap a wanted buffer size to one the driver allows: inside `min..=max`, and
/// when the driver steps in `step` frames, `min + k * step`. `step` 0 or 1
/// means any size in range.
pub fn snap_buffer(requested: u32, min: u32, max: u32, step: u32) -> u32 {
    let max = max.max(min);
    let clamped = requested.clamp(min, max);
    if step <= 1 {
        return clamped;
    }
    let steps = (clamped - min + step / 2) / step;
    let snapped = min + steps * step;
    if snapped > max {
        snapped - step
    } else {
        snapped
    }
}

/// Output latency to report: the buffer itself plus what the driver says it
/// adds between the callback and the sound leaving (0 = not measured).
/// Callback-to-sound delay. When the driver gave a measured delay (cpal's
/// `playback - callback`), that already holds the queued buffer and hardware
/// delay, so it is used on its own. Otherwise the buffer length is the estimate.
pub fn latency_ms(buffer_frames: u32, sample_rate: u32, measured_us: u32) -> f64 {
    if measured_us > 0 {
        return f64::from(measured_us) / 1000.0;
    }
    f64::from(buffer_frames) * 1000.0 / f64::from(sample_rate.max(1))
}

/// f32 in -1..1 to a full-range 32-bit sample (clamped, NaN is silence).
pub fn f32_to_i32(x: f32) -> i32 {
    if x.is_nan() {
        return 0;
    }
    (f64::from(x.clamp(-1.0, 1.0)) * 2_147_483_647.0).round() as i32
}

/// f32 in -1..1 to a 24-bit sample held in the top of a 32-bit word, which is
/// how a "24 valid bits in a 32-bit container" format is laid out.
pub fn f32_to_i24_in_i32(x: f32) -> i32 {
    if x.is_nan() {
        return 0;
    }
    ((x.clamp(-1.0, 1.0) * 8_388_607.0).round() as i32) << 8
}

/// Plain-English text for the Windows audio error codes we can meet.
pub fn friendly_hresult(code: u32) -> String {
    match code {
        0x8889_000A => "The sound device is busy. Another app may be using it in exclusive mode.".into(),
        0x8889_0008 => "The sound device does not support the sound format Piano Learner needs.".into(),
        0x8889_000E => "Exclusive mode is turned off for this sound device in Windows settings.".into(),
        0x8889_0004 => "The sound device was unplugged or changed.".into(),
        0x8889_0020 | 0x8889_0019 => "The sound device does not allow that buffer size.".into(),
        0x8889_0001 => "The sound system is not ready.".into(),
        other => format!("The sound device could not be opened (error 0x{other:08X})."),
    }
}

/// Every sound output on this PC. A PC with no sound system gives an empty list.
pub fn list_outputs() -> Result<Vec<OutputDevice>, String> {
    #[cfg(windows)]
    {
        #[allow(unused_mut)]
        let mut all = wasapi_exclusive::list();
        #[cfg(feature = "asio")]
        all.extend(asio_out::list());
        Ok(all)
    }
    #[cfg(not(windows))]
    {
        Ok(cpal_out::list(&cpal::default_host(), "cpal"))
    }
}

/// A running output. Dropping it (or `stop`) ends the render thread.
pub struct Running {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Running {
    pub fn stop(mut self) {
        self.shut_down();
    }

    fn shut_down(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(t) = self.thread.take() {
            t.thread().unpark();
            let _ = t.join();
        }
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        self.shut_down();
    }
}

/// How long a backend may take to open the device.
const OPEN_TIMEOUT: Duration = Duration::from_secs(15);

/// Run `body` on its own thread (which owns the sound stream). `body` must
/// send exactly one message on `ready` once the stream plays or has failed,
/// then keep running until `stop` is set. A body that opens the device late
/// must check `stop` right after opening and give the device back.
pub(crate) fn spawn_backend<F>(name: &str, body: F) -> Result<(Running, StartInfo), String>
where
    F: FnOnce(Arc<AtomicBool>, mpsc::Sender<Result<StartInfo, String>>) + Send + 'static,
{
    spawn_backend_with_timeout(name, OPEN_TIMEOUT, body)
}

pub(crate) fn spawn_backend_with_timeout<F>(
    name: &str,
    timeout: Duration,
    body: F,
) -> Result<(Running, StartInfo), String>
where
    F: FnOnce(Arc<AtomicBool>, mpsc::Sender<Result<StartInfo, String>>) + Send + 'static,
{
    let stop = Arc::new(AtomicBool::new(false));
    let (ready_tx, ready_rx) = mpsc::channel();
    let thread_stop = Arc::clone(&stop);
    let thread = thread::Builder::new()
        .name(name.to_string())
        .spawn(move || body(thread_stop, ready_tx))
        .map_err(|_| "Sound could not start (the computer refused a new thread).".to_string())?;
    match ready_rx.recv_timeout(timeout) {
        Ok(Ok(info)) => Ok((Running { stop, thread: Some(thread) }, info)),
        Ok(Err(reason)) => {
            let _ = thread.join();
            Err(reason)
        }
        Err(_) => {
            // The thread is left to finish on its own: it sees `stop` (and the
            // closed channel) as soon as the device opens and gives it back.
            stop.store(true, Ordering::Release);
            thread.thread().unpark();
            Err("The sound device did not answer in time.".to_string())
        }
    }
}

/// The rings the render thread reads: commands from the control side, and
/// notes from the MIDI thread (a ring of its own, so it has one producer).
pub struct Inbox {
    pub commands: rtrb::Consumer<Command>,
    pub midi: rtrb::Consumer<Command>,
}

/// The other ends of an `Inbox`.
pub struct Outbox {
    pub commands: rtrb::Producer<Command>,
    pub midi: rtrb::Producer<Command>,
}

/// New rings for one output start.
pub fn rings(command_capacity: usize, midi_capacity: usize) -> (Outbox, Inbox) {
    let (commands_tx, commands_rx) = rtrb::RingBuffer::new(command_capacity);
    let (midi_tx, midi_rx) = rtrb::RingBuffer::new(midi_capacity);
    (Outbox { commands: commands_tx, midi: midi_tx }, Inbox { commands: commands_rx, midi: midi_rx })
}

/// What a backend hands back once it plays.
pub type Opened = (Running, StartInfo, Outbox);

/// Open the output the config asks for, falling back from exclusive to shared
/// on Windows.
pub fn open(cfg: &StartConfig, stats: &Arc<EngineStats>) -> Result<Opened, String> {
    let backend = cfg.backend.as_deref().unwrap_or(default_backend());
    let frames = cfg.buffer_frames.unwrap_or(DEFAULT_BUFFER_FRAMES);
    let device = cfg.device_id.clone();
    match backend {
        "cpal" => open_cpal(device, frames, false, stats),
        #[cfg(windows)]
        "wasapi-exclusive" => match open_wasapi(device.clone(), frames, true, stats) {
            Ok(opened) => Ok(opened),
            Err(reason) => {
                let (running, mut info, tx) = open_wasapi(device, frames, false, stats)?;
                info.fallback_reason = Some(reason);
                Ok((running, info, tx))
            }
        },
        #[cfg(windows)]
        "wasapi-shared" => open_wasapi(device, frames, false, stats),
        "asio" => open_cpal(device, frames, true, stats),
        #[cfg(not(windows))]
        "wasapi-exclusive" | "wasapi-shared" => {
            Err("WASAPI sound is only available on Windows.".to_string())
        }
        other => Err(format!("Unknown sound backend: {other}.")),
    }
}

/// Open through cpal (`asio` picks the ASIO host). If the driver refuses the
/// fixed buffer size, try once more with the driver's own preferred size.
fn open_cpal(
    device: Option<String>,
    frames: u32,
    asio: bool,
    stats: &Arc<EngineStats>,
) -> Result<Opened, String> {
    #[cfg(not(all(windows, feature = "asio")))]
    if asio {
        return Err("ASIO is not available in this version of Piano Learner.".to_string());
    }
    let attempt = |prefer_default: bool| {
        let (tx, rx) = rings(COMMAND_CAPACITY, MIDI_CAPACITY);
        let stats = Arc::clone(stats);
        let device = device.clone();
        let (running, info) = spawn_backend("audio-cpal", move |stop, ready| {
            #[cfg(all(windows, feature = "asio"))]
            if asio {
                return asio_out::run(device, frames, prefer_default, rx, stats, stop, ready);
            }
            cpal_out::run(cpal::default_host(), "cpal", device, frames, prefer_default, rx, stats, stop, ready)
        })?;
        Ok::<Opened, String>((running, info, tx))
    };
    match attempt(false) {
        Err(reason) if reason == BUFFER_REFUSED => attempt(true),
        other => other,
    }
}

#[cfg(windows)]
fn open_wasapi(
    device: Option<String>,
    frames: u32,
    exclusive: bool,
    stats: &Arc<EngineStats>,
) -> Result<Opened, String> {
    let (tx, rx) = rings(COMMAND_CAPACITY, MIDI_CAPACITY);
    let stats = Arc::clone(stats);
    let (running, info) = spawn_backend("audio-wasapi", move |stop, ready| {
        wasapi_exclusive::run(device, frames, exclusive, rx, stats, stop, ready)
    })?;
    Ok((running, info, tx))
}

struct Session {
    running: Running,
    info: StartInfo,
    commands: rtrb::Producer<Command>,
}

struct State {
    volume: f32,
    generation: u64,
    session: Option<Session>,
}

/// Control side of the engine. The state lock is only held for quick
/// bookkeeping, never while a device opens or closes, so `status`, `stop`,
/// tone and volume calls never wait for a slow `start`. The audio thread never
/// touches any of this.
pub struct Engine {
    stats: Arc<EngineStats>,
    state: Mutex<State>,
    starting: AtomicBool,
    midi: Arc<MidiSink>,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

/// Clears the "starting" flag however `start_with` ends.
struct StartingFlag<'a>(&'a AtomicBool);

impl Drop for StartingFlag<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

impl Engine {
    pub fn new() -> Self {
        Self {
            stats: Arc::new(EngineStats::default()),
            state: Mutex::new(State { volume: 1.0, generation: 0, session: None }),
            starting: AtomicBool::new(false),
            midi: Arc::new(MidiSink::default()),
        }
    }

    /// Where the MIDI thread sends notes. It points at the running output's
    /// MIDI ring, and at nothing while no output runs.
    pub fn midi_sink(&self) -> &Arc<MidiSink> {
        &self.midi
    }

    fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn stats(&self) -> &Arc<EngineStats> {
        &self.stats
    }

    pub fn info(&self) -> Option<StartInfo> {
        self.state().session.as_ref().map(|s| s.info.clone())
    }

    /// Start with the real backends.
    pub fn start(&self, cfg: &StartConfig) -> Result<StartInfo, String> {
        self.start_with(cfg, open)
    }

    /// Start with a given opener (tests give a fake one). Any running output is
    /// stopped first, so there is never more than one. A second `start` while
    /// one is still opening is turned away with "Sound is already starting."
    pub fn start_with<F>(&self, cfg: &StartConfig, opener: F) -> Result<StartInfo, String>
    where
        F: FnOnce(&StartConfig, &Arc<EngineStats>) -> Result<Opened, String>,
    {
        if let Some(f) = cfg.buffer_frames {
            if !(16..=8192).contains(&f) {
                return Err("The buffer size must be between 16 and 8192 samples.".to_string());
            }
        }
        if self.starting.swap(true, Ordering::AcqRel) {
            return Err("Sound is already starting.".to_string());
        }
        let _flag = StartingFlag(&self.starting);
        let (old, generation) = {
            let mut st = self.state();
            (st.session.take(), st.generation)
        };
        self.midi.set(None);
        if let Some(old) = old {
            old.running.stop();
        }
        self.stats.reset();
        let (running, info, outbox) = opener(cfg, &self.stats)?;
        let Outbox { mut commands, midi } = outbox;
        let mut st = self.state();
        if st.generation != generation {
            drop(st);
            running.stop();
            self.stats.running.store(false, Ordering::Release);
            return Err("Sound was stopped before it finished starting.".to_string());
        }
        if st.volume < 1.0 {
            let _ = commands.push(Command::SetMasterVolume(st.volume));
        }
        st.session = Some(Session { running, info: info.clone(), commands });
        self.midi.set(Some(midi));
        Ok(info)
    }

    /// Stop the output. Fine when nothing is running. Also cancels a start
    /// that is still opening.
    pub fn stop(&self) {
        let old = {
            let mut st = self.state();
            st.generation += 1;
            st.session.take()
        };
        self.midi.set(None);
        if let Some(s) = old {
            s.running.stop();
            self.stats.running.store(false, Ordering::Release);
        }
    }

    pub fn play_test_tone(&self, frequency_hz: f32, seconds: f32) -> Result<(), String> {
        let mut st = self.state();
        let s = st.session.as_mut().ok_or("Sound is not started.")?;
        let nyquist = s.info.sample_rate as f32 / 2.0;
        if !(frequency_hz.is_finite() && frequency_hz >= 20.0 && frequency_hz < nyquist) {
            return Err("The test pitch must be between 20 Hz and the highest pitch the device can play.".to_string());
        }
        if !(seconds.is_finite() && seconds > 0.0 && seconds <= 30.0) {
            return Err("The test sound must last between 0 and 30 seconds.".to_string());
        }
        s.commands
            .push(Command::PlayTestTone { frequency_hz, seconds, gain: TEST_TONE_GAIN })
            .map_err(|_| "Sound is busy. Try again in a moment.".to_string())
    }

    pub fn set_volume(&self, volume: f32) -> Result<(), String> {
        if !(volume.is_finite() && (0.0..=1.0).contains(&volume)) {
            return Err("Volume must be between 0 and 1.".to_string());
        }
        let mut st = self.state();
        st.volume = volume;
        if let Some(s) = st.session.as_mut() {
            s.commands
                .push(Command::SetMasterVolume(volume))
                .map_err(|_| "Sound is busy. Try again in a moment.".to_string())?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn align_period_converts_frames_to_100ns() {
        // 128 frames at 48 kHz = 2.6667 ms.
        assert_eq!(align_period(128, 48_000, 0), 26_667);
    }

    #[test]
    fn align_period_uses_the_device_minimum_when_larger() {
        // Minimum 10 ms = exactly 480 frames at 48 kHz.
        assert_eq!(align_period(128, 48_000, 100_000), 100_000);
    }

    #[test]
    fn align_period_rounds_a_minimum_up_to_whole_frames() {
        // 3.3333 ms is 159.9984 frames: the period must cover 160 whole frames.
        let p = align_period(16, 48_000, 33_333);
        assert_eq!(p, 33_333);
        let frames = (p * 48_000 + 9_999_999) / 10_000_000;
        assert_eq!(frames, 160);
    }

    #[test]
    fn align_period_never_returns_zero_frames() {
        assert!(align_period(0, 48_000, 0) > 0);
    }

    #[test]
    fn i16_conversion_rounds_to_nearest() {
        assert_eq!(f32_to_i16(0.0), 0);
        assert_eq!(f32_to_i16(0.5), 16_384); // 16383.5 rounds away from zero
        assert_eq!(f32_to_i16(-0.5), -16_384);
        assert_eq!(f32_to_i16(1.0 / 32_767.0), 1);
    }

    #[test]
    fn i16_conversion_clamps_and_survives_bad_input() {
        assert_eq!(f32_to_i16(1.0), 32_767);
        assert_eq!(f32_to_i16(2.5), 32_767);
        assert_eq!(f32_to_i16(-1.0), -32_767);
        assert_eq!(f32_to_i16(-9.0), -32_767);
        assert_eq!(f32_to_i16(f32::NAN), 0);
        assert_eq!(f32_to_i16(f32::INFINITY), 32_767);
    }

    #[test]
    fn snap_buffer_keeps_sizes_in_range_and_clamps_the_rest() {
        assert_eq!(snap_buffer(128, 64, 2048, 0), 128);
        assert_eq!(snap_buffer(128, 64, 2048, 1), 128);
        assert_eq!(snap_buffer(16, 64, 2048, 0), 64);
        assert_eq!(snap_buffer(9000, 64, 2048, 0), 2048);
    }

    #[test]
    fn snap_buffer_lands_on_min_plus_whole_steps() {
        assert_eq!(snap_buffer(130, 64, 2048, 64), 128);
        assert_eq!(snap_buffer(200, 64, 2048, 64), 192);
        assert_eq!(snap_buffer(2047, 64, 2048, 64), 2048);
        // Rounding up would pass the maximum: step down instead.
        assert_eq!(snap_buffer(99, 10, 99, 30), 70);
        for req in 1..3000u32 {
            let v = snap_buffer(req, 48, 1920, 48);
            assert!((48..=1920).contains(&v) && (v - 48).is_multiple_of(48), "{req} -> {v}");
        }
    }

    #[test]
    fn latency_is_buffer_plus_measured_driver_delay() {
        assert!((latency_ms(128, 48_000, 0) - 2.6667).abs() < 0.001);
        assert!((latency_ms(128, 48_000, 4_100) - 4.1).abs() < 0.001);
    }

    #[test]
    fn i32_conversions_clamp_and_survive_bad_input() {
        assert_eq!(f32_to_i32(0.0), 0);
        assert_eq!(f32_to_i32(1.0), 2_147_483_647);
        assert_eq!(f32_to_i32(7.0), 2_147_483_647);
        assert_eq!(f32_to_i32(-1.0), -2_147_483_647);
        assert_eq!(f32_to_i32(f32::NAN), 0);
        assert_eq!(f32_to_i24_in_i32(0.0), 0);
        assert_eq!(f32_to_i24_in_i32(1.0), 8_388_607 << 8);
        assert_eq!(f32_to_i24_in_i32(-1.0), -(8_388_607 << 8));
        assert_eq!(f32_to_i24_in_i32(3.0), 8_388_607 << 8);
        assert_eq!(f32_to_i24_in_i32(f32::NAN), 0);
        // The low byte of a 24-in-32 sample is always empty.
        assert_eq!(f32_to_i24_in_i32(0.3) & 0xFF, 0);
    }

    #[test]
    fn list_outputs_succeeds_even_without_a_sound_card() {
        let outputs = list_outputs().expect("listing must not fail");
        for o in &outputs {
            assert!(!o.id.is_empty() && !o.name.is_empty());
        }
    }

    #[test]
    fn busy_device_error_is_plain_english() {
        let msg = friendly_hresult(0x8889_000A);
        assert_eq!(msg, "The sound device is busy. Another app may be using it in exclusive mode.");
        assert!(friendly_hresult(0x1234_5678).contains("0x12345678"));
    }

    /// A fake output: logs when it opens and when its thread ends.
    fn fake_opener(
        log: Arc<Mutex<Vec<String>>>,
        name: &'static str,
    ) -> impl FnOnce(&StartConfig, &Arc<EngineStats>) -> Result<Opened, String> {
        move |_cfg, _stats| {
            let (tx, _rx) = rings(8, 8);
            log.lock().unwrap().push(format!("open {name}"));
            let thread_log = Arc::clone(&log);
            let (running, info) = spawn_backend("fake", move |stop, ready| {
                let info = StartInfo {
                    backend: "cpal".into(),
                    device_name: name.into(),
                    sample_rate: 48_000,
                    buffer_frames: 128,
                    output_latency_ms: 2.7,
                    fallback_reason: None,
                };
                let _ = ready.send(Ok(info));
                while !stop.load(Ordering::Acquire) {
                    thread::park_timeout(Duration::from_millis(20));
                }
                thread_log.lock().unwrap().push(format!("close {name}"));
            })?;
            Ok((running, info, tx))
        }
    }

    /// An opener whose MIDI consumer the test keeps.
    fn midi_opener(
        slot: Arc<Mutex<Option<rtrb::Consumer<Command>>>>,
    ) -> impl FnOnce(&StartConfig, &Arc<EngineStats>) -> Result<Opened, String> {
        move |_cfg, _stats| {
            let (out, inbox) = rings(8, 8);
            *slot.lock().unwrap() = Some(inbox.midi);
            let (running, info) = spawn_backend("fake", move |stop, ready| {
                let _keep = inbox.commands;
                let _ = ready.send(Ok(fake_info("fake")));
                while !stop.load(Ordering::Acquire) {
                    thread::park_timeout(Duration::from_millis(20));
                }
            })?;
            Ok((running, info, out))
        }
    }

    #[test]
    fn each_start_hands_a_fresh_midi_ring_to_the_midi_side() {
        let e = Engine::new();
        let key = Command::NoteOn { note: 60, velocity: 90 };
        let first = Arc::new(Mutex::new(None));
        e.start_with(&StartConfig::default(), midi_opener(Arc::clone(&first))).unwrap();
        assert!(e.midi_sink().push(key));
        let second = Arc::new(Mutex::new(None));
        e.start_with(&StartConfig::default(), midi_opener(Arc::clone(&second))).unwrap();
        assert!(e.midi_sink().push(key));
        let mut first = first.lock().unwrap().take().unwrap();
        let mut second = second.lock().unwrap().take().unwrap();
        assert_eq!(first.pop(), Ok(key));
        assert!(first.pop().is_err(), "the old ring gets nothing after the restart");
        assert_eq!(second.pop(), Ok(key));
        e.stop();
        assert!(e.midi_sink().push(key), "after stop there is no output to send to, not an error");
        assert!(second.pop().is_err(), "nothing reaches a stopped output");
    }

    #[test]
    fn starting_twice_stops_the_first_output_before_opening_the_second() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let e = Engine::new();
        e.start_with(&StartConfig::default(), fake_opener(Arc::clone(&log), "one")).unwrap();
        e.start_with(&StartConfig::default(), fake_opener(Arc::clone(&log), "two")).unwrap();
        assert_eq!(*log.lock().unwrap(), vec!["open one", "close one", "open two"]);
        e.stop();
        assert_eq!(log.lock().unwrap().last().unwrap(), "close two");
    }

    #[test]
    fn stop_when_not_started_is_fine_and_repeatable() {
        let e = Engine::new();
        e.stop();
        e.stop();
        assert!(e.info().is_none());
    }

    #[test]
    fn a_failed_start_reports_the_reason_and_leaves_nothing_running() {
        let e = Engine::new();
        let err = e
            .start_with(&StartConfig::default(), |_, _| Err("No sound output was found.".to_string()))
            .unwrap_err();
        assert_eq!(err, "No sound output was found.");
        assert!(e.info().is_none());
    }

    #[test]
    fn tone_and_volume_need_a_running_output_and_sane_numbers() {
        let log = Arc::new(Mutex::new(Vec::new()));
        let e = Engine::new();
        assert_eq!(e.play_test_tone(440.0, 1.0).unwrap_err(), "Sound is not started.");
        e.start_with(&StartConfig::default(), fake_opener(log, "one")).unwrap();
        assert!(e.play_test_tone(440.0, 1.0).is_ok());
        assert!(e.play_test_tone(30_000.0, 1.0).is_err());
        assert!(e.play_test_tone(f32::NAN, 1.0).is_err());
        assert!(e.play_test_tone(440.0, 0.0).is_err());
        assert!(e.set_volume(0.5).is_ok());
        assert!(e.set_volume(1.5).is_err());
        assert!(e.set_volume(f32::NAN).is_err());
    }

    #[test]
    fn a_silly_buffer_size_is_refused_before_anything_opens() {
        let e = Engine::new();
        let cfg = StartConfig { buffer_frames: Some(1), ..StartConfig::default() };
        assert!(e.start_with(&cfg, |_, _| panic!("must not open")).is_err());
    }

    #[test]
    fn unknown_device_and_backend_give_plain_errors() {
        let stats = Arc::new(EngineStats::default());
        let cfg = StartConfig { backend: Some("cpal".into()), device_id: Some("nonsense".into()), buffer_frames: None };
        assert_eq!(open(&cfg, &stats).err().unwrap(), "That sound output was not found.");
        let cfg = StartConfig { backend: Some("tin-can".into()), ..StartConfig::default() };
        assert_eq!(open(&cfg, &stats).err().unwrap(), "Unknown sound backend: tin-can.");
    }

    #[test]
    fn start_without_a_sound_card_fails_cleanly_with_a_plain_message() {
        let e = Engine::new();
        // Either a card exists (fine) or the message is plain English.
        match e.start(&StartConfig::default()) {
            Ok(_) => e.stop(),
            Err(msg) => assert!(msg.ends_with('.') && !msg.contains("Error {"), "{msg}"),
        }
    }

    fn fake_info(name: &str) -> StartInfo {
        StartInfo {
            backend: "cpal".into(),
            device_name: name.into(),
            sample_rate: 48_000,
            buffer_frames: 128,
            output_latency_ms: 2.7,
            fallback_reason: None,
        }
    }

    /// An opener that waits until `gate` is released, like a slow device.
    fn slow_opener(
        gate: mpsc::Receiver<()>,
        opening: mpsc::Sender<()>,
    ) -> impl FnOnce(&StartConfig, &Arc<EngineStats>) -> Result<Opened, String> {
        move |_cfg, _stats| {
            let (tx, _rx) = rings(8, 8);
            let _ = opening.send(());
            let _ = gate.recv();
            let (running, info) = spawn_backend("slow", |stop, ready| {
                let _ = ready.send(Ok(fake_info("slow")));
                while !stop.load(Ordering::Acquire) {
                    thread::park_timeout(Duration::from_millis(20));
                }
            })?;
            Ok((running, info, tx))
        }
    }

    #[test]
    fn a_second_start_while_one_is_opening_is_turned_away() {
        let e = Arc::new(Engine::new());
        let (gate_tx, gate_rx) = mpsc::channel();
        let (open_tx, open_rx) = mpsc::channel();
        let e2 = Arc::clone(&e);
        let first = thread::spawn(move || e2.start_with(&StartConfig::default(), slow_opener(gate_rx, open_tx)));
        open_rx.recv().unwrap(); // the first start is now inside its opener
        let second = e.start_with(&StartConfig::default(), |_, _| panic!("must not open"));
        assert_eq!(second.unwrap_err(), "Sound is already starting.");
        gate_tx.send(()).unwrap();
        assert!(first.join().unwrap().is_ok());
        e.stop();
    }

    #[test]
    fn status_calls_do_not_wait_for_a_slow_start() {
        let e = Arc::new(Engine::new());
        let (gate_tx, gate_rx) = mpsc::channel();
        let (open_tx, open_rx) = mpsc::channel();
        let e2 = Arc::clone(&e);
        let first = thread::spawn(move || e2.start_with(&StartConfig::default(), slow_opener(gate_rx, open_tx)));
        open_rx.recv().unwrap();
        // All of these must return at once although the opener is still blocked.
        assert!(e.info().is_none());
        e.stop();
        assert_eq!(e.play_test_tone(440.0, 1.0).unwrap_err(), "Sound is not started.");
        assert!(e.set_volume(0.5).is_ok());
        gate_tx.send(()).unwrap();
        // stop() was called during the start, so the new output is thrown away.
        assert_eq!(
            first.join().unwrap().unwrap_err(),
            "Sound was stopped before it finished starting."
        );
        assert!(e.info().is_none());
    }

    #[test]
    fn each_start_resets_the_counters() {
        let e = Engine::new();
        e.stats().callbacks.store(99, Ordering::Relaxed);
        e.stats().underruns.store(7, Ordering::Relaxed);
        e.start_with(&StartConfig::default(), |_, stats| {
            assert_eq!(stats.callbacks.load(Ordering::Relaxed), 0);
            assert_eq!(stats.underruns.load(Ordering::Relaxed), 0);
            Err("stop here".to_string())
        })
        .unwrap_err();
    }

    #[test]
    fn a_device_that_opens_after_the_timeout_is_told_to_stop() {
        let saw_stop = Arc::new(AtomicBool::new(false));
        let seen = Arc::clone(&saw_stop);
        let r = spawn_backend_with_timeout("late", Duration::from_millis(30), move |stop, ready| {
            thread::sleep(Duration::from_millis(200)); // the device is slow to open
            seen.store(stop.load(Ordering::Acquire), Ordering::Release);
            // Nobody is listening any more: the backend must give up.
            let _ = ready.send(Ok(fake_info("late")));
        });
        assert_eq!(r.err().unwrap(), "The sound device did not answer in time.");
        thread::sleep(Duration::from_millis(400));
        assert!(saw_stop.load(Ordering::Acquire), "late thread was never told to stop");
    }
}
