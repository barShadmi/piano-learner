//! Windows output through WASAPI: exclusive event-driven mode for the lowest
//! latency, shared mode as the fallback. Only compiled on Windows.
//!
//! The render loop (`render_loop`) never allocates, locks or logs: buffers are
//! made before it starts and everything it touches is owned by this thread.

use super::{align_period, f32_to_i16, f32_to_i24_in_i32, f32_to_i32, friendly_hresult, Inbox, OutputDevice, StartInfo};
use crate::core::{EngineCore, EngineStats, Mixer};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use wasapi::{
    calculate_period_100ns, AudioClient, AudioRenderClient, DeviceEnumerator, Direction, Handle,
    SampleType, StreamMode, WasapiError, WaveFormat,
};
use windows::core::w;
use windows::Win32::Foundation::{HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows::Win32::System::Threading::{
    AvRevertMmThreadCharacteristics, AvSetMmThreadCharacteristicsW, WaitForSingleObject,
};

/// HRESULT of AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED.
const BUFFER_SIZE_NOT_ALIGNED: u32 = 0x8889_0019;
/// HRESULT of AUDCLNT_E_DEVICE_IN_USE.
const DEVICE_IN_USE: u32 = 0x8889_000A;
/// HRESULT of AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED.
const EXCLUSIVE_NOT_ALLOWED: u32 = 0x8889_000E;
/// Longest wait for the device event; also how fast `stop` is noticed.
const EVENT_WAIT_MS: u32 = 50;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    F32,
    I16,
    /// 24 valid bits in a 32-bit container.
    I24In32,
    I32,
}

impl Kind {
    fn bytes(self) -> usize {
        match self {
            Kind::I16 => 2,
            Kind::F32 | Kind::I24In32 | Kind::I32 => 4,
        }
    }
}

/// Every active render endpoint, once for exclusive and once for shared mode.
/// Runs on a short-lived thread so COM is set up the way WASAPI wants.
pub fn list() -> Vec<OutputDevice> {
    thread::Builder::new()
        .name("audio-list".to_string())
        .spawn(list_here)
        .ok()
        .and_then(|h| h.join().ok())
        .unwrap_or_default()
}

fn list_here() -> Vec<OutputDevice> {
    let com_ok = wasapi::initialize_mta().is_ok();
    let found = list_devices().unwrap_or_default();
    if com_ok {
        wasapi::deinitialize();
    }
    found
}

fn list_devices() -> Result<Vec<OutputDevice>, WasapiError> {
    let enumerator = DeviceEnumerator::new()?;
    let default_id = enumerator.get_default_device(Direction::Render).and_then(|d| d.get_id()).ok();
    let collection = enumerator.get_device_collection(Direction::Render)?;
    let mut exclusive = Vec::new();
    let mut shared = Vec::new();
    for device in &collection {
        let Ok(device) = device else { continue };
        let (Ok(id), Ok(name)) = (device.get_id(), device.get_friendlyname()) else { continue };
        let is_default = default_id.as_deref() == Some(id.as_str());
        exclusive.push(OutputDevice {
            id: id.clone(),
            name: name.clone(),
            is_default,
            backend: "wasapi-exclusive".to_string(),
        });
        shared.push(OutputDevice { id, name, is_default, backend: "wasapi-shared".to_string() });
    }
    exclusive.extend(shared);
    Ok(exclusive)
}

/// Plain-English reason for a WASAPI failure.
fn explain(e: &WasapiError) -> String {
    match e {
        WasapiError::Windows(err) => friendly_hresult(err.code().0 as u32),
        WasapiError::UnsupportedFormat => friendly_hresult(0x8889_0008),
        WasapiError::DeviceNotFound(_) => "That sound output was not found.".to_string(),
        _ => "The sound device could not be opened.".to_string(),
    }
}

fn hresult_of(e: &WasapiError) -> Option<u32> {
    match e {
        WasapiError::Windows(err) => Some(err.code().0 as u32),
        _ => None,
    }
}

