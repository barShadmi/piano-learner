import type {
  AudioState,
  ListOutputsReply,
  MidiEvent,
  MidiReconnectReply,
  MidiStatusReply,
  SongEvent,
  SongPositionReply,
  SongReply,
  StartConfig,
  StatusReply,
  TestToneReply,
  ToneArgs,
  VolumeReply
} from '../shared/audio'
import type { LatencyClearReply, LatencyOpenReply, LatencyReply, LatencySaveReply } from '../shared/latency'
import type { SettingsSetReply, SoundSettings } from '../shared/settings'
import type { SongGetReply, SongImportReply, SongSummary } from '../shared/songs'

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
      song: {
        /** The engine plays the song (replacing one that is playing), starting `fromMs` into it. */
        play(events: SongEvent[], fromMs: number): Promise<SongReply>
        stop(): Promise<SongReply>
        /** Where the song is in ms, or null when none plays. */
        position(): Promise<SongPositionReply>
      }
      songs: {
        list(): Promise<SongSummary[]>
        get(id: string): Promise<SongGetReply>
        import(): Promise<SongImportReply>
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
