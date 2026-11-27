// The rules of the Play controls, as plain functions so they can be tested.

/** What the song is doing now. */
export type Activity = 'idle' | 'listen' | 'watch' | 'paused' | 'finished'

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

export interface PlayView {
  status: string
  listenPressed: boolean
  watchPressed: boolean
  pauseDisabled: boolean
  /** True when the status is the engine's reason, so the Sound link is shown. */
  soundLink: boolean
}

export function playView(state: { activity: Activity; reason?: string }): PlayView {
  const { activity, reason } = state
  const playing = activity === 'listen' || activity === 'watch'
  let status = ''
  if (reason !== undefined) status = reason
  else if (activity === 'listen') status = 'Playing with sound.'
  else if (activity === 'watch') status = 'Playing without sound.'
  else if (activity === 'paused') status = 'Paused.'
  else if (activity === 'finished') status = 'Song finished. Press Listen to hear it again.'
  return {
    status,
    listenPressed: activity === 'listen',
    watchPressed: activity === 'watch',
    pauseDisabled: !playing,
    soundLink: reason !== undefined
  }
}
