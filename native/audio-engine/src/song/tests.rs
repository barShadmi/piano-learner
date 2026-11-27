use super::*;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Virtual time: sleeping moves it forward (a little late, like a real OS),
/// and every spin moves it forward by 10 microseconds.
struct FakeClock {
    now: AtomicU64,
    overshoot_us: u64,
    spins: AtomicU64,
    sleeps: Mutex<Vec<u64>>,
}

impl FakeClock {
    fn new(start_us: u64, overshoot_us: u64) -> Arc<Self> {
        Arc::new(Self { now: AtomicU64::new(start_us), overshoot_us, spins: AtomicU64::new(0), sleeps: Mutex::new(Vec::new()) })
    }
}

impl Clock for FakeClock {
    fn now_us(&self) -> u64 {
        self.now.load(Ordering::SeqCst)
    }
    fn sleep_us(&self, us: u64) {
        self.sleeps.lock().unwrap().push(us);
        self.now.fetch_add(us + self.overshoot_us, Ordering::SeqCst);
    }
    fn spin(&self) {
        self.spins.fetch_add(1, Ordering::SeqCst);
        self.now.fetch_add(10, Ordering::SeqCst);
    }
}

/// Records every command with the time (on the given clock) it was sent.
/// `refuse` makes the next sends fail, like a full ring.
struct Log {
    clock: Arc<dyn Clock>,
    sent: Mutex<Vec<(u64, Command)>>,
    refuse: AtomicUsize,
}

impl Log {
    fn new(clock: Arc<dyn Clock>) -> Arc<Self> {
        Arc::new(Self { clock, sent: Mutex::new(Vec::new()), refuse: AtomicUsize::new(0) })
    }
    fn commands(&self) -> Vec<Command> {
        self.sent.lock().unwrap().iter().map(|(_, c)| *c).collect()
    }
}

impl SongSink for Log {
    fn send(&self, command: Command) -> bool {
        if self.refuse.load(Ordering::SeqCst) > 0 {
            self.refuse.fetch_sub(1, Ordering::SeqCst);
            return false;
        }
        self.sent.lock().unwrap().push((self.clock.now_us(), command));
        true
    }
}

fn ev(time_ms: f64, note: u8, on: bool) -> SongEvent {
    SongEvent { time_ms, note, velocity: 80, on }
}

fn on(note: u8) -> Command {
    Command::NoteOn { note, velocity: 80, midi_us: 0 }
}

fn off(note: u8) -> Command {
    Command::NoteOff { note }
}

fn wait_for(what: &str, mut cond: impl FnMut() -> bool) {
    let end = Instant::now() + Duration::from_secs(3);
    while !cond() {
        assert!(Instant::now() < end, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(1));
    }
}

fn real_player() -> (SongPlayer, Arc<Log>) {
    let clock: Arc<dyn Clock> = Arc::new(RealClock::new());
    let log = Log::new(Arc::clone(&clock));
    (SongPlayer::new(clock, log.clone()), log)
}

// ---- the schedule, on a fake clock ----

#[test]
fn events_come_out_in_order_and_on_time() {
    let start = 1_000_000;
    let clock = FakeClock::new(start, 300);
    let log = Log::new(clock.clone());
    let events = vec![ev(0.0, 60, true), ev(250.0, 64, true), ev(500.0, 60, false), ev(500.0, 64, false), ev(750.5, 67, true)];
    run_song(&*clock, &*log, events, 0.0, start, &AtomicBool::new(false));
    // 67 is still held at the end, so it is released last.
    assert_eq!(log.commands(), vec![on(60), on(64), off(60), off(64), on(67), off(67)]);
    let due = [0u64, 250_000, 500_000, 500_000, 750_500];
    let sent = log.sent.lock().unwrap();
    for (i, d) in due.iter().enumerate() {
        let late = sent[i].0 - (start + d);
        assert!(late <= 20, "event {i} was {late} us late");
    }
}