/// An opened, initialised stream that is not started yet.
struct Stream {
    client: AudioClient,
    event: Handle,
    render: AudioRenderClient,
    kind: Kind,
    channels: u16,
    sample_rate: u32,
    buffer_frames: u32,
    device_name: String,
    latency_ms: f64,
}

fn finish(
    client: AudioClient,
    kind: Kind,
    channels: u16,
    sample_rate: u32,
    device_name: String,
) -> Result<Stream, WasapiError> {
    let event = client.set_get_eventhandle()?;
    let render = client.get_audiorenderclient()?;
    let buffer_frames = client.get_buffer_size()?;
    let device_latency_ms = client.get_stream_latency().map(|hns| hns as f64 / 10_000.0).unwrap_or(0.0);
    let latency_ms = f64::from(buffer_frames) * 1000.0 / f64::from(sample_rate) + device_latency_ms;
    Ok(Stream { client, event, render, kind, channels, sample_rate, buffer_frames, device_name, latency_ms })
}

fn find_device(en: &DeviceEnumerator, id: Option<&str>) -> Result<wasapi::Device, String> {
    match id {
        Some(id) => en.get_device(id).map_err(|_| "That sound output was not found.".to_string()),
        None => en
            .get_default_device(Direction::Render)
            .map_err(|_| "No sound output was found.".to_string()),
    }
}

fn open_exclusive(device: &wasapi::Device, frames: u32, name: &str) -> Result<Stream, String> {
    let mut last_reason = friendly_hresult(0x8889_0008);
    for rate in [48_000usize, 44_100] {
        for kind in [Kind::F32, Kind::I16, Kind::I24In32, Kind::I32] {
            let fmt = match kind {
                Kind::F32 => WaveFormat::new(32, 32, SampleType::Float, rate, 2, None),
                Kind::I16 => WaveFormat::new(16, 16, SampleType::Int, rate, 2, None),
                Kind::I24In32 => WaveFormat::new(32, 24, SampleType::Int, rate, 2, None),
                Kind::I32 => WaveFormat::new(32, 32, SampleType::Int, rate, 2, None),
            };
            let mut client = device.get_iaudioclient().map_err(|e| explain(&e))?;
            let Ok(fmt) = client.is_supported_exclusive_with_quirks(&fmt) else { continue };
            let (_default, minimum) = client.get_device_period().map_err(|e| explain(&e))?;
            let period = align_period(frames, rate as u32, minimum);
            let mode = StreamMode::EventsExclusive { period_hns: period };
            let init = client.initialize_client(&fmt, Direction::Render, mode, None);
            let client = match init {
                Ok(()) => client,
                Err(e) if hresult_of(&e) == Some(BUFFER_SIZE_NOT_ALIGNED) => {
                    // The device wants a different size: it tells us which, after
                    // the failed call. A client can only be initialised once, so
                    // make a fresh one with the aligned size.
                    let retry = client.get_buffer_size().and_then(|aligned| {
                        let mut again = device.get_iaudioclient()?;
                        let period = calculate_period_100ns(i64::from(aligned), rate as i64);
                        let mode = StreamMode::EventsExclusive { period_hns: period };
                        again.initialize_client(&fmt, Direction::Render, mode, None)?;
                        Ok(again)
                    });
                    match retry {
                        Ok(again) => again, // the first client is released here
                        Err(e) => {
                            // Release the first client and try the next format.
                            let code = hresult_of(&e);
                            last_reason = explain(&e);
                            drop(client);
                            if code == Some(DEVICE_IN_USE) || code == Some(EXCLUSIVE_NOT_ALLOWED) {
                                return Err(last_reason);
                            }
                            continue;
                        }
                    }
                }
                Err(e) => {
                    let code = hresult_of(&e);
                    last_reason = explain(&e);
                    if code == Some(DEVICE_IN_USE) || code == Some(EXCLUSIVE_NOT_ALLOWED) {
                        return Err(last_reason);
                    }
                    continue;
                }
            };
            return finish(client, kind, 2, rate as u32, name.to_string()).map_err(|e| explain(&e));
        }
    }
    Err(last_reason)
}

