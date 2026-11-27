//! The song player: plays a list of timed note on/off events into the audio
//! core, for Listen mode. It has its own thread and its own lock-free ring
//! into the audio thread (see `Engine::song_sink`), so a song never shares a
//! ring with the player's own keys and is never counted in the latency report.
//! Nothing here runs on the audio thread.
//!
//! Timing: the thread sleeps until a short time before an event, then spins, so
//! an event leaves within a few microseconds of its time on an idle machine.
//! How short depends on the clock: 0.5 ms when its sleeps are precise, 3 ms otherwise.
//! The clock is a trait so tests can run a whole song in virtual time.

use crate::core::Command;
use crate::midi::MidiSink;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread::{self, JoinHandle};
use std::time::Duration;

#[cfg(windows)]
mod win;

/// The most events one song may have.
pub const MAX_EVENTS: usize = 200_000;
/// The longest time a song may name (one day, in ms). Keeps every sum far from overflow.
pub const MAX_TIME_MS: f64 = 86_400_000.0;
/// How long before an event the thread stops sleeping and starts spinning, when sleeps are coarse.
const SPIN_US: u64 = 3_000;
/// The same, when the clock's sleeps are precise (a high-resolution timer). Only Windows has one.
#[cfg(windows)]
const PRECISE_SPIN_US: u64 = 500;
/// How long to wait before trying again after the ring refused a command.
const RETRY_US: u64 = 200;
/// How many times a release is tried before giving up (about 20 ms).
const RELEASE_TRIES: u32 = 100;

/// One note going on or off, `time_ms` into the song.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SongEvent {
    pub time_ms: f64,
    /// 21..=108.
    pub note: u8,
    /// 1..=127 for a note on; ignored for a note off.
    pub velocity: u8,
    pub on: bool,
}

impl SongEvent {
    /// From the numbers JavaScript gives. Note and velocity arrive wider than
    /// a byte, so a silly 316 is refused instead of wrapping to 60.
    pub fn from_raw(time_ms: f64, note: u32, velocity: u32, on: bool) -> Result<Self, String> {
        let note = u8::try_from(note).map_err(|_| "Every song note must be a piano key, 21 to 108.".to_string())?;
        let velocity =
            u8::try_from(velocity).map_err(|_| "Every song velocity must be 1 to 127.".to_string())?;
        Ok(Self { time_ms, note, velocity, on })
    }
}

/// Time for the player thread. The real one reads the engine clock; tests
/// give one that only moves when told to.
pub trait Clock: Send + Sync + 'static {
    /// Microseconds on a clock that only goes forward.
    fn now_us(&self) -> u64;
    /// Sleep about `us` microseconds (a stop request may cut it short).
    fn sleep_us(&self, us: u64);
    /// One turn of a busy wait.
    fn spin(&self);
    /// How long before an event the song thread stops sleeping and spins.
    fn spin_us(&self) -> u64 {
        SPIN_US
    }
    /// Called on the song thread when it starts (priority, timer resolution).
    fn thread_begin(&self) {}
    /// Called on the song thread when it ends, even after a panic.
    fn thread_end(&self) {}
    /// Make a sleeping song thread wake up now (called after a stop is requested).
    fn wake(&self) {}
    /// Forget an earlier `wake`, before a new song thread starts.
    fn clear_wake(&self) {}
}

/// The engine clock. On Windows the thread sleeps on a high-resolution timer
/// (`park_timeout` only wakes on the 15.6 ms tick there); see `win`.
pub struct RealClock {
    #[cfg(windows)]
    win: win::Sleeper,
}

impl RealClock {
    pub fn new() -> Self {
        Self {
            #[cfg(windows)]
            win: win::Sleeper::new(),
        }
    }
}

impl Default for RealClock {
    fn default() -> Self {
        Self::new()
    }
}

impl Clock for RealClock {
    fn now_us(&self) -> u64 {
        crate::core::clock::now_us()
    }

    fn sleep_us(&self, us: u64) {
        #[cfg(windows)]
        if self.win.sleep(us) {
            return;
        }
        // `SongPlayer::stop` unparks the thread, so a long sleep ends at once.
        thread::park_timeout(Duration::from_micros(us));
    }

