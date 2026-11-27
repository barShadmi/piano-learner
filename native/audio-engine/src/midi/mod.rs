//! MIDI input: the piano's keys in. The MIDI thread (midir's callback) parses
//! each message and sends it two ways: to the audio thread through a lock-free
//! ring (that is how sound happens), and to JavaScript through a second ring
//! and a forwarder thread (that is only for the screens, and may lag).
//! Nothing here runs on the audio thread.

pub mod local;
pub mod watch;

use crate::core::midi_msg::{self, MidiEvent};
use crate::core::Command;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, TryLockError};
use std::thread::{JoinHandle, Thread};
use std::time::Duration;

pub use local::LocalState;
pub use watch::{list_inputs, MidirBackend, OpenPort, OutPort, PortBackend};

/// Room for pending key events between the MIDI thread and the audio thread.
pub const MIDI_CAPACITY: usize = 256;
/// Room for pending key events between the MIDI thread and the JS forwarder.
pub const JS_CAPACITY: usize = 1024;
/// How often the watcher looks at the port list.
pub const POLL_INTERVAL: Duration = Duration::from_secs(2);

/// Microseconds on a clock that only goes forward (zero at the first call in
/// this process). Every event is stamped with it as the MIDI thread sees it.
pub fn now_us() -> u64 {
    crate::core::clock::now_us()
}

fn relock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Which port to use: one that looks like the P-121 (or a "Digital Piano" or
/// anything Yamaha), else the first one. `None` when there are no ports.
pub fn pick_port(names: &[String]) -> Option<usize> {
    names.iter().position(|n| looks_like_piano(n)).or(if names.is_empty() { None } else { Some(0) })
}

/// Whether a port name looks like the P-121, a digital piano or a Yamaha.
pub fn looks_like_piano(name: &str) -> bool {
    let n = name.to_lowercase();
    n.contains("p-121") || n.contains("p121") || n.contains("digital piano") || n.contains("yamaha")
}

/// Where the MIDI thread puts commands for the audio thread. The producer is
/// swapped each time the output starts or stops. Only the MIDI callback (with
/// `try_lock`) and start/stop touch this; the audio thread never sees it.
#[derive(Default)]
pub struct MidiSink {
    producer: Mutex<Option<rtrb::Producer<Command>>>,
}

impl MidiSink {
    /// Install the producer of a freshly started output (or `None` when the
    /// output stopped). Called from start/stop, never from the MIDI thread.
    pub fn set(&self, producer: Option<rtrb::Producer<Command>>) {
        *relock(&self.producer) = producer;
    }

    /// Send a command to the audio thread. Never waits. False when nothing
    /// could be sent because the lock was busy or the ring was full. With no
    /// output running there is nobody to send to, which is not a drop.
    pub fn push(&self, command: Command) -> bool {
        match self.producer.try_lock() {
            Ok(mut guard) => match guard.as_mut() {
                Some(p) => p.push(command).is_ok(),
                None => true,
            },
            Err(TryLockError::Poisoned(e)) => e.into_inner().as_mut().is_none_or(|p| p.push(command).is_ok()),
            Err(TryLockError::WouldBlock) => false,
        }
    }

    #[cfg(test)]
    fn lock_for_test(&self) -> MutexGuard<'_, Option<rtrb::Producer<Command>>> {
        relock(&self.producer)
    }
}

/// What kind of event JavaScript is told about.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JsKind {
    On,
    Off,
    Sustain,
    AllOff,
}

impl JsKind {
    pub fn as_str(self) -> &'static str {
        match self {
            JsKind::On => "on",
            JsKind::Off => "off",
            JsKind::Sustain => "sustain",
            JsKind::AllOff => "allOff",
        }
    }
}

/// The copy of a key event that goes to the screens.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct JsEvent {
    pub kind: JsKind,
    pub note: u8,
    pub velocity: u8,
    /// Only for `Sustain`: true = pedal down.
    pub down: Option<bool>,
    /// Microseconds on the `now_us` clock when the MIDI thread got it.
    pub time_us: u64,
}