fn open_shared(device: &wasapi::Device, name: &str) -> Result<Stream, String> {
    let mut client = device.get_iaudioclient().map_err(|e| explain(&e))?;
    let mix = client.get_mixformat().map_err(|e| explain(&e))?;
    let rate = mix.get_samplespersec();
    let (default_period, _) = client.get_device_period().map_err(|e| explain(&e))?;
    let fmt = WaveFormat::new(32, 32, SampleType::Float, rate as usize, 2, None);
    let mode = StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: default_period };
    client.initialize_client(&fmt, Direction::Render, mode, None).map_err(|e| explain(&e))?;
    finish(client, Kind::F32, 2, rate, name.to_string()).map_err(|e| explain(&e))
}

/// Puts the calling thread in the "Pro Audio" MMCSS class; undone on drop.
struct Mmcss(Option<HANDLE>);

impl Mmcss {
    fn enter() -> Self {
        let mut task_index = 0u32;
        // SAFETY: plain Win32 call with a valid string and a valid out pointer.
        let handle = unsafe { AvSetMmThreadCharacteristicsW(w!("Pro Audio"), &mut task_index) };
        Mmcss(handle.ok())
    }
}

impl Drop for Mmcss {
    fn drop(&mut self) {
        if let Some(h) = self.0.take() {
            // SAFETY: `h` came from AvSetMmThreadCharacteristicsW on this thread.
            let _ = unsafe { AvRevertMmThreadCharacteristics(h) };
        }
    }
}

/// Runs on its own thread, which owns every COM object. Sends one message on
/// `ready`, then renders until `stop` is set.
pub fn run(
    device_id: Option<String>,
    frames: u32,
    exclusive: bool,
    inbox: Inbox,
    stats: Arc<EngineStats>,
    stop: Arc<AtomicBool>,
    ready: mpsc::Sender<Result<StartInfo, String>>,
) {
    let com_ok = wasapi::initialize_mta().is_ok();
    run_with_com(device_id.as_deref(), frames, exclusive, inbox, &stats, &stop, &ready);
    if com_ok {
        wasapi::deinitialize();
    }
}

fn run_with_com(
    device_id: Option<&str>,
    frames: u32,
    exclusive: bool,
    inbox: Inbox,
    stats: &Arc<EngineStats>,
    stop: &AtomicBool,
    ready: &mpsc::Sender<Result<StartInfo, String>>,
) {
    let opened = DeviceEnumerator::new()
        .map_err(|e| explain(&e))
        .and_then(|en| find_device(&en, device_id))
        .and_then(|device| {
            let name = device.get_friendlyname().unwrap_or_else(|_| "Sound output".to_string());
            if exclusive {
                open_exclusive(&device, frames, &name)
            } else {
                open_shared(&device, &name)
            }
        });
    let stream = match opened {
        Ok(s) => s,
        Err(reason) => {
            let _ = ready.send(Err(reason));
            return;
        }
    };
    if stop.load(Ordering::Acquire) {
        // The caller gave up while the device was opening: give it back.
        return;
    }
    let backend = if exclusive { "wasapi-exclusive" } else { "wasapi-shared" };
    let core = EngineCore::with_midi(inbox.commands, inbox.midi, Mixer::new(stream.sample_rate, stream.channels))
        .with_bank_link(inbox.banks);
    let info = StartInfo {
        backend: backend.to_string(),
        device_name: stream.device_name.clone(),
        sample_rate: stream.sample_rate,
        buffer_frames: stream.buffer_frames,
        output_latency_ms: stream.latency_ms,
        fallback_reason: None,
    };
    let _mmcss = Mmcss::enter();
    let mut buffers = Buffers::new(&stream);
    let mut core = core;
    // Fill the whole buffer before starting so playback begins with real data.
    if let Err(e) = stream
        .client
        .get_available_space_in_frames()
        .and_then(|n| buffers.write(&stream, &mut core, n.min(stream.buffer_frames)))
        .and_then(|()| stream.client.start_stream())
    {
        let _ = ready.send(Err(explain(&e)));
        return;
    }
    stats.last_buffer_frames.store(stream.buffer_frames, Ordering::Relaxed);
    stats.running.store(true, Ordering::Release);
    if ready.send(Ok(info)).is_err() {
        stats.running.store(false, Ordering::Release);
        let _ = stream.client.stop_stream();
        return;
    }

    render_loop(&stream, &mut buffers, &mut core, stats, stop);

    stats.running.store(false, Ordering::Release);
    let _ = stream.client.stop_stream();
}

