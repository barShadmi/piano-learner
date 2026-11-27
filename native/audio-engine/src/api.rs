//! The Node API. Thin: it only converts between JS values and `output::Engine`.
//! `start` and `listOutputs` run on a worker thread (they return Promises), so
//! the Electron main thread never waits for a sound device. The engine's lock
//! is only held for quick bookkeeping; the audio thread never touches it.
//!
//! A `start` while another `start` is still opening is rejected with "Sound is
//! already starting." (it does not queue). `loadPiano` also runs on a worker
//! thread (decoding takes a second or two); a second call while it runs is
//! rejected with "The piano sound is already loading.".

use crate::midi::{self, JsEvent, MidiService};
use crate::output::{self, Engine, OutputDevice, PianoState, StartConfig as Config, StartInfo};
use napi::bindgen_prelude::{AsyncTask, Function};
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi::{Env, Error, Result, Status, Task};
use napi_derive::napi;
use std::sync::atomic::Ordering;
use std::sync::{Arc, LazyLock};

static ENGINE: LazyLock<Engine> = LazyLock::new(Engine::new);
static MIDI: LazyLock<MidiService> = LazyLock::new(|| MidiService::new(Arc::clone(ENGINE.midi_sink())));

fn plain(message: String) -> Error {
    Error::from_reason(message)
}

#[napi(object, js_name = "OutputDevice")]
pub struct JsOutputDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    /// "wasapi-exclusive", "wasapi-shared", "asio" or "cpal".
    pub backend: String,
}

#[napi(object, js_name = "StartConfig")]
pub struct JsStartConfig {
    pub device_id: Option<String>,
    pub backend: Option<String>,
    pub buffer_frames: Option<u32>,
}

#[napi(object, js_name = "StartResult")]
pub struct JsStartResult {
    pub backend: String,
    pub device_name: String,
    pub sample_rate: u32,
    pub buffer_frames: u32,
    pub output_latency_ms: f64,
    pub fallback_reason: Option<String>,
}

#[napi(object, js_name = "EngineStatus")]
pub struct JsStatus {
    pub running: bool,
    /// True when the output stopped by itself because the device failed.
    pub failed: bool,
    pub backend: Option<String>,
    pub sample_rate: u32,
    pub buffer_frames: u32,
    pub callbacks: f64,
    pub underruns: f64,
    /// Delay the driver reported between callback and sound, in ms (0 = unknown).
    pub measured_latency_ms: f64,
}

pub struct ListTask;

impl Task for ListTask {
    type Output = Vec<OutputDevice>;
    type JsValue = Vec<JsOutputDevice>;

    fn compute(&mut self) -> Result<Self::Output> {
        output::list_outputs().map_err(plain)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output
            .into_iter()
            .map(|o| JsOutputDevice { id: o.id, name: o.name, is_default: o.is_default, backend: o.backend })
            .collect())
    }
}

pub struct StartTask(Config);

impl Task for StartTask {
    type Output = StartInfo;
    type JsValue = JsStartResult;

    fn compute(&mut self) -> Result<Self::Output> {
        ENGINE.start(&self.0).map_err(plain)
    }

    fn resolve(&mut self, _env: Env, info: Self::Output) -> Result<Self::JsValue> {
        Ok(JsStartResult {
            backend: info.backend,
            device_name: info.device_name,
            sample_rate: info.sample_rate,
            buffer_frames: info.buffer_frames,
            output_latency_ms: info.output_latency_ms,
            fallback_reason: info.fallback_reason,
        })
    }
}

#[napi(object, js_name = "PianoLoadResult")]
pub struct JsPianoLoadResult {
    /// How many piano sounds were decoded.
    pub samples: u32,
    /// How long decoding took, in seconds.
    pub seconds: f64,
}

#[napi(object, js_name = "PianoStatus")]
pub struct JsPianoStatus {
    #[napi(ts_type = "'loading' | 'ready' | 'failed'")]
    pub state: String,
    /// Why the piano sound could not load, in plain words (only when failed).
    pub error: Option<String>,
}