#[test]
fn it_sleeps_until_three_ms_before_an_event_and_then_spins() {
    let start = 5_000;
    let clock = FakeClock::new(start, 0);
    let log = Log::new(clock.clone());
    run_song(&*clock, &*log, vec![ev(100.0, 60, true), ev(100.0, 60, false)], 0.0, start, &AtomicBool::new(false));
    assert_eq!(*clock.sleeps.lock().unwrap(), vec![97_000], "one sleep that ends 3 ms early");
    let spins = clock.spins.load(Ordering::SeqCst);
    assert!((1..=310).contains(&spins), "spun {spins} times for the last 3 ms");
}

#[test]
fn an_oversleeping_os_never_makes_an_event_early() {
    let start = 0;
    let clock = FakeClock::new(start, 1_500);
    let log = Log::new(clock.clone());
    run_song(&*clock, &*log, vec![ev(10.0, 60, true), ev(20.0, 60, false)], 0.0, start, &AtomicBool::new(false));
    let sent = log.sent.lock().unwrap();
    assert!(sent[0].0 >= 10_000 && sent[1].0 >= 20_000, "{sent:?}");
}

#[test]
fn starting_in_the_middle_skips_earlier_events_and_shifts_time() {
    let start = 2_000_000;
    let clock = FakeClock::new(start, 0);
    let log = Log::new(clock.clone());
    let events = vec![ev(0.0, 50, true), ev(100.0, 50, false), ev(300.0, 60, true), ev(400.0, 60, false)];
    run_song(&*clock, &*log, events, 300.0, start, &AtomicBool::new(false));
    assert_eq!(log.commands(), vec![on(60), off(60)], "nothing sent for the notes before 300 ms");
    let sent = log.sent.lock().unwrap();
    assert!(sent[0].0 - start <= 20, "the event at the start point is immediate");
    assert!((100_000..100_020).contains(&(sent[1].0 - start)));
}

#[test]
fn a_refused_send_is_tried_again_and_nothing_is_lost_or_reordered() {
    let clock = FakeClock::new(0, 0);
    let log = Log::new(clock.clone());
    log.refuse.store(3, Ordering::SeqCst);
    let events = vec![ev(0.0, 60, true), ev(1.0, 62, true), ev(2.0, 60, false), ev(2.0, 62, false)];
    run_song(&*clock, &*log, events, 0.0, 0, &AtomicBool::new(false));
    assert_eq!(log.commands(), vec![on(60), on(62), off(60), off(62)]);
}

#[test]
fn notes_still_held_when_the_song_ends_are_released() {
    let clock = FakeClock::new(0, 0);
    let log = Log::new(clock.clone());
    run_song(&*clock, &*log, vec![ev(0.0, 60, true), ev(5.0, 64, true), ev(6.0, 64, false)], 0.0, 0, &AtomicBool::new(false));
    assert_eq!(log.commands(), vec![on(60), on(64), off(64), off(60)]);
}

#[test]
fn a_stop_requested_before_the_first_event_sends_nothing() {
    let clock = FakeClock::new(0, 0);
    let log = Log::new(clock.clone());
    run_song(&*clock, &*log, vec![ev(10.0, 60, true)], 0.0, 0, &AtomicBool::new(true));
    assert!(log.commands().is_empty());
}

#[test]
fn song_notes_carry_no_midi_timestamp() {
    let clock = FakeClock::new(0, 0);
    let log = Log::new(clock.clone());
    run_song(&*clock, &*log, vec![ev(0.0, 60, true), ev(1.0, 60, false)], 0.0, 0, &AtomicBool::new(false));
    for c in log.commands() {
        if let Command::NoteOn { midi_us, .. } = c {
            assert_eq!(midi_us, 0, "0 means not stamped");
        }
    }
}

// ---- the player, on its own thread ----

#[test]
fn the_player_plays_a_short_song_then_reports_no_position() {
    let (player, log) = real_player();
    player.play(vec![ev(0.0, 60, true), ev(30.0, 60, false)], 0.0).unwrap();
    wait_for("the song to finish", || player.position_ms().is_none());
    assert_eq!(log.commands(), vec![on(60), off(60)]);
}

