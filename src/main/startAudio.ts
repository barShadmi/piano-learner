import type { SoundSettings } from '../shared/settings'
import type { AudioController } from './audioController'

// The two controller calls the launch sequence needs.
export type StartableAudio = Pick<AudioController, 'loadPiano' | 'applySettings'>

// Launch order for sound: load the piano first, then open the output. This way the first output
// already has the piano bank and Bar never hears the simple stand-in tone. A failed load does not
// stop the sound: the simple tone plays and the Sound screen says why. Never rejects.
// If the load takes longer than this, the sound opens anyway (the piano joins it when the load ends).
export const PIANO_WAIT_MS = 15_000

export async function startAudio(
  audio: StartableAudio,
  settings: SoundSettings,
  pianoFolder: string,
  waitMs: number = PIANO_WAIT_MS
): Promise<void> {
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
  await audio.applySettings(settings)
}
