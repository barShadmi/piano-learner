// Import entry point: picks a parser by file extension, then checks the song.
import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { validateSong } from '../../shared/song'
import type { Song } from '../../shared/song'
import { parseMidi } from './midi'
import { parseMusicXml, parseMxl, decodeText } from './musicxml'

export type ImportResult = { ok: true; song: Song } | { ok: false; error: string }

/** Files bigger than this are refused. */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024

const TOO_BIG = 'This file is too big. Pick a file under 20 MB.'

export async function importSongFile(path: string): Promise<ImportResult> {
  const ext = extname(path).toLowerCase()
  if (!['.mid', '.midi', '.musicxml', '.xml', '.mxl'].includes(ext)) {
    return { ok: false, error: 'This kind of file cannot be imported yet. Pick a MIDI or MusicXML file.' }
  }

  let bytes: Uint8Array
  try {
    if ((await stat(path)).size > MAX_IMPORT_BYTES) return { ok: false, error: TOO_BIG }
    bytes = await readFile(path)
  } catch {
    return { ok: false, error: 'This file could not be opened.' }
  }
  if (bytes.length > MAX_IMPORT_BYTES) return { ok: false, error: TOO_BIG }

  const result =
    ext === '.mid' || ext === '.midi'
      ? parseMidi(bytes, path)
      : ext === '.mxl'
        ? parseMxl(bytes, path)
        : parseMusicXml(decodeText(bytes), path)
  if (!result.ok) return result

  const checked = validateSong(result.song)
  if (!checked.ok) return { ok: false, error: 'This file could not be turned into a song. Try another copy of the song.' }
  return { ok: true, song: checked.song }
}
