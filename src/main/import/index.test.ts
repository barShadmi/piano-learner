import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateSong } from '../../shared/song'
import { importSongFile } from './index'
import { TWO_STAFF_XML, emptyMidi, twoStaffMxl, twoTrackMidi } from './fixtures/fixtures'

let dir: string
const file = (name: string, data: Uint8Array | string): string => {
  const p = join(dir, name)
  writeFileSync(p, data)
  return p
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'import-test-'))
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('importSongFile', () => {
  it('imports a .mid file', async () => {
    const r = await importSongFile(file('a.mid', twoTrackMidi()))
    expect(r.ok && r.song.source).toEqual({ kind: 'midi', fileName: 'a.mid' })
    expect(r.ok && validateSong(r.song).ok).toBe(true)
  })

  it('picks the parser by extension, ignoring case', async () => {
    expect((await importSongFile(file('b.MIDI', twoTrackMidi()))).ok).toBe(true)
    expect((await importSongFile(file('c.musicxml', TWO_STAFF_XML))).ok).toBe(true)
    expect((await importSongFile(file('d.XML', TWO_STAFF_XML))).ok).toBe(true)
    expect((await importSongFile(file('e.mxl', twoStaffMxl()))).ok).toBe(true)
  })

  it('refuses an unknown extension with a plain sentence', async () => {
    const r = await importSongFile(file('f.pdf', 'x'))
    expect(r).toEqual({ ok: false, error: 'This kind of file cannot be imported yet. Pick a MIDI or MusicXML file.' })
  })

  it('reports an empty song', async () => {
    expect(await importSongFile(file('g.mid', emptyMidi()))).toEqual({ ok: false, error: 'This file has no notes. Pick another file.' })
  })

  it('reports a file that is not what its name says', async () => {
    expect(await importSongFile(file('h.mid', 'not midi'))).toEqual({
      ok: false,
      error: 'This file could not be read as MIDI.'
    })
  })

  it('refuses a file over 20 MB', async () => {
    const big = file('i.mid', new Uint8Array(20 * 1024 * 1024 + 1))
    expect(await importSongFile(big)).toEqual({ ok: false, error: 'This file is too big. Pick a file under 20 MB.' })
  })

  it('says so when the file is missing, without a stack trace', async () => {
    const r = await importSongFile(join(dir, 'missing.mid'))
    expect(r).toEqual({ ok: false, error: 'This file could not be opened.' })
  })
})
