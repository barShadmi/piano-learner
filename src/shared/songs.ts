// Shared between the main process and the screens: what the song library says about a song.
import type { Song } from './song'

/** One row of the library. The full song is only sent when a song is opened. */
export interface SongSummary {
  id: string
  title: string
  composer?: string
  noteCount: number
}

/** A song id is a lower-case random UUID, the only kind of name a song file ever has. */
const SONG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function isSongId(value: unknown): value is string {
  return typeof value === 'string' && SONG_ID.test(value)
}

export function summaryOf(song: Song): SongSummary {
  const summary: SongSummary = { id: song.id, title: song.title, noteCount: song.notes.length }
  if (song.composer !== undefined) summary.composer = song.composer
  return summary
}

export type SongGetReply = { ok: true; song: Song } | { ok: false; error: string }

export type SongImportReply =
  | { ok: true; song: SongSummary }
  | { ok: false; error: string }
  | { ok: false; cancelled: true }
