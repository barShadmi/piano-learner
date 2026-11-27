//! The Node API. Thin: it only converts between JS values and `output::Engine`.
//! `start` and `listOutputs` run on a worker thread (they return Promises), so
//! the Electron main thread never waits for a sound device. The engine's lock
//! is only held for quick bookkeeping; the audio thread never touches it.
//!
//! A `start` while another `start` is still opening is rejected with "Sound is
//! already starting." (it does not queue).

use crate::output::{self, Engine, OutputDevice, StartConfig as Config, StartInfo};
use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Error, Result, Task};
use napi_derive::napi;
use std::sync::atomic::Ordering;
use std::sync::LazyLock;

static ENGINE: LazyLock<Engine> = LazyLock::new(Engine::new);

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