#[test]
fn real_events_are_never_early_and_not_far_late() {
    let (player, log) = real_player();
    let t0 = RealClock::new().now_us();
    player.play(vec![ev(20.0, 60, true), ev(40.0, 60, false)], 0.0).unwrap();
    wait_for("the song to finish", || player.position_ms().is_none());
    let sent = log.sent.lock().unwrap();
    let first = sent[0].0 - t0;
    let second = sent[1].0 - t0;
    assert!((20_000..70_000).contains(&first), "{first}");
    assert!((40_000..90_000).contains(&second), "{second}");
}

#[test]
fn position_counts_from_the_start_point_and_none_after_stop() {
    let (player, _log) = real_player();
    assert_eq!(player.position_ms(), None, "nothing played yet");
    player.play(vec![ev(5_000.0, 60, true), ev(60_000.0, 60, false)], 5_000.0).unwrap();
    wait_for("a position", || player.position_ms().is_some_and(|p| p > 5_010.0));
    let p = player.position_ms().unwrap();
    assert!((5_010.0..6_500.0).contains(&p), "{p}");
    player.stop();
    assert_eq!(player.position_ms(), None);
}

#[test]
fn stop_releases_every_held_note() {
    let (player, log) = real_player();
    player.play(vec![ev(0.0, 60, true), ev(0.0, 64, true), ev(60_000.0, 60, false), ev(60_000.0, 64, false)], 0.0).unwrap();
    wait_for("both notes", || log.commands().len() == 2);
    player.stop();
    let cmds = log.commands();
    assert_eq!(cmds.len(), 4, "{cmds:?}");
    assert!(cmds.contains(&off(60)) && cmds.contains(&off(64)));
    assert!(!cmds.contains(&Command::AllNotesOff), "only the song's own notes, never the player's keys");
}

#[test]
fn stop_with_nothing_playing_is_fine_and_repeatable() {
    let (player, log) = real_player();
    player.stop();
    player.stop();
    assert!(log.commands().is_empty());
}

#[test]
fn playing_a_second_song_releases_the_first_ones_notes_before_the_new_ones_start() {
    let (player, log) = real_player();
    player.play(vec![ev(0.0, 60, true), ev(60_000.0, 60, false)], 0.0).unwrap();
    wait_for("the first note", || log.commands().len() == 1);
    player.play(vec![ev(0.0, 72, true), ev(60_000.0, 72, false)], 0.0).unwrap();
    wait_for("the new note", || log.commands().contains(&on(72)));
    assert_eq!(log.commands(), vec![on(60), off(60), on(72)]);
    player.stop();
    assert_eq!(log.commands(), vec![on(60), off(60), on(72), off(72)]);
}

#[test]
fn events_given_out_of_order_play_in_time_order_with_offs_first_on_ties() {
    let (player, log) = real_player();
    player.play(vec![ev(20.0, 60, true), ev(10.0, 60, true), ev(20.0, 60, false), ev(30.0, 60, false)], 0.0).unwrap();
    wait_for("the song to finish", || player.position_ms().is_none());
    assert_eq!(log.commands(), vec![on(60), off(60), on(60), off(60)]);
}

#[test]
fn dropping_the_player_releases_the_notes_and_ends_the_thread() {
    let (player, log) = real_player();
    player.play(vec![ev(0.0, 60, true), ev(60_000.0, 60, false)], 0.0).unwrap();
    wait_for("the note", || log.commands().len() == 1);
    drop(player);
    assert_eq!(log.commands(), vec![on(60), off(60)]);
}

// ---- input checks ----

#[test]
fn bad_events_are_refused_and_nothing_plays() {
    let (player, log) = real_player();
    let bad = |e: SongEvent| player.play(vec![e], 0.0).unwrap_err();
    assert!(bad(ev(0.0, 20, true)).contains("note"));
    assert!(bad(ev(0.0, 109, true)).contains("note"));
    assert!(bad(SongEvent { velocity: 0, ..ev(0.0, 60, true) }).contains("velocity"));
    assert!(bad(SongEvent { velocity: 128, ..ev(0.0, 60, true) }).contains("velocity"));
    assert!(bad(ev(f64::NAN, 60, true)).contains("time"));
    assert!(bad(ev(f64::INFINITY, 60, true)).contains("time"));
    assert!(bad(ev(-1.0, 60, true)).contains("time"));
    assert!(player.play(vec![ev(0.0, 60, true)], -5.0).unwrap_err().contains("time"));
    assert!(player.play(vec![ev(0.0, 60, true)], f64::NAN).unwrap_err().contains("time"));
    assert!(log.commands().is_empty());
}

