//! ASIO output through cpal's ASIO host. Only compiled on Windows with the
//! `asio` feature (the Windows CI build turns it on). The device is opened with
//! a fixed buffer size: the one asked for, clamped to the driver's range; if the
//! driver still refuses it, `open` retries with the driver's preferred size
//! (`prefer_default`).

use super::{cpal_out, Inbox, OutputDevice, StartInfo};
use crate::core::EngineStats;
use std::sync::atomic::AtomicBool;
use std::sync::{mpsc, Arc};

/// Every installed ASIO driver. Empty when there is none.
pub fn list() -> Vec<OutputDevice> {
    match cpal::host_from_id(cpal::HostId::Asio) {
        Ok(host) => cpal_out::list(&host, "asio"),
        Err(_) => Vec::new(),
    }
}

/// Runs on the control thread that owns the ASIO stream.
pub fn run(
    device_id: Option<String>,
    frames: u32,
    prefer_default: bool,
    inbox: Inbox,
    stats: Arc<EngineStats>,
    stop: Arc<AtomicBool>,
    ready: mpsc::Sender<Result<StartInfo, String>>,
) {
    match cpal::host_from_id(cpal::HostId::Asio) {
        Ok(host) => cpal_out::run(host, "asio", device_id, frames, prefer_default, inbox, stats, stop, ready),
        Err(_) => {
            let _ = ready.send(Err(
                "No ASIO driver was found. Install the ASIO driver for your sound device first.".to_string(),
            ));
        }
    }
}
