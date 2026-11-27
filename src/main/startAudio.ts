import type { SoundSettings } from '../shared/settings'
import type { AudioController } from './audioController'

// The two controller calls the launch sequence needs.
export type StartableAudio = Pick<AudioController, 'loadPiano' | 'applySettings'>

// Launch order for sound: load the piano first, then open the output. This way the first output
// already has the piano bank and Bar never hears the simple stand-in tone. A failed load does not
// stop the sound: the simple tone plays and the Sound screen says why. Never rejects.
export async function startAudio(
  audio: StartableAudio,
  settings: SoundSettings,
  pianoFolder: string
): Promise<void> {
  try {
    await audio.loadPiano(pianoFolder)
  } catch (error) {
    console.error('The piano sound could not load:', error)
  }
  await audio.applySettings(settings)
}
