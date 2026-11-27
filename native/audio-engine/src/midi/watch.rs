//! The watcher thread (looks at the port list, connects, reconnects) and the
//! forwarder thread (hands the JS copy of each event to JavaScript).

use super::{pick_port, InputHandler, JsEvent, MidiHub, relock};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// An open MIDI port. Lives on the watcher thread only.
pub trait OpenPort {
    fn close(self: Box<Self>);
}

/// The MIDI system: its port list, and how to open a port.
pub trait PortBackend {
    fn names(&mut self) -> Result<Vec<String>, String>;
    fn open(&mut self, name: &str, handler: InputHandler) -> Result<Box<dyn OpenPort>, String>;
}

const CLIENT_NAME: &str = "Piano Learner";
const NO_MIDI: &str = "MIDI could not start on this computer.";

/// Names of every MIDI input port on this PC. Empty when there is none, also
/// when the computer has no MIDI system at all.
pub fn list_inputs() -> Vec<String> {
    match midir::MidiInput::new(CLIENT_NAME) {
        Ok(input) => input.ports().iter().map(|p| input.port_name(p).unwrap_or_else(|_| "MIDI input".to_string())).collect(),
        Err(_) => Vec::new(),
    }
}

/// The real MIDI system, through midir.
pub struct MidirBackend;

struct MidirPort(midir::MidiInputConnection<()>);

impl OpenPort for MidirPort {
    fn close(self: Box<Self>) {
        self.0.close();
    }
}

impl PortBackend for MidirBackend {
    fn names(&mut self) -> Result<Vec<String>, String> {
        Ok(list_inputs())
    }

    fn open(&mut self, name: &str, mut handler: InputHandler) -> Result<Box<dyn OpenPort>, String> {
        let input = midir::MidiInput::new(CLIENT_NAME).map_err(|_| NO_MIDI.to_string())?;
        // Look the port up again by name: the list may have changed since the watcher read it.
        let port = input
            .ports()
            .into_iter()
            .find(|p| input.port_name(p).is_ok_and(|n| n == name))
            .ok_or("The piano went away before it could be opened.")?;
        let conn = input
            .connect(&port, "Piano Learner input", move |_stamp, bytes, _| handler.handle(bytes), ())
            .map_err(|_| "The piano is busy. Another app may be using it.".to_string())?;
        Ok(Box::new(MidirPort(conn)))
    }
}

/// Sleep until `deadline`, waking early when `stop` is set or a reconnect is
/// asked for (both unpark the watcher).
fn nap(deadline: Instant, stop: &AtomicBool, hub: &MidiHub) {
    while !stop.load(Ordering::Acquire) && !hub.reconnect_requested() {
        let now = Instant::now();
        if now >= deadline {
            return;
        }
        thread::park_timeout(deadline - now);
    }
}

pub(super) fn spawn_watcher<B: PortBackend + Send + 'static>(
    mut backend: B,
    handler: InputHandler,
    hub: Arc<MidiHub>,
    stop: Arc<AtomicBool>,
    interval: Duration,
) -> JoinHandle<()> {
    thread::Builder::new()
        .name("midi-watch".into())
        .spawn(move || {
            // The open port stays on this thread (it may not be `Send`).
            let mut current: Option<(String, Box<dyn OpenPort>)> = None;
            while !stop.load(Ordering::Acquire) {
                let names = backend.names().unwrap_or_default();
                let asked = hub.take_reconnect();
                if current.as_ref().is_some_and(|(n, _)| asked || !names.contains(n)) {
                    if let Some((_, port)) = current.take() {
                        port.close();
                    }
                    hub.set_connected(None);
                }
                if current.is_none() && !stop.load(Ordering::Acquire) {
                    if let Some(i) = pick_port(&names) {
                        match backend.open(&names[i], handler.clone()) {
                            Ok(port) => {
                                hub.set_error(None);
                                hub.set_connected(Some(names[i].clone()));
                                current = Some((names[i].clone(), port));
                            }
                            Err(e) => hub.set_error(Some(e)),
                        }
                    }
                }
                nap(Instant::now() + interval, &stop, &hub);
            }
            if let Some((_, port)) = current.take() {
                port.close();
            }
            hub.set_connected(None);
        })
        .expect("the computer refused a new thread")
}

const BATCH: usize = 256;

pub(super) fn spawn_forwarder(
    mut js: rtrb::Consumer<JsEvent>,
    hub: Arc<MidiHub>,
    stop: Arc<AtomicBool>,
) -> JoinHandle<()> {
    thread::Builder::new()
        .name("midi-forward".into())
        .spawn(move || loop {
            let mut batch = Vec::new();
            while batch.len() < BATCH {
                match js.pop() {
                    Ok(e) => batch.push(e),
                    Err(_) => break,
                }
            }
            if !batch.is_empty() {
                let handler = relock(&hub.handler).clone();
                if let Some(h) = handler {
                    h(batch);
                }
                continue;
            }
            if stop.load(Ordering::Acquire) {
                return;
            }
            // The MIDI callback unparks this thread after each event; the
            // timeout is only a safety net.
            thread::park_timeout(Duration::from_millis(100));
        })
        .expect("the computer refused a new thread")
}