    fn spin(&self) {
        std::hint::spin_loop();
    }

    fn spin_us(&self) -> u64 {
        #[cfg(windows)]
        if self.win.has_high_res_timer() {
            return PRECISE_SPIN_US;
        }
        SPIN_US
    }

    fn thread_begin(&self) {
        #[cfg(windows)]
        self.win.thread_begin();
    }

    fn thread_end(&self) {
        #[cfg(windows)]
        self.win.thread_end();
    }

    fn wake(&self) {
        #[cfg(windows)]
        self.win.wake();
    }

    fn clear_wake(&self) {
        #[cfg(windows)]
        self.win.clear_wake();
    }
}

/// Where the player's commands go (the song ring into the audio thread).
pub trait SongSink: Send + Sync + 'static {
    /// Never waits. False when the command could not be sent right now.
    fn send(&self, command: Command) -> bool;
}

impl SongSink for MidiSink {
    fn send(&self, command: Command) -> bool {
        self.push(command)
    }
}

fn check(events: &[SongEvent], from_ms: f64) -> Result<(), String> {
    if events.len() > MAX_EVENTS {
        return Err(format!("A song can have at most {MAX_EVENTS} events."));
    }
    let time_ok = |t: f64| t.is_finite() && (0.0..=MAX_TIME_MS).contains(&t);
    if !time_ok(from_ms) {
        return Err("The start time of a song must be 0 or more milliseconds (one day at most).".to_string());
    }
    for e in events {
        if !time_ok(e.time_ms) {
            return Err("Every song event needs a time of 0 or more milliseconds (one day at most).".to_string());
        }
        if !(21..=108).contains(&e.note) {
            return Err("Every song note must be a piano key, 21 to 108.".to_string());
        }
        if e.on && !(1..=127).contains(&e.velocity) {
            return Err("Every song velocity must be 1 to 127.".to_string());
        }
    }
    Ok(())
}

/// When an event is due on the clock. Saturates instead of overflowing.
fn due_us(start_us: u64, time_ms: f64, from_ms: f64) -> u64 {
    start_us.saturating_add(((time_ms - from_ms) * 1000.0) as u64)
}

/// Play `events` (sorted by time) starting at `from_ms`, where `start_us` on
/// `clock` is the moment of `from_ms`. Returns when the song is over or
/// `cancel` is set. Either way every note it still holds is released.
pub fn run_song(
    clock: &dyn Clock,
    sink: &dyn SongSink,
    events: Vec<SongEvent>,
    from_ms: f64,
    start_us: u64,
    cancel: &AtomicBool,
) {
    // Releases what is still held however this function ends, a panic included.
    let mut guard = ReleaseOnDrop { clock, sink, held: [0u8; 128] };
    let held = &mut guard.held;
    let mut next = events.partition_point(|e| e.time_ms < from_ms);
    let spin_us = clock.spin_us();
    while next < events.len() {
        if cancel.load(Ordering::Acquire) {
            break;
        }
        let e = events[next];
        let due = due_us(start_us, e.time_ms, from_ms);
        let now = clock.now_us();
        if now < due {
            let wait = due - now;
            if wait > spin_us {
                clock.sleep_us(wait - spin_us);
            } else {
                clock.spin();
            }
            continue;
        }
        let slot = usize::from(e.note) & 127;
        let sent = if e.on {
            let ok = sink.send(Command::NoteOn { note: e.note, velocity: e.velocity, midi_us: 0 });
            if ok {
                held[slot] = held[slot].saturating_add(1);
            }
            ok
        } else if held[slot] > 1 {
            held[slot] -= 1; // another start of this pitch is still going: no note off yet
            true
        } else if held[slot] == 1 {
            let ok = sink.send(Command::NoteOff { note: e.note });
            if ok {
                held[slot] = 0;
            }
            ok
        } else {
            true // an off for a note this song never started (it began before `from_ms`)
        };
        if sent {
            next += 1;
        } else {
            clock.sleep_us(RETRY_US);
        }
    }
}

/// Sends a note off for every note still held when `run_song` ends. On a
/// panic it is best effort: a sink that panics again is caught.
struct ReleaseOnDrop<'a> {
    clock: &'a dyn Clock,
    sink: &'a dyn SongSink,
    held: [u8; 128],
}

