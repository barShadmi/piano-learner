// The rules of the Play controls, as plain functions so they can be tested.

/** What the song is doing now. */
export type Activity = 'idle' | 'starting' | 'listen' | 'watch' | 'paused' | 'finished'

export type EngineStart = { kind: 'wait'; waitMs: number } | { kind: 'now'; fromMs: number }

// Where the engine song starts, given the clock position in seconds.
// Before 0 (the lead-in) the engine waits for the rest of the lead-in.
export function engineStart(clockS: number): EngineStart {
  if (clockS < 0) return { kind: 'wait', waitMs: -clockS * 1000 }
  return { kind: 'now', fromMs: clockS * 1000 }
}

// When the lead-in timer fires, the clock is a few ms past 0 (timers are late).
// Sending that would skip the notes at 0 ms, so the clock goes back to exactly 0 and the engine starts at 0.
export function leadInEnd(): { seekS: number; fromMs: number } {
  return { seekS: 0, fromMs: 0 }
}

/** What the main process says when the engine is not on. Also shown at once when Listen finds the sound off. */
export const SOUND_OFF = 'Sound is off. Press Open Sound to turn it on.'

/** Whether the engine is running and can play the song. Only phase 'on' counts. */
export function soundIsRunning(state: { phase: 'starting' | 'on' | 'off' | 'failed' }): boolean {
  return state.phase === 'on'
}

export type Mode = 'listen' | 'watch'

export interface PlayView {
  status: string
  listenPressed: boolean
  watchPressed: boolean
  pauseDisabled: boolean
  /** The classes of the two mode buttons: the mode that runs (or is paused) is the primary one. */
  listenClass: string
  watchClass: string
  /** True when the status is the engine's reason, so the Sound link is shown. */
  soundLink: boolean
}

// `mode` is the mode that ran last; it only matters while paused.
export function playView(state: { activity: Activity; reason?: string; mode?: Mode }): PlayView {
  const { activity, reason, mode } = state
  const playing = activity === 'listen' || activity === 'watch'
  let status = ''
  if (reason !== undefined) status = reason
  else if (activity === 'starting') status = 'Starting the sound…'
  else if (activity === 'listen') status = 'Playing with sound.'
  else if (activity === 'watch') status = 'Playing without sound.'
  else if (activity === 'paused') status = 'Paused.'
  else if (activity === 'finished') status = 'Song finished. Press Listen to hear it again.'
  const listenPressed = activity === 'listen' || activity === 'starting' || (activity === 'paused' && mode === 'listen')
  const watchPressed = activity === 'watch' || (activity === 'paused' && mode === 'watch')
  const anyPressed = listenPressed || watchPressed
  return {
    status,
    listenPressed,
    watchPressed,
    listenClass: listenPressed || !anyPressed ? 'button' : 'button button-secondary',
    watchClass: watchPressed ? 'button' : 'button button-secondary',
    pauseDisabled: !playing,
    soundLink: reason !== undefined
  }
}