#[test]
fn a_note_off_may_have_velocity_zero() {
    let (player, _log) = real_player();
    assert!(player.play(vec![SongEvent { velocity: 0, ..ev(0.0, 60, false) }], 0.0).is_ok());
}

#[test]
fn more_than_the_event_limit_is_refused() {
    assert_eq!(MAX_EVENTS, 200_000);
    let (player, _log) = real_player();
    let many = vec![ev(0.0, 60, false); MAX_EVENTS + 1];
    assert!(player.play(many, 0.0).unwrap_err().contains("200000"));
}

#[test]
fn a_refused_song_leaves_the_current_one_playing() {
    let (player, log) = real_player();
    player.play(vec![ev(0.0, 60, true), ev(60_000.0, 60, false)], 0.0).unwrap();
    wait_for("the note", || log.commands().len() == 1);
    assert!(player.play(vec![ev(0.0, 5, true)], 0.0).is_err());
    assert!(player.position_ms().is_some());
    assert_eq!(log.commands(), vec![on(60)]);
}

#[test]
fn raw_numbers_from_javascript_are_checked_before_they_become_bytes() {
    assert_eq!(SongEvent::from_raw(12.5, 60, 90, true), Ok(ev_v(12.5, 60, 90, true)));
    assert!(SongEvent::from_raw(0.0, 316, 90, true).unwrap_err().contains("note"), "316 must not wrap to 60");
    assert!(SongEvent::from_raw(0.0, 60, 346, true).unwrap_err().contains("velocity"), "346 must not wrap to 90");
}

fn ev_v(time_ms: f64, note: u8, velocity: u8, on: bool) -> SongEvent {
    SongEvent { time_ms, note, velocity, on }
}

// ---- overflow, held counts, panics ----

#[test]
fn a_time_far_in_the_future_saturates_instead_of_overflowing() {
    assert_eq!(due_us(u64::MAX - 5, 1_000.0, 0.0), u64::MAX);
    assert_eq!(due_us(10, 2.0, 1.0), 1_010);
}

#[test]
fn times_above_one_day_are_refused_and_one_day_is_fine() {
    assert_eq!(MAX_TIME_MS, 86_400_000.0);
    let (player, _log) = real_player();
    assert!(player.play(vec![ev(MAX_TIME_MS + 1.0, 60, false)], 0.0).unwrap_err().contains("time"));
    assert!(player.play(vec![ev(0.0, 60, false)], MAX_TIME_MS + 1.0).unwrap_err().contains("time"));
    assert!(player.play(vec![ev(MAX_TIME_MS, 60, false)], MAX_TIME_MS).is_ok());
}

#[test]
fn the_same_note_started_twice_is_released_only_when_both_are_over() {
    let clock = FakeClock::new(0, 0);
    let log = Log::new(clock.clone());
    let events = vec![ev(0.0, 60, true), ev(1.0, 60, true), ev(2.0, 60, false), ev(3.0, 60, false)];
    run_song(&*clock, &*log, events, 0.0, 0, &AtomicBool::new(false));
    assert_eq!(log.commands(), vec![on(60), on(60), off(60)], "one note off, after the second off event");
    let t: Vec<u64> = log.sent.lock().unwrap().iter().map(|(t, _)| *t).collect();
    assert!(t[2] >= 3_000, "the first off event sent nothing");
}

#[test]
fn a_note_started_twice_and_cut_short_is_released_once() {
    let clock = FakeClock::new(0, 0);
    let log = Log::new(clock.clone());
    run_song(&*clock, &*log, vec![ev(0.0, 60, true), ev(1.0, 60, true)], 0.0, 0, &AtomicBool::new(false));
    assert_eq!(log.commands(), vec![on(60), on(60), off(60)]);
}