impl JsEvent {
    pub fn new(event: MidiEvent, time_us: u64) -> Self {
        let (kind, note, velocity, down) = match event {
            MidiEvent::NoteOn { note, velocity } => (JsKind::On, note, velocity, None),
            MidiEvent::NoteOff { note } => (JsKind::Off, note, 0, None),
            MidiEvent::Sustain(d) => (JsKind::Sustain, 0, 0, Some(d)),
            MidiEvent::AllNotesOff => (JsKind::AllOff, 0, 0, None),
        };
        Self { kind, note, velocity, down, time_us }
    }
}

/// Called with each batch of events, on the forwarder thread.
pub type EventHandler = Arc<dyn Fn(Vec<JsEvent>) + Send + Sync>;

/// State shared by the MIDI thread, the watcher, the forwarder and `status`.
pub struct MidiHub {
    sink: Arc<MidiSink>,
    events: AtomicU64,
    dropped_sound: AtomicU64,
    dropped_screen: AtomicU64,
    connected: AtomicBool,
    reconnect: AtomicBool,
    /// Whether the piano's own speakers should be switched off (Local Control off).
    local_off: AtomicBool,
    /// The setting changed and the watcher has not applied it yet.
    local_changed: AtomicBool,
    /// A `LocalState` as a number.
    local_state: AtomicU8,
    port_name: Mutex<Option<String>>,
    error: Mutex<Option<String>>,
    handler: Mutex<Option<EventHandler>>,
}

impl MidiHub {
    pub fn new(sink: Arc<MidiSink>) -> Self {
        Self {
            sink,
            events: AtomicU64::new(0),
            dropped_sound: AtomicU64::new(0),
            dropped_screen: AtomicU64::new(0),
            connected: AtomicBool::new(false),
            reconnect: AtomicBool::new(false),
            local_off: AtomicBool::new(true),
            local_changed: AtomicBool::new(false),
            local_state: AtomicU8::new(LocalState::Unknown.to_u8()),
            port_name: Mutex::new(None),
            error: Mutex::new(None),
            handler: Mutex::new(None),
        }
    }

    pub fn events(&self) -> u64 {
        self.events.load(Ordering::Relaxed)
    }

    /// Keys that did not reach the audio thread (ring full or lock busy).
    pub fn dropped_sound(&self) -> u64 {
        self.dropped_sound.load(Ordering::Relaxed)
    }

    /// Keys that did not reach the screens (ring full or JS refused them).
    pub fn dropped_screen(&self) -> u64 {
        self.dropped_screen.load(Ordering::Relaxed)
    }

    /// Whether a reconnect was asked for (and clears the request).
    pub(crate) fn take_reconnect(&self) -> bool {
        self.reconnect.swap(false, Ordering::AcqRel)
    }

    pub(crate) fn reconnect_requested(&self) -> bool {
        self.reconnect.load(Ordering::Acquire)
    }

    pub(crate) fn local_off(&self) -> bool {
        self.local_off.load(Ordering::Acquire)
    }

    pub(crate) fn take_local_changed(&self) -> bool {
        self.local_changed.swap(false, Ordering::AcqRel)
    }

    pub(crate) fn local_changed_requested(&self) -> bool {
        self.local_changed.load(Ordering::Acquire)
    }

    pub(crate) fn set_local_state(&self, state: LocalState) {
        self.local_state.store(state.to_u8(), Ordering::Release);
    }

    pub(crate) fn set_error(&self, error: Option<String>) {
        *relock(&self.error) = error;
    }

    pub(crate) fn set_connected(&self, name: Option<String>) {
        *relock(&self.port_name) = name.clone();
        self.connected.store(name.is_some(), Ordering::Release);
    }
}

/// What the MIDI callback does with each message. Cheap to clone: the JS ring
/// producer is shared, and only one MIDI callback runs at a time.
#[derive(Clone)]
pub struct InputHandler {
    hub: Arc<MidiHub>,
    js: Arc<Mutex<rtrb::Producer<JsEvent>>>,
    /// The forwarder thread, woken after each event.
    wake: Option<Thread>,
}

impl InputHandler {
    pub fn new(hub: Arc<MidiHub>, js: rtrb::Producer<JsEvent>) -> Self {
        Self { hub, js: Arc::new(Mutex::new(js)), wake: None }
    }

    /// Wake this thread (the forwarder) after every event pushed for JS.
    pub fn with_wake(mut self, thread: Thread) -> Self {
        self.wake = Some(thread);
        self
    }

