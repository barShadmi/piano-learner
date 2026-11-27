//! Output backends: they open the sound device and run `EngineCore` on the
//! render thread. Nothing here is called from the audio callback except the
//! small pure helpers.

use crate::core::{clock, Command, EngineStats, LatencySample, MidiInput};
use crate::midi::{MidiSink, MIDI_CAPACITY};
use crate::piano::{bank_link, BankReceiver, BankSender, SampleBank};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard, PoisonError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

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

/// Output latency in milliseconds: the time from the callback to the sound
/// leaving the device. A measured figure (cpal's `playback - callback`, given
/// as `measured_us`) already holds the queued buffer and the hardware delay,
/// so it is used on its own. With no measured figure (0), the buffer length is
/// the estimate.
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
        0x8889_000A => "The sound device is busy. Another app may be using it on its own. Close other sound apps and press Try again.".into(),
        0x8889_0008 => "The sound device does not support the sound format PianoLearner needs.".into(),
        0x8889_000E => "Exclusive mode is turned off for this sound device in Windows settings.".into(),
        0x8889_0004 => "The sound device was unplugged or changed.".into(),
        0x8889_0020 | 0x8889_0019 => "The sound device does not allow that buffer size.".into(),
        0x8889_0001 => "The sound system is not ready.".into(),
        _ => "The sound device could not be opened.".into(),
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
/// `banks` brings the piano sound (see `piano::bank_link`).
pub struct Inbox {
    pub commands: rtrb::Consumer<Command>,
    /// The MIDI ring, with the producer the audio thread reports key timing on.
    pub midi: MidiInput,
    /// Notes from the song player (a ring of its own, never timed).
    pub song: rtrb::Consumer<Command>,
    pub banks: BankReceiver,
}

/// The other ends of an `Inbox`.
pub struct Outbox {
    pub commands: rtrb::Producer<Command>,
    pub midi: rtrb::Producer<Command>,
    pub song: rtrb::Producer<Command>,
    pub banks: BankSender,
    /// Key timing from the audio thread.
    pub latency: rtrb::Consumer<LatencySample>,
}

/// Room for pending song notes between the song player and the audio thread.
/// The player retries a refused note, so a full ring only delays it.
pub const SONG_CAPACITY: usize = 1024;

/// Room for key timing samples the control side has not collected yet.
pub const LATENCY_RING_CAPACITY: usize = 256;

/// Room in each ring of a bank link. Only one bank is ever sent per output.
const BANK_LINK_CAPACITY: usize = 2;

/// New rings for one output start.
pub fn rings(command_capacity: usize, midi_capacity: usize) -> (Outbox, Inbox) {
    let (commands_tx, commands_rx) = rtrb::RingBuffer::new(command_capacity);
    let (midi_tx, midi_rx) = rtrb::RingBuffer::new(midi_capacity);
    let (banks_tx, banks_rx) = bank_link(BANK_LINK_CAPACITY);
    let (song_tx, song_rx) = rtrb::RingBuffer::new(SONG_CAPACITY);
    let (latency_tx, latency_rx) = rtrb::RingBuffer::new(LATENCY_RING_CAPACITY);
    (
        Outbox { commands: commands_tx, midi: midi_tx, song: song_tx, banks: banks_tx, latency: latency_rx },
        Inbox {
            commands: commands_rx,
            midi: MidiInput::new(midi_rx, latency_tx),
            song: song_rx,
            banks: banks_rx,
        },
    )
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
        other => Err(format!("Unknown sound mode: {other}.")),
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
        return Err("ASIO is not available in this version of PianoLearner.".to_string());
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
    banks: BankSender,
    latency: rtrb::Consumer<LatencySample>,
}

/// What a key adds between the piano and the app that the app cannot measure:
/// USB full-speed MIDI transport. A fixed estimate, and the report says so.
pub const USB_MIDI_MS: f64 = 1.0;
/// How many key timings the engine remembers.
pub const LATENCY_HISTORY: usize = 200;