struct Panicky;

impl SongSink for Panicky {
    fn send(&self, _command: Command) -> bool {
        panic!("sink broke (expected in this test)");
    }
}

#[test]
fn a_song_thread_that_panics_still_ends_the_song() {
    let player = SongPlayer::new(Arc::new(RealClock::new()), Arc::new(Panicky));
    player.play(vec![ev(0.0, 60, true)], 0.0).unwrap();
    wait_for("the position to end", || player.position_ms().is_none());
    player.stop();
}

/// Like the Windows stop event: once woken, sleeps return at once until the wake is cleared.
struct WakeClock {
    now: AtomicU64,
    woken: AtomicBool,
}

impl Clock for WakeClock {
    fn now_us(&self) -> u64 {
        self.now.load(Ordering::SeqCst)
    }
    fn sleep_us(&self, us: u64) {
        if !self.woken.load(Ordering::SeqCst) {
            self.now.fetch_add(us, Ordering::SeqCst);
        }
    }
    fn spin(&self) {
        self.now.fetch_add(10, Ordering::SeqCst);
    }
    fn wake(&self) {
        self.woken.store(true, Ordering::SeqCst);
    }
    fn clear_wake(&self) {
        self.woken.store(false, Ordering::SeqCst);
    }
}

/// Sends a stop (cancel plus wake) right after the first note on, then refuses `refuse` sends.
struct StopThenRefuse {
    clock: Arc<WakeClock>,
    cancel: Arc<AtomicBool>,
    refuse: AtomicUsize,
    sent: Mutex<Vec<Command>>,
}

impl SongSink for StopThenRefuse {
    fn send(&self, command: Command) -> bool {
        if self.cancel.load(Ordering::SeqCst) && self.refuse.load(Ordering::SeqCst) > 0 {
            self.refuse.fetch_sub(1, Ordering::SeqCst);
            return false;
        }
        self.sent.lock().unwrap().push(command);
        if matches!(command, Command::NoteOn { .. }) {
            self.cancel.store(true, Ordering::SeqCst);
            self.clock.wake();
        }
        true
    }
}

#[test]
fn after_a_stop_the_release_retries_still_wait_even_if_a_wake_signal_stays_set() {
    let clock = Arc::new(WakeClock { now: AtomicU64::new(0), woken: AtomicBool::new(false) });
    let cancel = Arc::new(AtomicBool::new(false));
    let sink = StopThenRefuse {
        clock: clock.clone(),
        cancel: cancel.clone(),
        refuse: AtomicUsize::new(50),
        sent: Mutex::new(Vec::new()),
    };
    run_song(&*clock, &sink, vec![ev(0.0, 60, true), ev(60_000.0, 60, false)], 0.0, 0, &cancel);
    assert_eq!(*sink.sent.lock().unwrap(), vec![on(60), off(60)], "the note off got through after 50 refusals");
    assert!(clock.now_us() >= 50 * 200, "the retries waited about 10 ms, not zero: {}", clock.now_us());
}

/// Panics on its second send, and records the others.
struct PanicOnSecond {
    calls: AtomicUsize,
    sent: Mutex<Vec<Command>>,
}

impl SongSink for PanicOnSecond {
    fn send(&self, command: Command) -> bool {
        if self.calls.fetch_add(1, Ordering::SeqCst) == 1 {
            panic!("sink broke (expected in this test)");
        }
        self.sent.lock().unwrap().push(command);
        true
    }
}

#[test]
fn a_panic_while_playing_still_tries_to_release_the_held_notes() {
    let clock = FakeClock::new(0, 0);
    let sink = PanicOnSecond { calls: AtomicUsize::new(0), sent: Mutex::new(Vec::new()) };
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        run_song(&*clock, &sink, vec![ev(0.0, 60, true), ev(1.0, 62, true)], 0.0, 0, &AtomicBool::new(false));
    }));
    assert!(result.is_err(), "the panic goes on");
    assert_eq!(*sink.sent.lock().unwrap(), vec![on(60), off(60)]);
}