    /// One raw MIDI message. Never blocks and never allocates.
    pub fn handle(&mut self, bytes: &[u8]) {
        let Some(event) = midi_msg::parse(bytes) else { return };
        let time_us = now_us();
        self.hub.events.fetch_add(1, Ordering::Relaxed);
        if !self.hub.sink.push(event.into_command(time_us)) {
            self.hub.dropped_sound.fetch_add(1, Ordering::Relaxed);
        }
        let pushed = match self.js.try_lock() {
            Ok(mut p) => p.push(JsEvent::new(event, time_us)).is_ok(),
            Err(_) => false,
        };
        if pushed {
            if let Some(t) = &self.wake {
                t.unpark();
            }
        } else {
            self.hub.dropped_screen.fetch_add(1, Ordering::Relaxed);
        }
    }
}

/// What `midiStatus()` tells the screens.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MidiStatus {
    pub connected: bool,
    pub port_name: Option<String>,
    /// Why the last attempt to open the piano failed (cleared on connect).
    pub error: Option<String>,
    pub events: u64,
    pub dropped_sound: u64,
    pub dropped_screen: u64,
    /// Whether the piano's own speakers are off (we switched Local Control off).
    pub local_control: LocalState,
}

struct Threads {
    stop: Arc<AtomicBool>,
    watcher: JoinHandle<()>,
    forwarder: JoinHandle<()>,
}

/// Starts and stops the watcher and forwarder threads.
pub struct MidiService {
    hub: Arc<MidiHub>,
    threads: Mutex<Option<Threads>>,
}

impl MidiService {
    pub fn new(sink: Arc<MidiSink>) -> Self {
        Self { hub: Arc::new(MidiHub::new(sink)), threads: Mutex::new(None) }
    }

    pub fn status(&self) -> MidiStatus {
        MidiStatus {
            connected: self.hub.connected.load(Ordering::Acquire),
            port_name: relock(&self.hub.port_name).clone(),
            error: relock(&self.hub.error).clone(),
            events: self.hub.events(),
            dropped_sound: self.hub.dropped_sound(),
            dropped_screen: self.hub.dropped_screen(),
            local_control: LocalState::from_u8(self.hub.local_state.load(Ordering::Acquire)),
        }
    }

    /// Keep the piano's own speakers off (true, the default) or let them play
    /// too (false). Applies at once when the piano is connected, and is used
    /// at every later connect. Fine to call before `start`.
    pub fn set_local_control_off(&self, off: bool) {
        self.hub.local_off.store(off, Ordering::Release);
        self.hub.local_changed.store(true, Ordering::Release);
        if let Some(t) = relock(&self.threads).as_ref() {
            t.watcher.thread().unpark();
        }
    }

    /// Count keys the JS side could not take (called by the API layer).
    pub fn note_screen_drops(&self, n: u64) {
        self.hub.dropped_screen.fetch_add(n, Ordering::Relaxed);
    }

    /// Close the piano's connection and open it again right away, without
    /// waiting for the next look at the port list. Does nothing if not started.
    pub fn reconnect(&self) {
        if let Some(t) = relock(&self.threads).as_ref() {
            self.hub.reconnect.store(true, Ordering::Release);
            t.watcher.thread().unpark();
        }
    }

    /// Who gets the key events (`None` to stop telling anyone).
    pub fn set_handler(&self, handler: Option<EventHandler>) {
        *relock(&self.hub.handler) = handler;
    }

    /// Start looking for the piano with the real MIDI system. Does nothing if
    /// already started.
    pub fn start(&self) {
        self.start_with(MidirBackend, POLL_INTERVAL);
    }