/// One key press, in milliseconds.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LatencyReading {
    pub note: u8,
    /// MIDI callback to the start of the audio callback that picked it up.
    pub wait_ms: f64,
    /// From that callback to the sound leaving the device.
    pub output_ms: f64,
    /// `wait_ms + output_ms + USB_MIDI_MS`.
    pub total_ms: f64,
}

/// Turn the audio thread's stamps into milliseconds. `output_ms` is the
/// session's output latency.
pub fn reading(sample: LatencySample, output_ms: f64) -> LatencyReading {
    let wait_ms = sample.picked_us.saturating_sub(sample.midi_us) as f64 / 1000.0;
    LatencyReading { note: sample.note, wait_ms, output_ms, total_ms: wait_ms + output_ms + USB_MIDI_MS }
}

/// Median, 95th percentile (nearest rank) and maximum of `values`. All zero
/// for an empty list.
pub fn summarize(values: &[f64]) -> (f64, f64, f64) {
    if values.is_empty() {
        return (0.0, 0.0, 0.0);
    }
    let mut v = values.to_vec();
    v.sort_by(f64::total_cmp);
    let n = v.len();
    let median = if n % 2 == 1 { v[n / 2] } else { (v[n / 2 - 1] + v[n / 2]) / 2.0 };
    let rank = (n * 95).div_ceil(100).max(1);
    (median, v[rank - 1], v[n - 1])
}

/// The last `LATENCY_HISTORY` readings, in a fixed ring.
#[derive(Default)]
pub struct LatencyHistory {
    items: Vec<LatencyReading>,
    /// Readings ever pushed since the last clear.
    pushed: u64,
    /// How many of those `take_new` already returned.
    reported: u64,
}

impl LatencyHistory {
    pub fn push(&mut self, r: LatencyReading) {
        if self.items.len() < LATENCY_HISTORY {
            self.items.push(r);
        } else {
            self.items[(self.pushed % LATENCY_HISTORY as u64) as usize] = r;
        }
        self.pushed += 1;
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// The remembered `total_ms` values (oldest first once full is not promised).
    pub fn totals(&self) -> Vec<f64> {
        self.items.iter().map(|r| r.total_ms).collect()
    }

    /// Readings not returned before, oldest first. Only the ones still
    /// remembered (at most `LATENCY_HISTORY`).
    pub fn take_new(&mut self) -> Vec<LatencyReading> {
        let first = self.reported.max(self.pushed.saturating_sub(LATENCY_HISTORY as u64));
        let out = (first..self.pushed).map(|i| self.items[(i % LATENCY_HISTORY as u64) as usize]).collect();
        self.reported = self.pushed;
        out
    }

    pub fn clear(&mut self) {
        self.items.clear();
        self.pushed = 0;
        self.reported = 0;
    }
}

/// How the engine is doing on key timing.
#[derive(Clone, Debug, PartialEq)]
pub struct LatencySummary {
    pub count: usize,
    pub median_ms: f64,
    pub p95_ms: f64,
    pub max_ms: f64,
    /// Output latency of the running session (0 when none).
    pub output_ms: f64,
    pub buffer_frames: u32,
    pub sample_rate: u32,
    /// "" when no output runs.
    pub backend: String,
    pub underruns: u64,
}

/// How the piano sound is doing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PianoState {
    Loading,
    Ready,
    Failed(String),
}

/// What a finished load tells the caller.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PianoInfo {
    pub samples: usize,
    /// How long decoding took.
    pub seconds: f64,
}

struct State {
    volume: f32,
    generation: u64,
    session: Option<Session>,
    /// The loaded piano. The engine keeps it for good, so the audio thread
    /// is never the last to let go of it.
    bank: Option<Arc<SampleBank>>,
    piano: PianoState,
    piano_info: Option<PianoInfo>,
    latency: LatencyHistory,
}

