import type { SoundSettings } from '../shared/settings'
import type { AudioController } from './audioController'

// The two controller calls the launch sequence needs.
export type StartableAudio = Pick<AudioController, 'loadPiano' | 'applySettings' | 'setLaunching'>

// Launch order for sound: load the piano first, then open the output. This way the first output
// already has the piano bank and Bar never hears the simple stand-in tone. A failed load does not
// stop the sound: the simple tone plays and the Sound screen says why. Never rejects.
// The settings are read after the wait, so a change made during the load is kept.
// If the load takes longer than this, the sound opens anyway (the piano joins it when the load ends).
export const PIANO_WAIT_MS = 15_000

export async function startAudio(
  audio: StartableAudio,
  getSettings: () => SoundSettings,
  pianoFolder: string,
  waitMs: number = PIANO_WAIT_MS
): Promise<void> {
  audio.setLaunching(true)
  let timer: ReturnType<typeof setTimeout> | undefined
  const tooLong = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, waitMs)
  })
  try {
    await Promise.race([audio.loadPiano(pianoFolder), tooLong])
  } catch (error) {
    console.error('The piano sound could not load:', error)
  } finally {
    clearTimeout(timer)
  }
  try {
    // Read the settings now: Bar may have changed them on the Sound screen while the piano loaded.
    await audio.applySettings(getSettings())
  } finally {
    audio.setLaunching(false)
  }
}