impl Drop for ReleaseOnDrop<'_> {
    fn drop(&mut self) {
        let (clock, sink, held) = (self.clock, self.sink, &self.held);
        let release = std::panic::AssertUnwindSafe(|| {
            // A stop leaves the clock's wake signal set (Windows), which would make
            // every retry below return at once and drop a refused note off.
            clock.clear_wake();
            for (note, count) in held.iter().enumerate() {
                if *count == 0 {
                    continue;
                }
                for _ in 0..RELEASE_TRIES {
                    if sink.send(Command::NoteOff { note: note as u8 }) {
                        break;
                    }
                    clock.sleep_us(RETRY_US);
                }
            }
        });
        let _ = std::panic::catch_unwind(release);
    }
}

struct Active {
    cancel: Arc<AtomicBool>,
    done: Arc<AtomicBool>,
    handle: JoinHandle<()>,
    start_us: u64,
    from_ms: f64,
}

impl Active {
    /// Ask the thread to stop and wait until it has released its notes.
    fn end(self, clock: &dyn Clock) {
        self.cancel.store(true, Ordering::Release);
        self.handle.thread().unpark();
        clock.wake();
        let _ = self.handle.join();
    }
}

/// Ends the song thread's business however it exits.
struct Finish<'a> {
    clock: &'a dyn Clock,
    done: &'a AtomicBool,
}

impl Drop for Finish<'_> {
    fn drop(&mut self) {
        self.clock.thread_end();
        self.done.store(true, Ordering::Release);
    }
}

/// Plays one song at a time on a thread of its own.
pub struct SongPlayer {
    clock: Arc<dyn Clock>,
    sink: Arc<dyn SongSink>,
    active: Mutex<Option<Active>>,
}

impl SongPlayer {
    pub fn new(clock: Arc<dyn Clock>, sink: Arc<dyn SongSink>) -> Self {
        Self { clock, sink, active: Mutex::new(None) }
    }

    fn active(&self) -> MutexGuard<'_, Option<Active>> {
        self.active.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Start `events` at `from_ms` into the song. A song that is already
    /// playing is stopped first and its held notes released. Bad input is
    /// refused and leaves the current song alone.
    pub fn play(&self, mut events: Vec<SongEvent>, from_ms: f64) -> Result<(), String> {
        check(&events, from_ms)?;
        // By time; at the same time a note off goes before a note on.
        events.sort_by(|a, b| a.time_ms.total_cmp(&b.time_ms).then(a.on.cmp(&b.on)));
        let mut slot = self.active();
        if let Some(old) = slot.take() {
            old.end(&*self.clock);
        }
        self.clock.clear_wake();
        let cancel = Arc::new(AtomicBool::new(false));
        let done = Arc::new(AtomicBool::new(false));
        let start_us = self.clock.now_us();
        let handle = {
            let (clock, sink) = (Arc::clone(&self.clock), Arc::clone(&self.sink));
            let (cancel, done) = (Arc::clone(&cancel), Arc::clone(&done));
            thread::Builder::new()
                .name("song-player".to_string())
                .spawn(move || {
                    clock.thread_begin();
                    // Runs on a panic too: the song is over either way.
                    let _end = Finish { clock: &*clock, done: &done };
                    run_song(&*clock, &*sink, events, from_ms, start_us, &cancel);
                })
                .map_err(|e| format!("The song could not start: {e}."))?
        };
        *slot = Some(Active { cancel, done, handle, start_us, from_ms });
        Ok(())
    }

    /// Stop the song and release its held notes. Fine when nothing plays.
    pub fn stop(&self) {
        let old = self.active().take();
        if let Some(old) = old {
            old.end(&*self.clock);
        }
    }

    /// Where the song is, in milliseconds, or `None` when nothing is playing
    /// (stopped, or it reached the end).
    pub fn position_ms(&self) -> Option<f64> {
        let slot = self.active();
        let a = slot.as_ref()?;
        if a.done.load(Ordering::Acquire) {
            return None;
        }
        let elapsed_us = self.clock.now_us().saturating_sub(a.start_us);
        Some(a.from_ms + elapsed_us as f64 / 1000.0)
    }
}

impl Drop for SongPlayer {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests;
