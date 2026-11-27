import { describe, expect, it } from 'vitest'
import { Midi } from '@tonejs/midi'
import { validateSong } from '../../shared/song'
import { parseMidi } from './midi'
import { emptyMidi, oneTrackMidi, twoTrackMidi } from './fixtures/fixtures'

function ok(bytes: Uint8Array, name = 'tune.mid') {
  const r = parseMidi(bytes, name)
  if (!r.ok) throw new Error(r.error)
  return r.song
}

describe('parseMidi', () => {
  it('makes a song that passes validateSong', () => {
    const song = ok(twoTrackMidi())
    expect(validateSong(song).ok).toBe(true)
    expect(song.source).toEqual({ kind: 'midi', fileName: 'tune.mid' })
  })

  it('puts the higher track in the right hand and the lower in the left', () => {
    const song = ok(twoTrackMidi())
    expect(song.notes.filter((n) => n.hand === 'right').map((n) => n.pitch)).toEqual([72, 74, 76])
    expect(song.notes.filter((n) => n.hand === 'left').map((n) => n.pitch)).toEqual([48])
  })

  it('converts ticks to quarter-note beats', () => {
    const song = ok(twoTrackMidi())
    const d = song.notes.find((n) => n.pitch === 74)!
    expect(d.start).toBe(1)
    expect(d.duration).toBe(0.5)
  })

  it('drops notes outside 21 to 108', () => {
    expect(ok(twoTrackMidi()).notes.some((n) => n.pitch === 10)).toBe(false)
  })

  it('gives unique ids n1, n2, ...', () => {
    const ids = ok(twoTrackMidi()).notes.map((n) => n.id)
    expect(ids[0]).toBe('n1')
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('reads velocity as 1..127', () => {
    const song = ok(twoTrackMidi())
    expect(song.notes.find((n) => n.pitch === 48)!.velocity).toBe(63)
  })

  it('reads the time signature, tempo and key', () => {
    const song = ok(twoTrackMidi())
    expect(song.measures).toEqual([{ index: 0, start: 0, timeSignature: { beats: 3, beatUnit: 4 } }])
    expect(song.tempos).toEqual([{ start: 0, bpm: 120 }])
    expect(song.keyFifths).toBe(-2)
  })

  it('uses the title from the file, else the file name without extension', () => {
    expect(ok(twoTrackMidi()).title).toBe('Little Tune')
    expect(ok(oneTrackMidi(), 'My Song.midi').title).toBe('My Song')
  })

  it('splits a single track at middle C', () => {
    const song = ok(oneTrackMidi())
    expect(song.notes.map((n) => [n.pitch, n.hand])).toEqual([
      [59, 'left'],
      [60, 'right'],
      [64, 'right']
    ])
  })

  it('reads tempo changes in beats, defaults to 4/4 and covers the whole song', () => {
    const song = ok(oneTrackMidi())
    expect(song.tempos).toEqual([
      { start: 0, bpm: 100 },
      { start: 2, bpm: 140 }
    ])
    expect(song.keyFifths).toBe(0)
    expect(song.measures.map((m) => m.start)).toEqual([0, 4])
    expect(song.measures[0].timeSignature).toEqual({ beats: 4, beatUnit: 4 })
  })

  it('says so when there are no notes', () => {
    const r = parseMidi(emptyMidi(), 'a.mid')
    expect(r).toEqual({ ok: false, error: 'This file has no notes. Pick another file.' })
  })

  it('gives a plain error for a file that is not MIDI', () => {
    const r = parseMidi(new TextEncoder().encode('hello'), 'a.mid')
    expect(r).toEqual({ ok: false, error: 'This file could not be read as MIDI.' })
  })

  it('skips drum tracks', () => {
    const midi = new Midi()
    const drums = midi.addTrack()
    drums.channel = 9
    drums.addNote({ midi: 36, ticks: 0, durationTicks: 480 })
    expect(parseMidi(midi.toArray(), 'd.mid')).toEqual({ ok: false, error: 'This file has no notes. Pick another file.' })
  })
})
