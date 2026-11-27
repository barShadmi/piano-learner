//! Windows timing for the song thread. `park_timeout` only wakes on the
//! system tick (about 15.6 ms), far too coarse for notes. So the thread sleeps
//! on a high-resolution waitable timer, together with a stop event, so a stop
//! request wakes it at once. Where that timer does not exist (before Windows 10
//! 1803) the thread asks for a 1 ms system tick for as long as the song plays
//! and sleeps with `park_timeout` as everywhere else.

use std::ffi::c_void;
use std::sync::{Mutex, PoisonError};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_FAILED};
use windows::Win32::Media::{timeBeginPeriod, timeEndPeriod};
use windows::Win32::System::Threading::{
    CreateEventW, CreateWaitableTimerExW, GetCurrentThread, ResetEvent, SetEvent, SetThreadPriority,
    SetWaitableTimer, WaitForMultipleObjects, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, INFINITE,
    THREAD_PRIORITY_ABOVE_NORMAL, TIMER_ALL_ACCESS,
};

/// A raw handle kept as a number so the struct is `Send` and `Sync`. 0 = none.
fn handle(raw: usize) -> HANDLE {
    HANDLE(raw as *mut c_void)
}

struct Timer {
    /// The high-resolution timer of the song thread (0 = none).
    raw: usize,
    /// Whether `timeBeginPeriod(1)` is in force for this song.
    fine_period: bool,
}

pub struct Sleeper {
    /// Manual-reset event that `wake` sets (0 = could not be made).
    wake: usize,
    timer: Mutex<Timer>,
}

impl Sleeper {
    pub fn new() -> Self {
        // SAFETY: plain Win32 calls with no pointers beyond a null name.
        let wake = unsafe { CreateEventW(None, true, false, PCWSTR::null()) }.map_or(0, |h| h.0 as usize);
        Self { wake, timer: Mutex::new(Timer { raw: 0, fine_period: false }) }
    }

    /// On the song thread: a little more priority, and the finest timer there is.
    pub fn thread_begin(&self) {
        // SAFETY: the pseudo handle of the current thread is always valid.
        let _ = unsafe { SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_ABOVE_NORMAL) };
        let mut t = self.timer.lock().unwrap_or_else(PoisonError::into_inner);
        // SAFETY: no pointers beyond a null name.
        let made = unsafe {
            CreateWaitableTimerExW(None, PCWSTR::null(), CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS.0)
        };
        match made {
            Ok(h) => t.raw = h.0 as usize,
            Err(_) => {
                // SAFETY: undone in `thread_end`.
                unsafe { timeBeginPeriod(1) };
                t.fine_period = true;
            }
        }
    }

    pub fn thread_end(&self) {
        let mut t = self.timer.lock().unwrap_or_else(PoisonError::into_inner);
        if t.raw != 0 {
            // SAFETY: the handle was made in `thread_begin` and is closed once.
            let _ = unsafe { CloseHandle(handle(t.raw)) };
            t.raw = 0;
        }
        if t.fine_period {
            // SAFETY: pairs with the `timeBeginPeriod(1)` above.
            unsafe { timeEndPeriod(1) };
            t.fine_period = false;
        }
    }

    /// Sleep `us` on the timer, ending early when `wake` is called. False when
    /// there is no timer, and the caller sleeps another way.
    pub fn sleep(&self, us: u64) -> bool {
        let t = self.timer.lock().unwrap_or_else(PoisonError::into_inner);
        if t.raw == 0 || self.wake == 0 {
            return false;
        }
        // Negative = relative, in units of 100 ns.
        let due = -i64::try_from(us.saturating_mul(10)).unwrap_or(i64::MAX);
        // SAFETY: `due` outlives the call, and both handles are open.
        unsafe {
            if SetWaitableTimer(handle(t.raw), &due, 0, None, None, false).is_err() {
                return false;
            }
            if WaitForMultipleObjects(&[handle(self.wake), handle(t.raw)], false, INFINITE) == WAIT_FAILED {
                return false; // the caller sleeps with park_timeout instead of spinning
            }
        }
        true
    }

    pub fn wake(&self) {
        if self.wake != 0 {
            // SAFETY: the event lives as long as `self`.
            let _ = unsafe { SetEvent(handle(self.wake)) };
        }
    }

    pub fn clear_wake(&self) {
        if self.wake != 0 {
            // SAFETY: as above.
            let _ = unsafe { ResetEvent(handle(self.wake)) };
        }
    }
}

impl Drop for Sleeper {
    fn drop(&mut self) {
        if self.wake != 0 {
            // SAFETY: made in `new`, closed once.
            let _ = unsafe { CloseHandle(handle(self.wake)) };
        }
    }
}