#[cfg(test)]
mod tests {
    use super::super::*;
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    /// A fake MIDI system: tests change the port list and play keys.
    #[derive(Clone, Default)]
    struct Fake {
        ports: Arc<Mutex<Vec<String>>>,
        live: Arc<Mutex<Option<InputHandler>>>,
        opens: Arc<Mutex<u32>>,
        opened_names: Arc<Mutex<Vec<String>>>,
        fail_open: Arc<Mutex<Option<String>>>,
    }

    struct FakeConn(Arc<Mutex<Option<InputHandler>>>);

    impl OpenPort for FakeConn {
        fn close(self: Box<Self>) {
            *self.0.lock().unwrap() = None;
        }
    }

    impl PortBackend for Fake {
        fn names(&mut self) -> Result<Vec<String>, String> {
            Ok(self.ports.lock().unwrap().clone())
        }
        fn open(&mut self, name: &str, handler: InputHandler) -> Result<Box<dyn OpenPort>, String> {
            if let Some(e) = self.fail_open.lock().unwrap().clone() {
                return Err(e);
            }
            self.opened_names.lock().unwrap().push(name.to_string());
            *self.opens.lock().unwrap() += 1;
            *self.live.lock().unwrap() = Some(handler);
            Ok(Box::new(FakeConn(Arc::clone(&self.live))))
        }
    }

    impl Fake {
        fn press(&self, bytes: &[u8]) {
            self.live.lock().unwrap().as_mut().expect("not connected").handle(bytes);
        }
    }

