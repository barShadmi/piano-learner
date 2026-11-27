// Saves and reads the songs in the library: one JSON file per song in the songs folder.
// Only the main process uses this. Every file name is a random UUID made here, so nothing
// from the screen or from the imported file picks a path.
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateSong, type Song } from '../shared/song'
import { isSongId, summaryOf, type SongSummary } from '../shared/songs'

const EXTENSION = '.json'

// Reads one song file. A file that is missing, broken, not a valid song, or whose id does
// not match its file name is skipped (undefined). Nothing else is read.
function readSongFile(dir: string, id: string): Song | undefined {
  try {
    const checked = validateSong(JSON.parse(readFileSync(join(dir, id + EXTENSION), 'utf8')))
    if (!checked.ok || checked.song.id !== id) return undefined
    return checked.song
  } catch {
    return undefined
  }
}

// Every valid song in the folder, sorted by title. A missing folder means no songs.
export function listSongs(dir: string): SongSummary[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const songs: SongSummary[] = []
  for (const name of names) {
    if (!name.endsWith(EXTENSION)) continue
    const id = name.slice(0, -EXTENSION.length)
    if (!isSongId(id)) continue
    const song = readSongFile(dir, id)
    if (song) songs.push(summaryOf(song))
  }
  return songs.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
}

// The full song for an id. An id that is not a UUID is refused before any file is opened.
export function getSong(dir: string, id: string): Song | undefined {
  if (!isSongId(id)) return undefined
  return readSongFile(dir, id)
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
