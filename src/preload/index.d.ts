import type {
  AudioState,
  ListOutputsReply,
  MidiEvent,
  MidiReconnectReply,
  MidiStatusReply,
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
      midi: {
        status(): Promise<MidiStatusReply>
        reconnect(): Promise<MidiReconnectReply>
        /** Returns a function that stops the listening. */
        onEvents(callback: (events: MidiEvent[]) => void): () => void
      }
    }
  }
}
