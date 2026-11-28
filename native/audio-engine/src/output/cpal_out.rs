//! cpal backend: the only backend on Linux and macOS, the fallback on Windows
//! and the way into ASIO (an ASIO host is just another cpal host).

use super::{f32_to_i16, f32_to_i32, latency_ms, snap_buffer, OutputDevice, StartInfo, BUFFER_REFUSED, Inbox};
use crate::core::{EngineCore, EngineStats, Mixer};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, ErrorKind, Host, SampleFormat, StreamConfig, SupportedBufferSize};
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

/// Largest chunk rendered at once; bigger callbacks are filled in pieces.
const SCRATCH_SAMPLES: usize = 16_384;

/// Devices of one cpal host. Never fails: a host that is not there lists nothing.
pub fn list(host: &Host, backend: &str) -> Vec<OutputDevice> {
    let default_id = host.default_output_device().and_then(|d| d.id().ok()).map(|i| i.to_string());
    let Ok(devices) = host.output_devices() else {
        return Vec::new();
    };
    devices
        .filter_map(|d| {
            let id = d.id().ok()?.to_string();
            let name = d.description().ok()?.name().to_string();
            let is_default = default_id.as_deref() == Some(id.as_str());
            Some(OutputDevice { id, name, is_default, backend: backend.to_string() })
        })
        .collect()
}

fn find_device(host: &Host, device_id: Option<&str>) -> Result<cpal::Device, String> {
    match device_id {
        Some(text) => {
            let id = cpal::DeviceId::from_str(text)
                .map_err(|_| "That sound output was not found.".to_string())?;
            host.device_by_id(&id).ok_or_else(|| "That sound output was not found.".to_string())
        }
        None => host
            .default_output_device()
            .ok_or_else(|| "No sound output was found.".to_string()),
    }
}

/// Prefer 48000 then 44100 Hz, two channels, then f32; else the device default.
fn pick_config(device: &cpal::Device) -> Result<cpal::SupportedStreamConfig, String> {
    let mut best: Option<((u8, u8, u8), cpal::SupportedStreamConfig)> = None;
    if let Ok(ranges) = device.supported_output_configs() {
        for range in ranges {
            for (rate_rank, rate) in [(2u8, 48_000u32), (1, 44_100)] {
                if let Some(c) = range.try_with_sample_rate(rate) {
                    let score = (
                        rate_rank,
                        u8::from(c.channels() == 2),
                        u8::from(c.sample_format() == SampleFormat::F32),
                    );
                    if best.as_ref().is_none_or(|(s, _)| score > *s) {
                        best = Some((score, c));
                    }
                }
            }
        }
    }
    match best {
        Some((_, c)) => Ok(c),
        None => device.default_output_config().map_err(friendly),
    }
}

fn friendly(e: cpal::Error) -> String {
    if e.kind() == ErrorKind::UnsupportedOperation {
        if let Some(m) = e.message() {
            return m.to_string();
        }
    }
    match e.kind() {
        ErrorKind::DeviceBusy => {
            "The sound device is busy. Another app may be using it on its own. Close other sound apps and press Try again.".to_string()
        }
        ErrorKind::DeviceNotAvailable => {
            "The sound device is not available. It may have been unplugged.".to_string()
        }
        ErrorKind::PermissionDenied => "Windows did not allow PianoLearner to use the sound device.".to_string(),
        ErrorKind::UnsupportedConfig => {
            "The sound device does not support the sound format PianoLearner needs.".to_string()
        }
        ErrorKind::HostUnavailable => "No sound output was found.".to_string(),
        _ => "The sound device could not be opened.".to_string(),
    }
}

/// Build the stream for sample type `T`. `convert` turns the f32 mix into `T`.
#[allow(clippy::too_many_arguments)]
fn build<T>(
    device: &cpal::Device,
    config: StreamConfig,
    mut core: EngineCore,
    stats: &Arc<EngineStats>,
    convert: fn(f32) -> T,
) -> Result<cpal::Stream, cpal::Error>
where
    T: cpal::SizedSample + Send + 'static,
{
    let channels = usize::from(config.channels.max(1));
    let chunk = (SCRATCH_SAMPLES / channels) * channels;
    let mut scratch = vec![0.0f32; chunk];
    let cb_stats = Arc::clone(stats);
    let err_stats = Arc::clone(stats);
    device.build_output_stream(
        config,
        move |data: &mut [T], info: &cpal::OutputCallbackInfo| {
            // Audio thread: no allocation, locks or logging from here on.
            let ts = info.timestamp();
            if let Some(gap) = ts.playback.checked_duration_since(ts.callback) {
                let us = gap.as_micros().min(u128::from(u32::MAX)) as u32;
                cb_stats.measured_latency_us.store(us, Ordering::Relaxed);
            }
            for piece in data.chunks_mut(chunk) {
                let buf = &mut scratch[..piece.len()];
                core.process(buf);
                for (o, s) in piece.iter_mut().zip(buf.iter()) {
                    *o = convert(*s);
                }
            }
            cb_stats.callbacks.fetch_add(1, Ordering::Relaxed);
            cb_stats.last_buffer_frames.store((data.len() / channels) as u32, Ordering::Relaxed);
        },
        move |e| {
            if e.kind() == ErrorKind::Xrun {
                err_stats.underruns.fetch_add(1, Ordering::Relaxed);
            }
        },
        None,
    )
}