/// Control side of the engine. The state lock is only held for quick
/// bookkeeping, never while a device opens or closes, so `status`, `stop`,
/// tone and volume calls never wait for a slow `start`. The audio thread never
/// touches any of this.
pub struct Engine {
    stats: Arc<EngineStats>,
    state: Mutex<State>,
    starting: AtomicBool,
    loading: AtomicBool,
    midi: Arc<MidiSink>,
    song: Arc<MidiSink>,
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
        clock::init();
        Self {
            stats: Arc::new(EngineStats::default()),
            state: Mutex::new(State {
                volume: 1.0,
                generation: 0,
                session: None,
                bank: None,
                piano: PianoState::Loading,
                piano_info: None,
                latency: LatencyHistory::default(),
            }),
            starting: AtomicBool::new(false),
            loading: AtomicBool::new(false),
            midi: Arc::new(MidiSink::default()),
            song: Arc::new(MidiSink::default()),
        }
    }

    /// Where the MIDI thread sends notes. It points at the running output's
    /// MIDI ring, and at nothing while no output runs.
    pub fn midi_sink(&self) -> &Arc<MidiSink> {
        &self.midi
    }

    /// Where the song player sends notes. Like `midi_sink`, it points at the
    /// running output's song ring and at nothing while no output runs.
    pub fn song_sink(&self) -> &Arc<MidiSink> {
        &self.song
    }

    fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn stats(&self) -> &Arc<EngineStats> {
        &self.stats
    }

    pub fn info(&self) -> Option<StartInfo> {
        let mut st = self.state();
        st.session.as_mut().map(|s| {
            s.banks.reclaim();
            s.info.clone()
        })
    }

    /// How the piano sound is doing. Never waits for a load.
    pub fn piano_status(&self) -> PianoState {
        self.state().piano.clone()
    }

    /// Decode the piano sound in `dir` on the calling thread (the API runs
    /// this on a worker). Only one load runs at a time; once a load worked, a
    /// later call just returns the same answer. The bank goes to the running
    /// output now, and to every output started later.
    pub fn load_piano(&self, dir: &std::path::Path) -> Result<PianoInfo, String> {
        self.load_piano_with(|| SampleBank::load_dir(dir))
    }

    pub fn load_piano_with<F>(&self, loader: F) -> Result<PianoInfo, String>
    where
        F: FnOnce() -> Result<SampleBank, String>,
    {
        if self.loading.swap(true, Ordering::AcqRel) {
            return Err("The piano sound is already loading.".to_string());
        }
        let _flag = StartingFlag(&self.loading);
        {
            let mut st = self.state();
            if let Some(info) = st.piano_info {
                return Ok(info);
            }
            st.piano = PianoState::Loading;
        }
        let began = Instant::now();
        match loader() {
            Ok(bank) => {
                let info = PianoInfo { samples: bank.len(), seconds: began.elapsed().as_secs_f64() };
                let bank = Arc::new(bank);
                // Under the one lock a start also takes when it installs its
                // session, so either this sends the bank or that start does.
                let mut st = self.state();
                st.bank = Some(Arc::clone(&bank));
                st.piano = PianoState::Ready;
                st.piano_info = Some(info);
                if let Some(s) = st.session.as_mut() {
                    // A full ring cannot happen (one bank per output); if it did, the
                    // output would keep the stand-in voice.
                    let _ = s.banks.send(bank);
                }
                Ok(info)
            }
            Err(reason) => {
                self.state().piano = PianoState::Failed(reason.clone());
                Err(reason)
            }
        }
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
        self.song.set(None);
        if let Some(mut old) = old {
            old.banks.reclaim();
            old.running.stop();
            self.keep_latency(&mut old.latency, old.info.output_latency_ms);
        }
        self.stats.reset();
        let (running, info, outbox) = opener(cfg, &self.stats)?;
        let Outbox { mut commands, midi, song, mut banks, latency } = outbox;
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
        if let Some(bank) = &st.bank {
            // The piano loaded before this output opened: it plays from the first buffer on.
            let _ = banks.send(Arc::clone(bank));
        }
        st.session = Some(Session { running, info: info.clone(), commands, banks, latency });
        self.midi.set(Some(midi));
        self.song.set(Some(song));
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
        self.song.set(None);
        if let Some(mut s) = old {
            s.banks.reclaim();
            s.running.stop();
            self.keep_latency(&mut s.latency, s.info.output_latency_ms);
            self.stats.running.store(false, Ordering::Release);
        }
    }

    /// Move what an ended session still holds into the history.
    fn keep_latency(&self, ring: &mut rtrb::Consumer<LatencySample>, output_ms: f64) {
        let mut st = self.state();
        while let Ok(sample) = ring.pop() {
            st.latency.push(reading(sample, output_ms));
        }
    }

    /// Move what the running session's audio thread reported into the history.
    fn collect_latency(st: &mut State) {
        let State { session, latency, .. } = st;
        if let Some(s) = session.as_mut() {
            let output_ms = s.info.output_latency_ms;
            while let Ok(sample) = s.latency.pop() {
                latency.push(reading(sample, output_ms));
            }
        }
    }

    /// Key timings since the last call (at most the last 200).
    pub fn latency_samples(&self) -> Vec<LatencyReading> {
        let mut st = self.state();
        Self::collect_latency(&mut st);
        st.latency.take_new()
    }

    /// Median, 95th percentile and maximum of the remembered key timings, plus
    /// what the running output looks like.
    pub fn latency_summary(&self) -> LatencySummary {
        let mut st = self.state();
        Self::collect_latency(&mut st);
        let totals = st.latency.totals();
        let (median_ms, p95_ms, max_ms) = summarize(&totals);
        let (output_ms, buffer_frames, sample_rate, backend) = match &st.session {
            Some(s) => (s.info.output_latency_ms, s.info.buffer_frames, s.info.sample_rate, s.info.backend.clone()),
            None => (0.0, 0, 0, String::new()),
        };
        LatencySummary {
            count: totals.len(),
            median_ms,
            p95_ms,
            max_ms,
            output_ms,
            buffer_frames,
            sample_rate,
            backend,
            underruns: self.stats.underruns.load(Ordering::Relaxed),
        }
    }

    /// Forget every remembered key timing, and the ones still waiting.
    pub fn clear_latency(&self) {
        let mut st = self.state();
        if let Some(s) = st.session.as_mut() {
            while s.latency.pop().is_ok() {}
        }
        st.latency.clear();
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
        assert_eq!(msg, "The sound device is busy. Another app may be using it on its own. Close other sound apps and press Try again.");
        // No raw hex code in the words Bar reads.
        assert!(!friendly_hresult(0x1234_5678).contains("0x"));
        assert_eq!(friendly_hresult(0x1234_5678), "The sound device could not be opened.");
    }

    #[test]
    fn sound_format_error_names_pianolearner_and_says_sound_format() {
        assert_eq!(
            friendly_hresult(0x8889_0008),
            "The sound device does not support the sound format PianoLearner needs."
        );
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
            *slot.lock().unwrap() = Some(inbox.midi.commands);
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
        let key = Command::NoteOn { note: 60, velocity: 90, midi_us: 11 };
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

    /// An opener whose song consumer the test keeps.
    fn song_opener(
        slot: Arc<Mutex<Option<rtrb::Consumer<Command>>>>,
    ) -> impl FnOnce(&StartConfig, &Arc<EngineStats>) -> Result<Opened, String> {
        move |_cfg, _stats| {
            let (out, inbox) = rings(8, 8);
            *slot.lock().unwrap() = Some(inbox.song);
            let (running, info) = spawn_backend("fake", move |stop, ready| {
                let _keep = (inbox.commands, inbox.midi.commands);
                let _ = ready.send(Ok(fake_info("fake")));
                while !stop.load(Ordering::Acquire) {
                    thread::park_timeout(Duration::from_millis(20));
                }
            })?;
            Ok((running, info, out))
        }
    }

    #[test]
    fn the_song_sink_follows_each_start_with_a_ring_of_its_own() {
        let e = Engine::new();
        let note = Command::NoteOn { note: 60, velocity: 90, midi_us: 0 };
        let key = Command::NoteOn { note: 61, velocity: 90, midi_us: 5 };
        let (first, second) = (Arc::new(Mutex::new(None)), Arc::new(Mutex::new(None)));
        assert!(e.song_sink().push(note), "no output yet: nobody to send to, not an error");
        e.start_with(&StartConfig::default(), song_opener(Arc::clone(&first))).unwrap();
        assert!(e.song_sink().push(note));
        assert!(e.midi_sink().push(key));
        e.start_with(&StartConfig::default(), song_opener(Arc::clone(&second))).unwrap();
        assert!(e.song_sink().push(note), "the same sink reaches the new output after a restart");
        let mut first = first.lock().unwrap().take().unwrap();
        let mut second = second.lock().unwrap().take().unwrap();
        assert_eq!(first.pop(), Ok(note));
        assert!(first.pop().is_err(), "the old ring gets nothing after the restart, and no MIDI key ever lands here");
        assert_eq!(second.pop(), Ok(note));
        assert!(second.pop().is_err());
        e.stop();
        assert!(e.song_sink().push(note));
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
        assert_eq!(open(&cfg, &stats).err().unwrap(), "Unknown sound mode: tin-can.");
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

    /// An opener whose bank receiver the test keeps.
    fn link_opener(
        slot: Arc<Mutex<Option<crate::piano::BankReceiver>>>,
    ) -> impl FnOnce(&StartConfig, &Arc<EngineStats>) -> Result<Opened, String> {
        move |_cfg, _stats| {
            let (out, inbox) = rings(8, 8);
            *slot.lock().unwrap() = Some(inbox.banks);
            let (running, info) = spawn_backend("fake", move |stop, ready| {
                let _keep = (inbox.commands, inbox.midi.commands);
                let _ = ready.send(Ok(fake_info("fake")));
                while !stop.load(Ordering::Acquire) {
                    thread::park_timeout(Duration::from_millis(20));
                }
            })?;
            Ok((running, info, out))
        }
    }

    fn small_bank() -> Result<SampleBank, String> {
        Ok(crate::piano::testing::grid_bank(0.1))
    }

    #[test]
    fn the_piano_is_loading_until_a_load_ends() {
        let e = Engine::new();
        assert_eq!(e.piano_status(), PianoState::Loading);
        let info = e.load_piano_with(small_bank).unwrap();
        assert_eq!(info.samples, 120);
        assert_eq!(e.piano_status(), PianoState::Ready);
    }

    #[test]
    fn a_failed_load_says_why_and_can_be_tried_again() {
        let e = Engine::new();
        let err = e.load_piano_with(|| Err("No piano sounds found.".to_string())).unwrap_err();
        assert_eq!(err, "No piano sounds found.");
        assert_eq!(e.piano_status(), PianoState::Failed("No piano sounds found.".to_string()));
        assert!(e.load_piano_with(small_bank).is_ok());
        assert_eq!(e.piano_status(), PianoState::Ready);
    }

    #[test]
    fn a_second_load_while_one_is_running_is_turned_away_and_status_does_not_wait() {
        let e = Arc::new(Engine::new());
        let (gate_tx, gate_rx) = mpsc::channel::<()>();
        let (busy_tx, busy_rx) = mpsc::channel();
        let e2 = Arc::clone(&e);
        let first = thread::spawn(move || {
            e2.load_piano_with(move || {
                let _ = busy_tx.send(());
                let _ = gate_rx.recv();
                small_bank()
            })
        });
        busy_rx.recv().unwrap(); // the first load is now decoding
        assert_eq!(e.piano_status(), PianoState::Loading);
        let second = e.load_piano_with(|| panic!("must not decode twice"));
        assert_eq!(second.unwrap_err(), "The piano sound is already loading.");
        gate_tx.send(()).unwrap();
        assert!(first.join().unwrap().is_ok());
        assert_eq!(e.piano_status(), PianoState::Ready);
    }

    #[test]
    fn loading_again_after_success_does_not_decode_or_send_a_second_bank() {
        let e = Engine::new();
        let slot = Arc::new(Mutex::new(None));
        e.start_with(&StartConfig::default(), link_opener(Arc::clone(&slot))).unwrap();
        e.load_piano_with(small_bank).unwrap();
        let again = e.load_piano_with(|| panic!("must not decode twice")).unwrap();
        assert_eq!(again.samples, 120);
        let mut link = slot.lock().unwrap().take().unwrap();
        assert!(link.next_bank().is_some());
        assert!(link.next_bank().is_none(), "only one bank is ever sent to an output");
        e.stop();
    }

    #[test]
    fn an_output_started_after_the_load_gets_the_bank() {
        let e = Engine::new();
        e.load_piano_with(small_bank).unwrap();
        let slot = Arc::new(Mutex::new(None));
        e.start_with(&StartConfig::default(), link_opener(Arc::clone(&slot))).unwrap();
        let mut link = slot.lock().unwrap().take().unwrap();
        assert_eq!(link.next_bank().expect("the bank is waiting").len(), 120);
        // A restart builds a new output, which gets the bank again.
        let slot2 = Arc::new(Mutex::new(None));
        e.start_with(&StartConfig::default(), link_opener(Arc::clone(&slot2))).unwrap();
        let mut link2 = slot2.lock().unwrap().take().unwrap();
        assert!(link2.next_bank().is_some());
        e.stop();
    }

    #[test]
    fn a_bank_that_finishes_while_sound_runs_is_handed_over_once() {
        let e = Engine::new();
        let slot = Arc::new(Mutex::new(None));
        e.start_with(&StartConfig::default(), link_opener(Arc::clone(&slot))).unwrap();
        let mut link = slot.lock().unwrap().take().unwrap();
        assert!(link.next_bank().is_none(), "nothing to hand over before the load ends");
        e.load_piano_with(small_bank).unwrap();
        assert_eq!(link.next_bank().expect("sent through the link").len(), 120);
        assert!(link.next_bank().is_none());
        e.stop();
    }

    #[test]
    fn a_bank_that_finishes_while_an_output_is_still_opening_is_not_lost() {
        let e = Arc::new(Engine::new());
        let (gate_tx, gate_rx) = mpsc::channel();
        let (open_tx, open_rx) = mpsc::channel();
        let slot = Arc::new(Mutex::new(None));
        let slot2 = Arc::clone(&slot);
        let e2 = Arc::clone(&e);
        let starting = thread::spawn(move || {
            e2.start_with(&StartConfig::default(), move |cfg, stats| {
                let _ = open_tx.send(());
                let _ = gate_rx.recv();
                link_opener(slot2)(cfg, stats)
            })
        });
        open_rx.recv().unwrap();
        e.load_piano_with(small_bank).unwrap();
        gate_tx.send(()).unwrap();
        starting.join().unwrap().unwrap();
        let mut link = slot.lock().unwrap().take().unwrap();
        assert!(link.next_bank().is_some());
        assert!(link.next_bank().is_none(), "sent once, not twice");
        e.stop();
    }

    #[test]
    fn a_failed_load_leaves_sound_running_with_the_stand_in_voice() {
        let e = Engine::new();
        let slot = Arc::new(Mutex::new(None));
        e.start_with(&StartConfig::default(), link_opener(Arc::clone(&slot))).unwrap();
        e.load_piano_with(|| Err("The piano sound folder is missing.".to_string())).unwrap_err();
        assert!(e.info().is_some());
        let mut link = slot.lock().unwrap().take().unwrap();
        assert!(link.next_bank().is_none());
        e.stop();
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

    // ---- latency history and summary ----

    fn ms(total: f64) -> LatencyReading {
        LatencyReading { note: 60, wait_ms: total - 1.0, output_ms: 0.0, total_ms: total }
    }

    #[test]
    fn total_is_wait_plus_output_plus_one_ms_of_usb() {
        let r = reading(LatencySample { note: 61, midi_us: 1_000, picked_us: 3_500 }, 4.25);
        assert_eq!(r.note, 61);
        assert!((r.wait_ms - 2.5).abs() < 1e-9);
        assert!((r.output_ms - 4.25).abs() < 1e-9);
        assert!((r.total_ms - 7.75).abs() < 1e-9, "2.5 + 4.25 + 1.0, got {}", r.total_ms);
        assert!((USB_MIDI_MS - 1.0).abs() < f64::EPSILON);
    }

    #[test]
    fn a_pick_time_before_the_stamp_counts_as_no_wait() {
        let r = reading(LatencySample { note: 1, midi_us: 900, picked_us: 100 }, 2.0);
        assert!(r.wait_ms.abs() < f64::EPSILON);
    }

    #[test]
    fn summary_maths_on_a_known_list() {
        let list: Vec<f64> = (1..=20).map(f64::from).collect();
        let (median, p95, max) = summarize(&list);
        assert!((median - 10.5).abs() < 1e-9, "even count: mean of the two middle ones");
        assert!((p95 - 19.0).abs() < 1e-9, "nearest rank: ceil(0.95 * 20) = 19th value");
        assert!((max - 20.0).abs() < 1e-9);
        let (median, p95, max) = summarize(&[9.0, 1.0, 5.0]);
        assert_eq!((median, p95, max), (5.0, 9.0, 9.0), "unsorted input, odd count");
        assert_eq!(summarize(&[4.0]), (4.0, 4.0, 4.0));
        assert_eq!(summarize(&[]), (0.0, 0.0, 0.0));
    }

    #[test]
    fn history_keeps_only_the_last_200() {
        let mut h = LatencyHistory::default();
        for i in 1..=250 {
            h.push(ms(f64::from(i)));
        }
        assert_eq!(h.len(), LATENCY_HISTORY);
        let totals = h.totals();
        assert_eq!(totals.len(), 200);
        assert!((totals.iter().cloned().fold(f64::MAX, f64::min) - 51.0).abs() < 1e-9, "the first 50 fell out");
        assert!((totals.iter().cloned().fold(0.0, f64::max) - 250.0).abs() < 1e-9);
    }

    #[test]
    fn take_new_returns_each_sample_once_in_order() {
        let mut h = LatencyHistory::default();
        h.push(ms(1.0));
        h.push(ms(2.0));
        let first: Vec<f64> = h.take_new().iter().map(|r| r.total_ms).collect();
        assert_eq!(first, vec![1.0, 2.0]);
        assert!(h.take_new().is_empty());
        h.push(ms(3.0));
        assert_eq!(h.take_new().len(), 1);
        assert_eq!(h.len(), 3, "reporting does not shrink the history behind the summary");
    }

    #[test]
    fn take_new_after_more_than_200_new_samples_gives_the_last_200() {
        let mut h = LatencyHistory::default();
        for i in 1..=300 {
            h.push(ms(f64::from(i)));
        }
        let got = h.take_new();
        assert_eq!(got.len(), 200);
        assert!((got[0].total_ms - 101.0).abs() < 1e-9);
        assert!((got[199].total_ms - 300.0).abs() < 1e-9);
    }

    #[test]
    fn clear_empties_history_and_starts_the_new_samples_fresh() {
        let mut h = LatencyHistory::default();
        h.push(ms(1.0));
        h.clear();
        assert_eq!(h.len(), 0);
        assert!(h.take_new().is_empty());
        h.push(ms(2.0));
        assert_eq!(h.take_new().len(), 1);
    }

    /// An opener that keeps the audio side's latency producer.
    fn latency_opener(
        slot: Arc<Mutex<Option<rtrb::Producer<LatencySample>>>>,
    ) -> impl FnOnce(&StartConfig, &Arc<EngineStats>) -> Result<Opened, String> {
        move |_cfg, _stats| {
            let (out, inbox) = rings(8, 8);
            *slot.lock().unwrap() = inbox.midi.latency;
            let (running, info) = spawn_backend("fake", move |stop, ready| {
                let _keep = (inbox.commands, inbox.midi.commands);
                let _ = ready.send(Ok(fake_info("fake")));
                while !stop.load(Ordering::Acquire) {
                    thread::park_timeout(Duration::from_millis(20));
                }
            })?;
            Ok((running, info, out))
        }
    }

    #[test]
    fn engine_with_no_output_reports_zeros_and_no_samples() {
        let e = Engine::new();
        let s = e.latency_summary();
        assert_eq!(s.count, 0);
        assert_eq!((s.median_ms, s.p95_ms, s.max_ms, s.output_ms), (0.0, 0.0, 0.0, 0.0));
        assert_eq!((s.buffer_frames, s.sample_rate, s.underruns), (0, 0, 0));
        assert_eq!(s.backend, "");
        assert!(e.latency_samples().is_empty());
        e.clear_latency();
    }

    #[test]
    fn engine_turns_audio_thread_samples_into_readings_with_the_session_output_latency() {
        let e = Engine::new();
        let slot = Arc::new(Mutex::new(None));
        e.start_with(&StartConfig::default(), latency_opener(Arc::clone(&slot))).unwrap();
        let mut tx = slot.lock().unwrap().take().expect("the audio side holds a latency producer");
        tx.push(LatencySample { note: 60, midi_us: 10_000, picked_us: 11_000 }).unwrap();
        tx.push(LatencySample { note: 62, midi_us: 20_000, picked_us: 22_000 }).unwrap();
        let got = e.latency_samples();
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].note, 60);
        assert!((got[0].wait_ms - 1.0).abs() < 1e-9);
        assert!((got[0].output_ms - 2.7).abs() < 1e-9, "from StartInfo.output_latency_ms");
        assert!((got[0].total_ms - 4.7).abs() < 1e-9, "1.0 + 2.7 + 1.0");
        assert!((got[1].total_ms - 5.7).abs() < 1e-9);
        assert!(e.latency_samples().is_empty(), "only new samples are returned");

        let s = e.latency_summary();
        assert_eq!(s.count, 2);
        assert!((s.median_ms - 5.2).abs() < 1e-9);
        assert!((s.max_ms - 5.7).abs() < 1e-9);
        assert!((s.output_ms - 2.7).abs() < 1e-9);
        assert_eq!((s.buffer_frames, s.sample_rate), (128, 48_000));
        assert_eq!(s.backend, "cpal");

        e.clear_latency();
        assert_eq!(e.latency_summary().count, 0);
        tx.push(LatencySample { note: 64, midi_us: 1, picked_us: 2 }).unwrap();
        assert_eq!(e.latency_summary().count, 1, "samples after a clear count again");
        e.stop();
    }

    #[test]
    fn clear_also_throws_away_samples_still_waiting_in_the_ring() {
        let e = Engine::new();
        let slot = Arc::new(Mutex::new(None));
        e.start_with(&StartConfig::default(), latency_opener(Arc::clone(&slot))).unwrap();
        let mut tx = slot.lock().unwrap().take().unwrap();
        tx.push(LatencySample { note: 60, midi_us: 1, picked_us: 2 }).unwrap();
        e.clear_latency();
        assert_eq!(e.latency_summary().count, 0);
        e.stop();
    }

    #[test]
    fn samples_still_in_the_ring_when_the_output_stops_are_kept() {
        let e = Engine::new();
        let slot = Arc::new(Mutex::new(None));
        e.start_with(&StartConfig::default(), latency_opener(Arc::clone(&slot))).unwrap();
        let mut tx = slot.lock().unwrap().take().unwrap();
        tx.push(LatencySample { note: 60, midi_us: 1, picked_us: 2 }).unwrap();
        e.stop();
        assert_eq!(e.latency_summary().count, 1);
        assert_eq!(e.latency_summary().backend, "", "no output now");
    }
}