/// Scratch space for one buffer, made before the loop starts.
struct Buffers {
    samples: Vec<f32>,
    bytes: Vec<u8>,
}

impl Buffers {
    fn new(s: &Stream) -> Self {
        let n = s.buffer_frames as usize * usize::from(s.channels);
        Self { samples: vec![0.0; n], bytes: vec![0; n * s.kind.bytes()] }
    }

    /// Render `frames` frames and hand them to the device. No allocation.
    fn write(&mut self, s: &Stream, core: &mut EngineCore, frames: u32) -> Result<(), WasapiError> {
        let n = (frames as usize * usize::from(s.channels)).min(self.samples.len());
        if n == 0 {
            return Ok(());
        }
        let samples = &mut self.samples[..n];
        core.process(samples);
        let width = s.kind.bytes();
        let bytes = &mut self.bytes[..n * width];
        match s.kind {
            Kind::F32 => {
                for (out, x) in bytes.chunks_exact_mut(4).zip(samples.iter()) {
                    out.copy_from_slice(&x.to_le_bytes());
                }
            }
            Kind::I16 => {
                for (out, x) in bytes.chunks_exact_mut(2).zip(samples.iter()) {
                    out.copy_from_slice(&f32_to_i16(*x).to_le_bytes());
                }
            }
            Kind::I24In32 => {
                for (out, x) in bytes.chunks_exact_mut(4).zip(samples.iter()) {
                    out.copy_from_slice(&f32_to_i24_in_i32(*x).to_le_bytes());
                }
            }
            Kind::I32 => {
                for (out, x) in bytes.chunks_exact_mut(4).zip(samples.iter()) {
                    out.copy_from_slice(&f32_to_i32(*x).to_le_bytes());
                }
            }
        }
        s.render.write_to_device(bytes, None)
    }
}

/// What waiting for the device event ended with.
enum Wait {
    Ready,
    TimedOut,
    Failed,
}

fn wait_for_device(event: &Handle, timeout_ms: u32) -> Wait {
    // SAFETY: the handle is a live event owned by `Handle` for this whole call.
    let result = unsafe { WaitForSingleObject(event.as_handle(), timeout_ms) };
    if result == WAIT_OBJECT_0 {
        Wait::Ready
    } else if result == WAIT_TIMEOUT {
        Wait::TimedOut
    } else {
        Wait::Failed
    }
}

/// The audio thread's loop. No allocation, locks or logging in here. A real
/// timeout counts as an underrun; a failed wait or write ends the loop and
/// marks the engine as failed instead of spinning.
fn render_loop(s: &Stream, buffers: &mut Buffers, core: &mut EngineCore, stats: &EngineStats, stop: &AtomicBool) {
    while !stop.load(Ordering::Acquire) {
        match wait_for_device(&s.event, EVENT_WAIT_MS) {
            Wait::Ready => {}
            Wait::TimedOut => {
                // The device did not ask for data in time: count it as a glitch.
                stats.underruns.fetch_add(1, Ordering::Relaxed);
                continue;
            }
            Wait::Failed => {
                stats.failed.store(true, Ordering::Release);
                break;
            }
        }
        let Ok(available) = s.client.get_available_space_in_frames() else {
            stats.failed.store(true, Ordering::Release);
            break;
        };
        let frames = available.min(s.buffer_frames);
        if frames == 0 {
            continue;
        }
        if buffers.write(s, core, frames).is_err() {
            stats.failed.store(true, Ordering::Release);
            break;
        }
        stats.callbacks.fetch_add(1, Ordering::Relaxed);
        stats.last_buffer_frames.store(frames, Ordering::Relaxed);
    }
}