pub struct LoadPianoTask(String);

impl Task for LoadPianoTask {
    type Output = output::PianoInfo;
    type JsValue = JsPianoLoadResult;

    fn compute(&mut self) -> Result<Self::Output> {
        ENGINE.load_piano(std::path::Path::new(&self.0)).map_err(plain)
    }

    fn resolve(&mut self, _env: Env, info: Self::Output) -> Result<Self::JsValue> {
        Ok(JsPianoLoadResult { samples: info.samples as u32, seconds: info.seconds })
    }
}

/// Every sound output on this PC (empty when there is none). Returns a Promise.
#[napi(ts_return_type = "Promise<Array<OutputDevice>>")]
pub fn list_outputs() -> AsyncTask<ListTask> {
    AsyncTask::new(ListTask)
}

/// Open the sound output. Any output that is already open is closed first.
/// Returns a Promise; rejects with "Sound is already starting." if another
/// start is still opening.
#[napi(ts_return_type = "Promise<StartResult>")]
pub fn start(config: Option<JsStartConfig>) -> AsyncTask<StartTask> {
    let cfg = config
        .map(|c| Config { device_id: c.device_id, backend: c.backend, buffer_frames: c.buffer_frames })
        .unwrap_or_default();
    AsyncTask::new(StartTask(cfg))
}

/// Decode the piano sounds in `folder` on a worker thread. Sound keeps working
/// with a simple tone meanwhile, and switches to the piano when this finishes
/// (also on an output that is already running). Returns a Promise; rejects with
/// "The piano sound is already loading." if a load is still running.
#[napi(ts_return_type = "Promise<PianoLoadResult>")]
pub fn load_piano(folder: String) -> AsyncTask<LoadPianoTask> {
    AsyncTask::new(LoadPianoTask(folder))
}

/// How the piano sound is doing. Answers at once, even while it loads.
#[napi]
pub fn piano_status() -> JsPianoStatus {
    match ENGINE.piano_status() {
        PianoState::Loading => JsPianoStatus { state: "loading".to_string(), error: None },
        PianoState::Ready => JsPianoStatus { state: "ready".to_string(), error: None },
        PianoState::Failed(reason) => JsPianoStatus { state: "failed".to_string(), error: Some(reason) },
    }
}

/// Close the sound output. Fine to call when nothing is open.
#[napi]
pub fn stop() {
    ENGINE.stop();
}

/// Play a short sine tone (440 Hz for 1 second unless told otherwise).
#[napi]
pub fn play_test_tone(frequency_hz: Option<f64>, seconds: Option<f64>) -> Result<()> {
    ENGINE
        .play_test_tone(frequency_hz.unwrap_or(440.0) as f32, seconds.unwrap_or(1.0) as f32)
        .map_err(plain)
}

/// Master volume from 0 to 1.
#[napi]
pub fn set_volume(volume: f64) -> Result<()> {
    ENGINE.set_volume(volume as f32).map_err(plain)
}

/// What the engine is doing now.
#[napi]
pub fn status() -> JsStatus {
    let info = ENGINE.info();
    let stats = ENGINE.stats();
    JsStatus {
        running: stats.running.load(Ordering::Acquire) && info.is_some(),
        failed: stats.failed.load(Ordering::Acquire),
        backend: info.as_ref().map(|i| i.backend.clone()),
        sample_rate: info.as_ref().map_or(0, |i| i.sample_rate),
        buffer_frames: stats.last_buffer_frames.load(Ordering::Relaxed),
        callbacks: stats.callbacks.load(Ordering::Relaxed) as f64,
        underruns: stats.underruns.load(Ordering::Relaxed) as f64,
        measured_latency_ms: f64::from(stats.measured_latency_us.load(Ordering::Relaxed)) / 1000.0,
    }
}

