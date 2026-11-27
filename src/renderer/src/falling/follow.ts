// Keeps the song clock close to the engine's song position while Listen mode plays.
// Pure TypeScript. No sound happens here.

/** The most the clock may be away from the engine before it is moved, in seconds. */
export const DRIFT_THRESHOLD_S = 0.02

/**
 * The clock position (in seconds) to move to, or undefined to leave the clock alone.
 * `engineMs` is where the engine says the song is, in milliseconds, or null when it plays nothing.
 */
export function correction(
  clockS: number,
  engineMs: number | null,
  thresholdS: number = DRIFT_THRESHOLD_S
): number | undefined {
  if (engineMs === null) return undefined
  const engineS = engineMs / 1000
  return Math.abs(clockS - engineS) > thresholdS ? engineS : undefined
}