    pub fn start_with<B: PortBackend + Send + 'static>(&self, backend: B, interval: Duration) {
        let mut threads = relock(&self.threads);
        if threads.is_some() {
            return;
        }
        let stop = Arc::new(AtomicBool::new(false));
        let (js_tx, js_rx) = rtrb::RingBuffer::new(JS_CAPACITY);
        let forwarder = watch::spawn_forwarder(js_rx, Arc::clone(&self.hub), Arc::clone(&stop));
        let handler = InputHandler::new(Arc::clone(&self.hub), js_tx).with_wake(forwarder.thread().clone());
        let watcher = watch::spawn_watcher(backend, handler, Arc::clone(&self.hub), Arc::clone(&stop), interval);
        *threads = Some(Threads { stop, watcher, forwarder });
    }

    /// Stop looking, close the port and let go of the JS callback. Quick, and
    /// fine to call when not started.
    pub fn stop(&self) {
        let threads = relock(&self.threads).take();
        if let Some(t) = threads {
            t.stop.store(true, Ordering::Release);
            t.watcher.thread().unpark();
            t.forwarder.thread().unpark();
            let _ = t.watcher.join();
            let _ = t.forwarder.join();
        }
        self.hub.set_connected(None);
        self.hub.set_local_state(LocalState::Unknown);
        self.hub.set_error(None);
        self.set_handler(None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{channel, Command};
    use std::sync::Arc;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn pick_port_prefers_a_digital_piano_over_other_ports() {
        assert_eq!(pick_port(&names(&["Microsoft GS Wavetable", "Digital Piano"])), Some(1));
    }

    #[test]
    fn pick_port_matches_p121_in_any_case() {
        assert_eq!(pick_port(&names(&["P-121"])), Some(0));
        assert_eq!(pick_port(&names(&["Loopback", "yamaha p121 port"])), Some(1));
    }

    #[test]
    fn pick_port_falls_back_to_the_first_port() {
        assert_eq!(pick_port(&names(&["USB Keystation"])), Some(0));
        assert_eq!(pick_port(&names(&["Keystation", "Other"])), Some(0));
    }

    #[test]
    fn pick_port_with_no_ports_is_none() {
        assert_eq!(pick_port(&[]), None);
    }

    fn handler(sink: &Arc<MidiSink>) -> (InputHandler, Arc<MidiHub>, rtrb::Consumer<JsEvent>) {
        let hub = Arc::new(MidiHub::new(Arc::clone(sink)));
        let (js_tx, js_rx) = channel_js(64);
        (InputHandler::new(Arc::clone(&hub), js_tx), hub, js_rx)
    }

    fn channel_js(n: usize) -> (rtrb::Producer<JsEvent>, rtrb::Consumer<JsEvent>) {
        rtrb::RingBuffer::new(n)
    }

    #[test]
    fn the_js_copy_keeps_order_and_times_never_go_back() {
        let sink = Arc::new(MidiSink::default());
        let (mut h, hub, mut js) = handler(&sink);
        h.handle(&[0x90, 60, 100]);
        h.handle(&[0xFE]); // active sensing: ignored
        h.handle(&[0xB0, 64, 127]);
        h.handle(&[0x80, 60, 0]);
        h.handle(&[0xB0, 123, 0]);
        let got: Vec<JsEvent> = std::iter::from_fn(|| js.pop().ok()).collect();
        let kinds: Vec<_> = got.iter().map(|e| (e.kind, e.note, e.velocity, e.down)).collect();
        assert_eq!(
            kinds,
            vec![
                (JsKind::On, 60, 100, None),
                (JsKind::Sustain, 0, 0, Some(true)),
                (JsKind::Off, 60, 0, None),
                (JsKind::AllOff, 0, 0, None),
            ]
        );
        assert!(got.windows(2).all(|w| w[0].time_us <= w[1].time_us));
        assert_eq!(hub.events(), 4);
    }

    #[test]
    fn events_reach_the_audio_ring_as_commands() {
        let sink = Arc::new(MidiSink::default());
        let (tx, mut rx) = channel(16);
        sink.set(Some(tx));
        let (mut h, hub, _js) = handler(&sink);
        h.handle(&[0x90, 69, 90]);
        h.handle(&[0x80, 69, 0]);
        assert!(matches!(rx.pop(), Ok(Command::NoteOn { note: 69, velocity: 90, .. })));
        assert_eq!(rx.pop(), Ok(Command::NoteOff { note: 69 }));
        assert_eq!((hub.dropped_sound(), hub.dropped_screen()), (0, 0));
    }

    #[test]
    fn events_after_a_restart_reach_the_new_consumer() {
        let sink = Arc::new(MidiSink::default());
        let (tx1, mut rx1) = channel(16);
        sink.set(Some(tx1));
        let (mut h, _hub, _js) = handler(&sink);
        h.handle(&[0x90, 60, 80]);
        let (tx2, mut rx2) = channel(16);
        sink.set(Some(tx2)); // the output restarted
        h.handle(&[0x90, 62, 80]);
        assert!(matches!(rx1.pop(), Ok(Command::NoteOn { note: 60, velocity: 80, .. })));
        assert!(rx1.pop().is_err(), "the old consumer gets nothing new");
        assert!(matches!(rx2.pop(), Ok(Command::NoteOn { note: 62, velocity: 80, .. })));
    }

    #[test]
    fn with_no_output_running_events_still_go_to_js_and_nothing_is_dropped() {
        let sink = Arc::new(MidiSink::default());
        let (mut h, hub, mut js) = handler(&sink);
        h.handle(&[0x90, 60, 80]);
        assert!(js.pop().is_ok());
        assert_eq!((hub.dropped_sound(), hub.dropped_screen()), (0, 0));
    }

    #[test]
    fn a_full_audio_ring_counts_a_dropped_event() {
        let sink = Arc::new(MidiSink::default());
        let (tx, _rx) = channel(1);
        sink.set(Some(tx));
        let (mut h, hub, _js) = handler(&sink);
        h.handle(&[0x90, 60, 80]);
        h.handle(&[0x90, 61, 80]);
        assert_eq!((hub.dropped_sound(), hub.dropped_screen()), (1, 0));
    }

    #[test]
    fn a_busy_lock_counts_a_dropped_event_and_never_waits() {
        let sink = Arc::new(MidiSink::default());
        let (tx, _rx) = channel(16);
        sink.set(Some(tx));
        let (mut h, hub, mut js) = handler(&sink);
        let guard = sink.lock_for_test();
        h.handle(&[0x90, 60, 80]); // would hang if it waited
        drop(guard);
        assert_eq!((hub.dropped_sound(), hub.dropped_screen()), (1, 0));
        assert!(js.pop().is_ok(), "JS still gets the event");
    }

    #[test]
    fn a_full_js_ring_counts_a_dropped_event() {
        let sink = Arc::new(MidiSink::default());
        let hub = Arc::new(MidiHub::new(Arc::clone(&sink)));
        let (js_tx, _js_rx) = channel_js(1);
        let mut h = InputHandler::new(Arc::clone(&hub), js_tx);
        h.handle(&[0x90, 60, 80]);
        h.handle(&[0x90, 61, 80]);
        assert_eq!((hub.dropped_sound(), hub.dropped_screen()), (0, 1));
        assert_eq!(hub.events(), 2);
    }

    #[test]
    fn a_key_dropped_on_both_paths_counts_once_in_each_counter() {
        let sink = Arc::new(MidiSink::default());
        let (tx, _rx) = channel(1);
        sink.set(Some(tx));
        let hub = Arc::new(MidiHub::new(Arc::clone(&sink)));
        let (js_tx, _js_rx) = channel_js(1);
        let mut h = InputHandler::new(Arc::clone(&hub), js_tx);
        h.handle(&[0x90, 60, 80]);
        h.handle(&[0x90, 61, 80]); // both rings are full now
        assert_eq!((hub.dropped_sound(), hub.dropped_screen()), (1, 1));
    }

    #[test]
    fn screen_drops_reported_by_the_js_side_are_counted() {
        let svc = MidiService::new(Arc::new(MidiSink::default()));
        svc.note_screen_drops(3);
        let s = svc.status();
        assert_eq!((s.dropped_sound, s.dropped_screen), (0, 3));
    }

    #[test]
    fn the_audio_ring_note_carries_the_same_stamp_the_screens_get() {
        let sink = Arc::new(MidiSink::default());
        let (tx, mut rx) = channel(16);
        sink.set(Some(tx));
        let (mut h, _hub, mut js) = handler(&sink);
        let before = now_us();
        h.handle(&[0x90, 69, 90]);
        let after = now_us();
        let Ok(Command::NoteOn { midi_us, .. }) = rx.pop() else { panic!("a note on") };
        assert_eq!(midi_us, js.pop().unwrap().time_us, "one stamp, taken once in the callback");
        assert!((before..=after).contains(&midi_us));
    }

    #[test]
    fn the_midi_clock_is_the_shared_engine_clock() {
        let a = crate::core::clock::now_us();
        let m = now_us();
        let b = crate::core::clock::now_us();
        assert!(a <= m && m <= b);
    }
}
