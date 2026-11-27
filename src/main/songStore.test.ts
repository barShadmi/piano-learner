import { mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateSong, type Song } from '../shared/song'
import { getSong, listSongs, saveSong } from './songStore'

let root: string
let dir: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'songs-'))
  dir = join(root, 'songs')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

// A small song that passes validateSong. The id is the importer's id, which the store must ignore.
function makeSong(title: string, noteCount = 2, id = 'importer-id'): Song {
  const notes = Array.from({ length: noteCount }, (_, i) => ({
    id: `n${i}`,
    pitch: 60 + i,
    start: i,
    duration: 1,
    hand: 'right' as const
  }))
  return {
    formatVersion: 1,
    id,
    title,
    composer: 'A Composer',
    keyFifths: 0,
    measures: [{ index: 0, start: 0, timeSignature: { beats: 4, beatUnit: 4 } }],
    tempos: [{ start: 0, bpm: 100 }],
    notes,
    source: { kind: 'midi', fileName: 'tune.mid' }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('listSongs', () => {
  it('gives an empty list when no song has been saved yet', () => {
    expect(listSongs(dir)).toEqual([])
  })

  it('lists a saved song with its title, composer and note count', () => {
    const saved = saveSong(dir, makeSong('Tune', 3))
    expect(listSongs(dir)).toEqual([{ id: saved.id, title: 'Tune', composer: 'A Composer', noteCount: 3 }])
  })

  it('sorts the songs by title', () => {
    saveSong(dir, makeSong('Zebra'))
    saveSong(dir, makeSong('apple'))
    saveSong(dir, makeSong('Mango'))
    expect(listSongs(dir).map((s) => s.title)).toEqual(['apple', 'Mango', 'Zebra'])
  })

  it('skips files that are not named <uuid>.json', () => {
    saveSong(dir, makeSong('Kept'))
    writeFileSync(join(dir, 'notes.json'), JSON.stringify(makeSong('Wrong name')), 'utf8')
    writeFileSync(join(dir, 'canon-opening.json'), JSON.stringify(makeSong('Wrong name 2')), 'utf8')
    expect(listSongs(dir).map((s) => s.title)).toEqual(['Kept'])
  })

  it('skips a file that is broken JSON', () => {
    saveSong(dir, makeSong('Kept'))
    writeFileSync(join(dir, '6f1c2a3e-1b2c-4d5e-8f90-a1b2c3d4e5f6.json'), '{ not json', 'utf8')
    expect(listSongs(dir).map((s) => s.title)).toEqual(['Kept'])
  })

  it('skips a file whose song fails validateSong', () => {
    saveSong(dir, makeSong('Kept'))
    const bad = { ...makeSong('Broken'), title: '' }
    writeFileSync(join(dir, '6f1c2a3e-1b2c-4d5e-8f90-a1b2c3d4e5f6.json'), JSON.stringify(bad), 'utf8')
    expect(listSongs(dir).map((s) => s.title)).toEqual(['Kept'])
  })

  it('skips a file whose song id does not match its file name', () => {
    saveSong(dir, makeSong('Kept'))
    const moved = makeSong('Moved', 1, 'some-other-id')
    writeFileSync(join(dir, '6f1c2a3e-1b2c-4d5e-8f90-a1b2c3d4e5f6.json'), JSON.stringify(moved), 'utf8')
    expect(listSongs(dir).map((s) => s.title)).toEqual(['Kept'])
  })
})

describe('saveSong', () => {
  it('gives the song a new random UUID and ignores the importer id', () => {
    const saved = saveSong(dir, makeSong('Tune', 2, 'importer-id'))
    expect(saved.id).toMatch(UUID)
    expect(saved.id).not.toBe('importer-id')
  })

  it('gives every saved copy of the same song its own id', () => {
    const first = saveSong(dir, makeSong('Tune'))
    const second = saveSong(dir, makeSong('Tune'))
    expect(first.id).not.toBe(second.id)
    expect(listSongs(dir)).toHaveLength(2)
  })

  it('leaves only the song file behind, with no temporary file', () => {
    const saved = saveSong(dir, makeSong('Tune'))
    expect(readdirSync(dir)).toEqual([`${saved.id}.json`])
  })

  it('refuses a song that fails validateSong and writes nothing', () => {
    const bad = { ...makeSong('Tune'), title: '' }
    expect(() => saveSong(dir, bad)).toThrow()
    expect(() => readdirSync(dir)).toThrow()
  })

  it('creates the songs folder when it is missing', () => {
    mkdirSync(root, { recursive: true })
    expect(() => saveSong(dir, makeSong('Tune'))).not.toThrow()
    expect(listSongs(dir)).toHaveLength(1)
  })
})

describe('getSong', () => {
  it('gives back the saved song under its new id', () => {
    const saved = saveSong(dir, makeSong('Tune', 2))
    const song = getSong(dir, saved.id)
    expect(song).toBeDefined()
    expect(song?.id).toBe(saved.id)
    expect(song?.title).toBe('Tune')
    expect(song?.notes).toHaveLength(2)
    expect(validateSong(song).ok).toBe(true)
  })

  it('gives undefined for an id that is not saved', () => {
    expect(getSong(dir, '6f1c2a3e-1b2c-4d5e-8f90-a1b2c3d4e5f6')).toBeUndefined()
  })

  it('refuses an id that is not a UUID, so no other file can be read', () => {
    writeFileSync(join(root, 'secret.json'), JSON.stringify(makeSong('Outside')), 'utf8')
    mkdirSync(dir, { recursive: true })
    expect(getSong(dir, '../secret')).toBeUndefined()
    expect(getSong(dir, 'canon-opening')).toBeUndefined()
    expect(getSong(dir, '')).toBeUndefined()
    expect(getSong(dir, '6F1C2A3E-1B2C-4D5E-8F90-A1B2C3D4E5F6')).toBeUndefined()
  })
})
