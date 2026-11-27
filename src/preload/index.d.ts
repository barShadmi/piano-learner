import type {
  AudioState,
  ListOutputsReply,
  MidiEvent,
  MidiReconnectReply,
  MidiStatusReply,
  StartConfig,
  StatusReply,
  TestToneReply,
  ToneArgs,
  VolumeReply
} from '../shared/audio'
import type { LatencyClearReply, LatencyOpenReply, LatencyReply, LatencySaveReply } from '../shared/latency'
import type { SettingsSetReply, SoundSettings } from '../shared/settings'

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
        setVolume(volume: number): Promise<VolumeReply>
      }
      latency: {
        summary(): Promise<LatencyReply>
        clear(): Promise<LatencyClearReply>
        save(): Promise<LatencySaveReply>
        showFile(): Promise<LatencyOpenReply>
      }
      settings: {
        get(): Promise<SoundSettings>
        set(next: SoundSettings): Promise<SettingsSetReply>
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
