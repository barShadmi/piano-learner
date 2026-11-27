//! Stand-in piano voice: a soft decaying triangle tone. Never allocates.

/// Attack in milliseconds (linear).
const ATTACK_MS: u32 = 2;
/// Release after key up, milliseconds (linear, full scale).
const RELEASE_MS: u32 = 80;
/// Fade for a voice that is being stolen.
const STEAL_MS: u32 = 2;
/// Fade for a voice whose own note is pressed again.
const RETRIGGER_MS: u32 = 5;
/// Time for a held note to fall 60 dB (to the silence threshold).
const DECAY_SECONDS: f64 = 4.0;
/// Below this envelope level the voice snaps to silence. This also keeps the
/// exponential decay away from denormal numbers.
const SILENT: f32 = 0.001;
/// A note always sounds at least this long (attack included) before its
/// release starts, so a very quick tap is still heard.
const MIN_HOLD_MS: u32 = 30;
/// Loudness at velocity 127 (the velocity curve is applied on top).
const LEVEL: f32 = 0.2;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Stage {
    Idle,
    Attack,
    Held,
    Release,
}

#[derive(Clone, Copy)]
struct Pending {
    note: u8,
    gain: f32,
}

/// One note voice.
#[derive(Clone, Copy)]
pub struct NoteVoice {
    sample_rate: f64,
    attack_step: f32,
    release_step: f32,
    steal_step: f32,
    retrigger_step: f32,
    hold_frames: u32,
    decay_mul: f32,
    /// Step of the fade that runs now.
    fade_step: f32,
    stage: Stage,
    env: f32,
    gain: f32,
    phase: f64,
    phase_inc: f64,
    note: u8,
    /// A note waiting for this voice's fast fade-out to end.
    pending: Option<Pending>,
    /// The key (of the current or pending note) is held down.
    key_down: bool,
    /// The key is up but the pedal holds the note.
    sustained: bool,
    /// Samples left of the minimum hold.
    hold_left: u32,
    /// A release that came too early and waits for the minimum hold to end.
    deferred: bool,
    /// Start order: smaller is older.
    serial: u64,
}

impl NoteVoice {
    pub fn new(sample_rate: u32) -> Self {
        let sr = sample_rate.max(1);
        let frames = |ms: u32| ((u64::from(sr) * u64::from(ms)) / 1000).max(1) as f32;
        Self {
            sample_rate: f64::from(sr),
            attack_step: 1.0 / frames(ATTACK_MS),
            release_step: 1.0 / frames(RELEASE_MS),
            steal_step: 1.0 / frames(STEAL_MS),
            retrigger_step: 1.0 / frames(RETRIGGER_MS),
            hold_frames: frames(MIN_HOLD_MS) as u32,
            decay_mul: (f64::from(SILENT).powf(1.0 / (DECAY_SECONDS * f64::from(sr)))) as f32,
            fade_step: 1.0 / frames(RELEASE_MS),
            stage: Stage::Idle,
            env: 0.0,
            gain: 0.0,
            phase: 0.0,
            phase_inc: 0.0,
            note: 0,
            pending: None,
            key_down: false,
            sustained: false,
            hold_left: 0,
            deferred: false,
            serial: 0,
        }
    }

    /// Frequency of a MIDI note, A4 (69) = 440 Hz, equal temperament.
    pub fn frequency(note: u8) -> f32 {
        440.0 * 2.0f32.powf((f32::from(note) - 69.0) / 12.0)
    }

    fn begin(&mut self, note: u8, gain: f32) {
        self.note = note;
        self.gain = gain;
        self.phase_inc = f64::from(Self::frequency(note)) / self.sample_rate;
        self.phase = 0.0;
        self.env = 0.0;
        self.stage = Stage::Attack;
        self.pending = None;
        self.hold_left = self.hold_frames;
    }

    /// Start a note on an idle voice.
    pub fn start(&mut self, note: u8, gain: f32, serial: u64) {
        self.begin(note, gain);
        self.deferred = false;
        self.key_down = true;
        self.sustained = false;
        self.serial = serial;
    }

    /// Start a note on a voice that may still sound: the old sound fades out
    /// in about 2 ms, then the new note starts (no click).
    pub fn steal(&mut self, note: u8, gain: f32, serial: u64) {
        if self.stage == Stage::Idle {
            self.start(note, gain, serial);
            return;
        }
        self.pending = Some(Pending { note, gain });
        self.deferred = false;
        self.fade_step = self.steal_step;
        self.stage = Stage::Release;
        self.key_down = true;
        self.sustained = false;
        self.serial = serial;
    }