fn build_for_format(
    device: &cpal::Device,
    config: StreamConfig,
    format: SampleFormat,
    core: EngineCore,
    stats: &Arc<EngineStats>,
) -> Result<cpal::Stream, cpal::Error> {
    match format {
        SampleFormat::F32 => build::<f32>(device, config, core, stats, |x| x),
        SampleFormat::I16 => build::<i16>(device, config, core, stats, f32_to_i16),
        SampleFormat::I32 => build::<i32>(device, config, core, stats, f32_to_i32),
        SampleFormat::F64 => build::<f64>(device, config, core, stats, f64::from),
        SampleFormat::U16 => {
            build::<u16>(device, config, core, stats, |x| ((x.clamp(-1.0, 1.0) + 1.0) * 32_767.5) as u16)
        }
        _ => Err(cpal::Error::with_message(
            ErrorKind::UnsupportedOperation,
            "The sound device needs a sound format PianoLearner cannot play yet.",
        )),
    }
}

/// Runs on the control thread that owns the stream. Sends one message on
/// `ready`, then waits for `stop`.
#[allow(clippy::too_many_arguments)]
pub fn run(
    host: Host,
    backend: &'static str,
    device_id: Option<String>,
    frames: u32,
    prefer_default: bool,
    inbox: Inbox,
    stats: Arc<EngineStats>,
    stop: Arc<AtomicBool>,
    ready: mpsc::Sender<Result<StartInfo, String>>,
) {
    let opened = open_stream(&host, backend, device_id.as_deref(), frames, prefer_default, inbox, &stats);
    let stream = match opened {
        Ok((stream, _)) if stop.load(Ordering::Acquire) => {
            // The caller gave up while the device was opening: give it back.
            drop(stream);
            return;
        }
        Ok((stream, mut info)) => {
            // Let a few callbacks happen so the driver's own delay is known.
            for _ in 0..60 {
                if stats.measured_latency_us.load(Ordering::Relaxed) > 0 {
                    break;
                }
                thread::sleep(Duration::from_millis(5));
            }
            let measured = stats.measured_latency_us.load(Ordering::Relaxed);
            info.output_latency_ms = latency_ms(info.buffer_frames, info.sample_rate, measured);
            stats.last_buffer_frames.store(info.buffer_frames, Ordering::Relaxed);
            stats.running.store(true, Ordering::Release);
            if ready.send(Ok(info)).is_err() {
                stats.running.store(false, Ordering::Release);
                return;
            }
            stream
        }
        Err(reason) => {
            let _ = ready.send(Err(reason));
            return;
        }
    };
    while !stop.load(Ordering::Acquire) {
        thread::park_timeout(Duration::from_millis(50));
    }
    stats.running.store(false, Ordering::Release);
    drop(stream);
}

fn open_stream(
    host: &Host,
    backend: &'static str,
    device_id: Option<&str>,
    frames: u32,
    prefer_default: bool,
    inbox: Inbox,
    stats: &Arc<EngineStats>,
) -> Result<(cpal::Stream, StartInfo), String> {
    let device = find_device(host, device_id)?;
    let supported = pick_config(&device)?;
    let sample_rate = supported.sample_rate();
    let format = supported.sample_format();
    // Ask for the wanted buffer, kept inside what the device allows.
    // cpal gives only the range, not the driver's step, so a size the driver
    // dislikes is refused later and `open` retries with the driver's own size.
    let wanted = match supported.buffer_size() {
        _ if prefer_default => BufferSize::Default,
        SupportedBufferSize::Range { min, max } => BufferSize::Fixed(snap_buffer(frames, *min, *max, 1)),
        SupportedBufferSize::Unknown => BufferSize::Default,
    };
    let mut config = supported.config();
    config.buffer_size = wanted;
    let channels = config.channels;

    let core = EngineCore::with_midi(inbox.commands, inbox.midi, Mixer::new(sample_rate, channels))
        .with_song(inbox.song)
        .with_bank_link(inbox.banks);
    let stream = build_for_format(&device, config, format, core, stats).map_err(|e| {
        if e.kind() == ErrorKind::UnsupportedConfig && matches!(config.buffer_size, BufferSize::Fixed(_)) {
            BUFFER_REFUSED.to_string()
        } else {
            friendly(e)
        }
    })?;
    stream.play().map_err(friendly)?;
    let buffer_frames = stream.buffer_size().ok().filter(|f| *f > 0).unwrap_or(match config.buffer_size {
        BufferSize::Fixed(f) => f,
        BufferSize::Default => frames,
    });
    let name = device.description().map(|d| d.name().to_string()).unwrap_or_else(|_| "Sound output".to_string());
    let info = StartInfo {
        backend: backend.to_string(),
        device_name: name,
        sample_rate,
        buffer_frames,
        output_latency_ms: f64::from(buffer_frames) * 1000.0 / f64::from(sample_rate),
        fallback_reason: None,
        sample_format: String::new(),
    };
    Ok((stream, info))
}