    fn wait_for(what: &str, mut cond: impl FnMut() -> bool) {
        let end = Instant::now() + Duration::from_secs(3);
        while !cond() {
            assert!(Instant::now() < end, "timed out waiting for {what}");
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    fn service() -> MidiService {
        MidiService::new(Arc::new(MidiSink::default()))
    }

    const FAST: Duration = Duration::from_millis(10);

    #[test]
    fn connects_when_a_piano_is_present_and_reports_its_name() {
        let fake = Fake::default();
        fake.ports.lock().unwrap().push("Digital Piano".into());
        let svc = service();
        svc.start_with(fake.clone(), FAST);
        wait_for("connect", || svc.status().connected);
        assert_eq!(svc.status().port_name.as_deref(), Some("Digital Piano"));
        svc.stop();
    }

    #[test]
    fn reports_not_connected_when_there_is_no_port() {
        let svc = service();
        svc.start_with(Fake::default(), FAST);
        std::thread::sleep(Duration::from_millis(60));
        let s = svc.status();
        assert!(!s.connected);
        assert_eq!(s.port_name, None);
        svc.stop();
    }

    #[test]
    fn notices_unplugging_and_reconnects_when_the_piano_returns() {
        let fake = Fake::default();
        fake.ports.lock().unwrap().push("P-121".into());
        let svc = service();
        svc.start_with(fake.clone(), FAST);
        wait_for("connect", || svc.status().connected);
        fake.ports.lock().unwrap().clear();
        wait_for("disconnect", || !svc.status().connected);
        assert!(fake.live.lock().unwrap().is_none(), "the old port is closed");
        fake.ports.lock().unwrap().push("P-121".into());
        wait_for("reconnect", || svc.status().connected);
        assert_eq!(*fake.opens.lock().unwrap(), 2);
        svc.stop();
    }

    #[test]
    fn keys_reach_the_js_callback_in_order() {
        let fake = Fake::default();
        fake.ports.lock().unwrap().push("P-121".into());
        let svc = service();
        let seen: Arc<Mutex<Vec<JsEvent>>> = Arc::default();
        let sink = Arc::clone(&seen);
        svc.set_handler(Some(Arc::new(move |batch: Vec<JsEvent>| sink.lock().unwrap().extend(batch))));
        svc.start_with(fake.clone(), FAST);
        wait_for("connect", || svc.status().connected);
        for note in 60..70u8 {
            fake.press(&[0x90, note, 64]);
        }
        wait_for("events", || seen.lock().unwrap().len() == 10);
        let notes: Vec<u8> = seen.lock().unwrap().iter().map(|e| e.note).collect();
        assert_eq!(notes, (60..70).collect::<Vec<u8>>());
        assert_eq!(svc.status().events, 10);
        svc.stop();
    }

    #[test]
    fn stop_returns_quickly_even_with_a_slow_poll_interval() {
        let svc = service();
        svc.start_with(Fake::default(), Duration::from_secs(2));
        std::thread::sleep(Duration::from_millis(30));
        let t = Instant::now();
        svc.stop();
        assert!(t.elapsed() < Duration::from_millis(100), "stop took {:?}", t.elapsed());
    }

    #[test]
    fn stop_closes_the_port_releases_the_callback_and_is_safe_twice() {
        let fake = Fake::default();
        fake.ports.lock().unwrap().push("P-121".into());
        let svc = service();
        let alive = Arc::new(AtomicBool::new(true));
        struct Flag(Arc<AtomicBool>);
        impl Drop for Flag {
            fn drop(&mut self) {
                self.0.store(false, Ordering::SeqCst);
            }
        }
        let flag = Flag(Arc::clone(&alive));
        svc.set_handler(Some(Arc::new(move |_b: Vec<JsEvent>| {
            let _keep = &flag;
        })));
        svc.start_with(fake.clone(), FAST);
        wait_for("connect", || svc.status().connected);
        svc.stop();
        assert!(fake.live.lock().unwrap().is_none(), "port closed");
        assert!(!svc.status().connected);
        assert!(!alive.load(Ordering::SeqCst), "the JS callback was released");
        svc.stop();
    }

    #[test]
    fn start_twice_runs_only_one_watcher() {
        let fake = Fake::default();
        fake.ports.lock().unwrap().push("P-121".into());
        let svc = service();
        svc.start_with(fake.clone(), FAST);
        svc.start_with(fake.clone(), FAST);
        wait_for("connect", || svc.status().connected);
        std::thread::sleep(Duration::from_millis(80));
        assert_eq!(*fake.opens.lock().unwrap(), 1);
        svc.stop();
    }

    #[test]
    fn the_service_can_start_again_after_a_stop() {
        let fake = Fake::default();
        fake.ports.lock().unwrap().push("P-121".into());
        let svc = service();
        svc.start_with(fake.clone(), FAST);
        wait_for("connect", || svc.status().connected);
        svc.stop();
        svc.start_with(fake.clone(), FAST);
        wait_for("connect again", || svc.status().connected);
        svc.stop();
    }

    #[test]
    fn the_real_midi_system_starts_and_stops_even_with_no_ports() {
        let svc = service();
        svc.start();
        let t = Instant::now();
        svc.stop();
        assert!(t.elapsed() < Duration::from_millis(100));
        let _: Vec<String> = list_inputs(); // no MIDI system here: an empty list, not an error
    }

    #[test]
    fn the_port_is_opened_by_its_name() {
        let fake = Fake::default();
        fake.ports.lock().unwrap().extend(["Loopback".to_string(), "Digital Piano".to_string()]);
        let svc = service();
        svc.start_with(fake.clone(), FAST);
        wait_for("connect", || svc.status().connected);
        assert_eq!(*fake.opened_names.lock().unwrap(), vec!["Digital Piano".to_string()]);
        svc.stop();
    }

    #[test]
    fn a_failed_open_shows_the_error_until_a_connect_clears_it() {
        let fake = Fake::default();
        fake.ports.lock().unwrap().push("P-121".into());
        *fake.fail_open.lock().unwrap() = Some("The piano is busy. Another app may be using it.".into());
        let svc = service();
        svc.start_with(fake.clone(), FAST);
        wait_for("error", || svc.status().error.is_some());
        let s = svc.status();
        assert!(!s.connected);
        assert_eq!(s.error.as_deref(), Some("The piano is busy. Another app may be using it."));
        *fake.fail_open.lock().unwrap() = None;
        wait_for("connect", || svc.status().connected);
        assert_eq!(svc.status().error, None);
        svc.stop();
    }

    #[test]
    fn reconnect_reopens_right_away_without_waiting_for_the_poll() {
        let fake = Fake::default();
        fake.ports.lock().unwrap().push("P-121".into());
        let svc = service();
        svc.start_with(fake.clone(), Duration::from_secs(30));
        wait_for("connect", || svc.status().connected);
        svc.reconnect();
        wait_for("second open", || *fake.opens.lock().unwrap() == 2);
        wait_for("connected again", || svc.status().connected);
        svc.stop();
    }

    #[test]
    fn reconnect_when_not_started_is_harmless() {
        service().reconnect();
    }

    #[test]
    fn the_forwarder_is_woken_by_the_midi_callback_not_by_polling() {
        let fake = Fake::default();
        fake.ports.lock().unwrap().push("P-121".into());
        let svc = service();
        let seen: Arc<Mutex<u32>> = Arc::default();
        let count = Arc::clone(&seen);
        svc.set_handler(Some(Arc::new(move |b: Vec<JsEvent>| *count.lock().unwrap() += b.len() as u32)));
        svc.start_with(fake.clone(), FAST);
        wait_for("connect", || svc.status().connected);
        for i in 1..=8u32 {
            std::thread::sleep(Duration::from_millis(130)); // the forwarder is parked
            let t = Instant::now();
            fake.press(&[0x90, 60, 64]);
            wait_for("event", || *seen.lock().unwrap() == i);
            assert!(t.elapsed() < Duration::from_millis(40), "took {:?}", t.elapsed());
        }
        svc.stop();
    }
}
