import type {
  AudioState,
  ListOutputsReply,
  StartConfig,
  StatusReply,
  TestToneReply,
  ToneArgs
} from '../shared/audio'

export {}

declare global {
  interface Window {
    pianoLearner: {
      version: string
      forcedTheme?: 'light' | 'dark'
      audio: {
        state(): Promise<AudioState>
        listOutputs(): Promise<ListOutputsReply>
        start(config?: StartConfig): Promise<AudioState>
        testTone(args?: ToneArgs): Promise<TestToneReply>
        status(): Promise<StatusReply>
      }
    }
  }
}