    /// The note this voice answers to: the waiting note while a steal fade runs.
    pub fn note(&self) -> u8 {
        self.pending.map_or(self.note, |p| p.note)
    }

    /// The voice answers to note events: key down or held by the pedal.
    pub fn is_live(&self) -> bool {
        self.stage != Stage::Idle && (self.key_down || self.sustained)
    }

    pub fn is_key_down(&self) -> bool {
        self.key_down
    }

    pub fn serial(&self) -> u64 {
        self.serial
    }

    pub fn is_active(&self) -> bool {
        self.stage != Stage::Idle
    }

    /// The key came up. With the pedal down the note keeps sounding.
    pub fn key_up(&mut self, pedal_down: bool) {
        self.key_down = false;
        if pedal_down {
            self.sustained = true;
        } else {
            self.release();
        }
    }

    /// Pedal lifted: let go of a note the pedal was holding.
    pub fn pedal_up(&mut self) {
        if self.sustained {
            self.release();
        }
    }

    /// Begin the 80 ms fade-out. If the note is still in its minimum hold (or
    /// waiting on a steal fade) the release is kept back until the hold ends,
    /// so a quick tap is always heard.
    pub fn release(&mut self) {
        self.key_down = false;
        self.sustained = false;
        if self.stage == Stage::Idle {
            return;
        }
        let holding = matches!(self.stage, Stage::Attack | Stage::Held) && self.hold_left > 0;
        if holding || self.pending.is_some() {
            self.deferred = true;
            return;
        }
        self.start_release();
    }

    /// Release now, whatever the minimum hold says (stop-all, all-notes-off).
    pub fn stop(&mut self) {
        self.key_down = false;
        self.sustained = false;
        self.deferred = false;
        if self.stage == Stage::Idle {
            return;
        }
        if self.pending.take().is_some() {
            return; // the fast steal fade carries on and ends in silence
        }
        self.start_release();
    }

    fn start_release(&mut self) {
        self.deferred = false;
        self.fade_step = self.release_step;
        self.stage = Stage::Release;
    }

    /// The same note was pressed again: fade this voice in about 5 ms and stop
    /// answering to note events.
    pub fn retrigger_fade(&mut self) {
        self.key_down = false;
        self.sustained = false;
        if self.stage == Stage::Idle {
            return;
        }
        self.pending = None;
        self.deferred = false;
        self.fade_step = self.retrigger_step;
        self.stage = Stage::Release;
    }

    fn triangle(phase: f64) -> f32 {
        let p = phase as f32;
        if p < 0.25 {
            4.0 * p
        } else if p < 0.75 {
            2.0 - 4.0 * p
        } else {
            4.0 * p - 4.0
        }
    }

    /// Next mono sample. The first sample of a new note is exactly 0.
    pub fn next_sample(&mut self) -> f32 {
        if self.stage == Stage::Idle {
            return 0.0;
        }
        let out = Self::triangle(self.phase) * self.env * self.gain;
        self.phase += self.phase_inc;
        self.phase -= self.phase.floor();
        match self.stage {
            Stage::Attack => {
                self.env += self.attack_step;
                if self.env >= 1.0 {
                    self.env = 1.0;
                    self.stage = Stage::Held;
                }
            }
            Stage::Held => {
                self.env *= self.decay_mul;
                if self.env < SILENT {
                    self.silence();
                }
            }
            Stage::Release => {
                self.env -= self.fade_step;
                if self.env <= 0.0 {
                    match self.pending.take() {
                        Some(p) => self.begin(p.note, p.gain), // key flags stay as set
                        None => self.silence(),
                    }
                }
            }
            Stage::Idle => {}
        }
        if matches!(self.stage, Stage::Attack | Stage::Held) {
            self.hold_left = self.hold_left.saturating_sub(1);
            if self.deferred && self.hold_left == 0 {
                self.start_release();
            }
        }
        out
    }

    fn silence(&mut self) {
        self.env = 0.0;
        self.stage = Stage::Idle;
        self.deferred = false;
        self.key_down = false;
        self.sustained = false;
    }
}

/// Peak gain of a note at a velocity (before the envelope).
pub fn note_gain(velocity: u8) -> f32 {
    crate::core::velocity::gain(velocity) * LEVEL
}
