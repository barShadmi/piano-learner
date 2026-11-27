// Saves and reads the songs in the library: one JSON file per song in the songs folder.
// Only the main process uses this. Every file name is a random UUID made here, so nothing
// from the screen or from the imported file picks a path.
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { validateSong, type Song } from '../shared/song'
import { isSongId, summaryOf, type SongSummary } from '../shared/songs'

const EXTENSION = '.json'

// Checks the text of one song file. A file that is broken, not a valid song, or whose id does
// not match its file name is skipped (undefined). Nothing else is read.
function songFrom(text: string, id: string): Song | undefined {
  try {
    const checked = validateSong(JSON.parse(text))
    if (!checked.ok || checked.song.id !== id) return undefined
    return checked.song
  } catch {
    return undefined
  }
}

// Reads one song file (used by getSong, which stays synchronous).
function readSongFileSync(dir: string, id: string): Song | undefined {
  try {
    return songFrom(readFileSync(join(dir, id + EXTENSION), 'utf8'), id)
  } catch {
    return undefined
  }
}

// Reads one song file without blocking the main process (used by listSongs).
async function readSongFile(dir: string, id: string): Promise<Song | undefined> {
  try {
    return songFrom(await readFile(join(dir, id + EXTENSION), 'utf8'), id)
  } catch {
    return undefined
  }
}

// Every valid song in the folder, sorted by title. A missing folder means no songs.
// The files are read in parallel and do not block the main process.
export async function listSongs(dir: string): Promise<SongSummary[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const ids = names
    .filter((name) => name.endsWith(EXTENSION))
    .map((name) => name.slice(0, -EXTENSION.length))
    .filter((id) => isSongId(id))
  const songs = await Promise.all(ids.map((id) => readSongFile(dir, id)))
  return songs
    .filter((song): song is Song => song !== undefined)
    .map((song) => summaryOf(song))
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
}

// The full song for an id. An id that is not a UUID is refused before any file is opened.
export function getSong(dir: string, id: string): Song | undefined {
  if (!isSongId(id)) return undefined
  return readSongFileSync(dir, id)
}

// Saves a new song under a new random id. The id the song came with is ignored.
// It is checked first, so a bad song writes nothing. The file is written to a temporary name
// and then renamed, so a crash never leaves a half-written song. Throws when it cannot be saved.
export function saveSong(dir: string, song: Song): SongSummary {
  const id = randomUUID()
  const checked = validateSong({ ...song, id })
  if (!checked.ok) throw new Error(`The song is not valid: ${checked.errors.join('; ')}`)

  mkdirSync(dir, { recursive: true })
  const target = join(dir, id + EXTENSION)
  const temp = join(dir, id + EXTENSION + '.tmp')
  try {
    writeFileSync(temp, JSON.stringify(checked.song, null, 2), 'utf8')
    renameSync(temp, target)
  } catch (error) {
    // Cleaning up is best effort: the original error is the one that matters.
    try {
      rmSync(temp, { force: true })
    } catch {
      // Nothing more to do; the caller gets the error below.
    }
    throw error
  }
  return summaryOf(checked.song)
}