#[napi(object, js_name = "MidiEvent")]
pub struct JsMidiEvent {
    #[napi(ts_type = "'on' | 'off' | 'sustain' | 'allOff'")]
    pub kind: String,
    /// MIDI note number (60 = middle C). 0 for sustain and allOff.
    pub note: u8,
    /// 1..127 for "on", otherwise 0.
    pub velocity: u8,
    /// Only for "sustain": true when the pedal is down.
    pub down: Option<bool>,
    /// Microseconds on a clock that only goes forward, taken when the key
    /// message arrived (zero at the first MIDI call of this process).
    pub time_us: f64,
}

#[napi(object, js_name = "MidiStatus")]
pub struct JsMidiStatus {
    pub connected: bool,
    pub port_name: Option<String>,
    /// Why the piano could not be opened, in plain words (gone once it connects).
    pub error: Option<String>,
    /// Key messages seen since the app started.
    pub events: f64,
    /// Keys that could not be sent to the sound in time (ring full or busy).
    pub dropped_sound: f64,
    /// Keys that could not be sent to the screens in time.
    pub dropped_screen: f64,
    /// Whether the piano's own speakers are off: "off" (we switched Local
    /// Control off), "on", or "unknown" (not connected, or no output port).
    #[napi(ts_type = "'off' | 'on' | 'unknown'")]
    pub local_control: String,
}

impl From<JsEvent> for JsMidiEvent {
    fn from(e: JsEvent) -> Self {
        Self {
            kind: e.kind.as_str().to_string(),
            note: e.note,
            velocity: e.velocity,
            down: e.down,
            time_us: e.time_us as f64,
        }
    }
}

/// The names of the MIDI inputs on this PC (empty when there are none).
#[napi]
pub fn list_midi_inputs() -> Vec<String> {
    midi::list_inputs()
}

/// Whether the piano is connected, and how many key messages came in.
#[napi]
pub fn midi_status() -> JsMidiStatus {
    let s = MIDI.status();
    JsMidiStatus {
        connected: s.connected,
        port_name: s.port_name,
        error: s.error,
        events: s.events as f64,
        dropped_sound: s.dropped_sound as f64,
        dropped_screen: s.dropped_screen as f64,
        local_control: s.local_control.as_str().to_string(),
    }
}

/// Call `callback` with each batch of key events (an array, in order). Replaces
/// an earlier callback. It does not keep Node running, and `stopMidi` lets it go.
#[napi(ts_args_type = "callback: (events: Array<MidiEvent>) => void")]
pub fn on_midi_event(callback: Function<Vec<JsMidiEvent>, ()>) -> Result<()> {
    let tsfn = callback.build_threadsafe_function::<Vec<JsMidiEvent>>().weak::<true>().build()?;
    MIDI.set_handler(Some(Arc::new(move |batch: Vec<JsEvent>| {
        let n = batch.len() as u64;
        let events: Vec<JsMidiEvent> = batch.into_iter().map(JsMidiEvent::from).collect();
        if tsfn.call(events, ThreadsafeFunctionCallMode::NonBlocking) != Status::Ok {
            MIDI.note_screen_drops(n);
        }
    })));
    Ok(())
}

/// Start looking for the piano (checks every 2 seconds, reconnects if it is
/// unplugged and plugged back in). Fine to call again.
#[napi]
pub fn start_midi() {
    MIDI.start();
}

/// Close the piano's connection and open it again right away (for a quick
/// unplug and replug that left a dead connection). Fine when not started.
#[napi]
pub fn reconnect_midi() {
    MIDI.reconnect();
}

/// Stop looking, give the piano its own sound back (Local Control on), close
/// its ports and let go of the callback.
#[napi]
pub fn stop_midi() {
    MIDI.stop();
}

/// Keep the piano's own speakers off (true, the default) or let them play too
/// (false). Applies at once if the piano is connected, and at every connect.
#[napi]
pub fn set_local_control_off(off: bool) {
    MIDI.set_local_control_off(off);
}
