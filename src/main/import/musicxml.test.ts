import { describe, expect, it } from 'vitest'
import { validateSong } from '../../shared/song'
import { parseMusicXml, parseMxl } from './musicxml'
import {
  TWO_STAFF_XML,
  scoreXml,
  twoStaffMxl,
  twoStaffMxlNoContainer
} from './fixtures/fixtures'

function ok(xml: string, name = 'tune.musicxml') {
  const r = parseMusicXml(xml, name)
  if (!r.ok) throw new Error(r.error)
  return r.song
}

const m = (body: string, attrs = '<attributes><divisions>1</divisions></attributes>') =>
  `<part id="P1"><measure number="1">${attrs}${body}</measure></part>`
const n = (step: string, oct: number, dur: number, extra = '') =>
  `<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>${dur}</duration>${extra}</note>`

describe('parseMusicXml: the two-staff fixture', () => {
  const song = ok(TWO_STAFF_XML, 'C:\\songs\\two.musicxml')
  const by = (pitch: number) => song.notes.find((x) => x.pitch === pitch)!

  it('passes validateSong with source musicxml and the base file name', () => {
    expect(validateSong(song).ok).toBe(true)
    expect(song.source).toEqual({ kind: 'musicxml', fileName: 'two.musicxml' })
  })

  it('reads title, composer and key', () => {
    expect(song.title).toBe('Two Staff Tune')
    expect(song.composer).toBe('A. Writer')
    expect(song.keyFifths).toBe(2)
  })

  it('staff 1 is the right hand and staff 2 the left', () => {
    expect(song.notes.filter((x) => x.hand === 'right').map((x) => x.pitch).sort()).toEqual([70, 72, 74, 76])
    expect(song.notes.filter((x) => x.hand === 'left').map((x) => x.pitch).sort()).toEqual([41, 48])
  })

  it('turns divisions into beats and a chord shares one start', () => {
    expect(by(72)).toMatchObject({ start: 0, duration: 1 })
    expect(by(76)).toMatchObject({ start: 0, duration: 1 })
  })

  it('merges a tied note across the bar line into one longer note', () => {
    expect(song.notes.filter((x) => x.pitch === 74)).toHaveLength(1)
    expect(by(74)).toMatchObject({ start: 1, duration: 4 })
  })

  it('handles backup, forward, rest and alter', () => {
    expect(by(48)).toMatchObject({ start: 0, duration: 4 })
    expect(by(41)).toMatchObject({ start: 6, duration: 2 })
    expect(by(70)).toMatchObject({ start: 6, duration: 2 })
  })

  it('skips grace notes and drops notes above the piano range', () => {
    expect(song.notes.some((x) => x.pitch === 73)).toBe(false)
    expect(song.notes.some((x) => x.pitch === 120)).toBe(false)
    expect(song.notes).toHaveLength(6)
  })

  it('keeps printed fingerings 1 to 5', () => {
    expect(by(72)).toMatchObject({ finger: 1, fingerSource: 'printed' })
    expect(by(76)).toMatchObject({ finger: 3, fingerSource: 'printed' })
    expect(by(48).finger).toBeUndefined()
  })

  it('reads tempo from sound and from metronome, in quarter notes', () => {
    expect(song.tempos).toEqual([
      { start: 0, bpm: 120 },
      { start: 4, bpm: 80 }
    ])
  })

  it('makes measures from the time signature', () => {
    expect(song.measures).toEqual([
      { index: 0, start: 0, timeSignature: { beats: 4, beatUnit: 4 } },
      { index: 1, start: 4, timeSignature: { beats: 4, beatUnit: 4 } }
    ])
  })

  it('gives ids n1, n2, ... in start order', () => {
    expect(song.notes.map((x) => x.id)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6'])
    const starts = song.notes.map((x) => x.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })
})

describe('parseMusicXml: details', () => {
  it('two parts with no staves: part 1 right, part 2 left', () => {
    const xml = scoreXml(
      `<part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>${n('C', 4, 4)}</measure></part>` +
        `<part id="P2"><measure number="1"><attributes><divisions>1</divisions></attributes>${n('C', 5, 4)}</measure></part>`
    )
    const song = ok(xml)
    expect(song.notes.find((x) => x.pitch === 60)!.hand).toBe('right')
    expect(song.notes.find((x) => x.pitch === 72)!.hand).toBe('left')
  })

  it('one staff splits at middle C', () => {
    const song = ok(scoreXml(m(n('B', 3, 2) + n('C', 4, 2))))
    expect(song.notes.map((x) => x.hand)).toEqual(['left', 'right'])
  })

  it('follows a change of divisions', () => {
    const body = `<part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>${n('C', 4, 2)}</measure>` +
      `<measure number="2"><attributes><divisions>4</divisions></attributes>${n('D', 4, 2)}${n('E', 4, 2)}</measure></part>`
    const song = ok(scoreXml(body))
    expect(song.notes.map((x) => [x.start, x.duration])).toEqual([
      [0, 2],
      [2, 0.5],
      [2.5, 0.5]
    ])
  })

  it('handles a 3/4 time signature and a change of it', () => {
    const body = `<part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>3</beats><beat-type>4</beat-type></time></attributes>${n('C', 4, 3)}</measure>` +
      `<measure number="2"><attributes><time><beats>6</beats><beat-type>8</beat-type></time></attributes>${n('C', 4, 3)}</measure>` +
      `<measure number="3">${n('C', 4, 3)}</measure></part>`
    const song = ok(scoreXml(body))
    expect(song.measures.map((x) => [x.start, x.timeSignature.beats, x.timeSignature.beatUnit])).toEqual([
      [0, 3, 4],
      [3, 6, 8],
      [6, 6, 8]
    ])
  })

  it('uses 100 bpm when no tempo is written, and 0 fifths when no key', () => {
    const song = ok(scoreXml(m(n('C', 4, 4))))
    expect(song.tempos).toEqual([{ start: 0, bpm: 100 }])
    expect(song.keyFifths).toBe(0)
  })

  it('counts a half-note metronome as two quarter notes', () => {
    const dir = `<direction><direction-type><metronome><beat-unit>half</beat-unit><per-minute>50</per-minute></metronome></direction-type></direction>`
    expect(ok(scoreXml(m(dir + n('C', 4, 4)))).tempos).toEqual([{ start: 0, bpm: 100 }])
  })

  it('ignores fingerings that are not a single 1 to 5', () => {
    const fing = (t: string) => `<notations><technical><fingering>${t}</fingering></technical></notations>`
    const song = ok(scoreXml(m(n('C', 4, 1, fing('6')) + n('D', 4, 1, fing('2-1')) + n('E', 4, 1, fing('5')))))
    expect(song.notes.map((x) => x.finger)).toEqual([undefined, undefined, 5])
  })

  it('reads velocity from sound dynamics', () => {
    const song = ok(scoreXml(m('<sound dynamics="80"/>' + n('C', 4, 1))))
    expect(song.notes[0].velocity).toBe(72)
  })

  it('does not expand entities', () => {
    const xml = scoreXml(
      m(n('C', 4, 1)),
      '<work><work-title>&lol;&lol;</work-title></work>'
    ).replace('<score-partwise', '<!DOCTYPE score-partwise [<!ENTITY lol "lol">]><score-partwise')
    expect(ok(xml).title).not.toContain('lollol')
  })

  it('shifts a short first bar (pickup) so it ends at the bar line', () => {
    const body =
      `<part id="P1"><measure number="0" implicit="yes"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${n('G', 4, 1)}</measure>` +
      `<measure number="1">${n('C', 5, 4)}</measure></part>`
    const song = ok(scoreXml(body))
    expect(song.notes.map((x) => [x.pitch, x.start, x.duration])).toEqual([
      [67, 3, 1],
      [72, 4, 4]
    ])
  })

  it('decodes standard entities and numeric references in the title and composer', () => {
    const extra =
      '<work><work-title>Tom &amp; Jerry &lt;1&gt; &quot;a&quot; &apos;b&apos; &#65;&#x42;</work-title></work>' +
      '<identification><creator type="composer">A &amp; B</creator></identification>'
    const song = ok(scoreXml(m(n('C', 4, 1)), extra))
    expect(song.title).toBe('Tom & Jerry <1> "a" \'b\' AB')
    expect(song.composer).toBe('A & B')
  })

  it('treats negative durations as zero', () => {
    const song = ok(scoreXml(m(n('C', 4, -2) + n('D', 4, 4))))
    expect(song.notes.map((x) => [x.pitch, x.start])).toEqual([[62, 0]])
    const back = ok(scoreXml(m(n('C', 4, 4) + '<backup><duration>-5</duration></backup>' + n('D', 4, 4))))
    expect(back.notes.find((x) => x.pitch === 62)!.start).toBe(4)
  })

  it('says so when there are no notes', () => {
    expect(parseMusicXml(scoreXml(m('<note><rest/><duration>4</duration></note>')), 'a.xml')).toEqual({
      ok: false,
      error: 'This file has no notes.'
    })
  })

  it('gives a plain error for text that is not MusicXML', () => {
    const msg = 'This file could not be read as MusicXML.'
    expect(parseMusicXml('hello', 'a.xml')).toEqual({ ok: false, error: msg })
    expect(parseMusicXml('<html><body/></html>', 'a.xml')).toEqual({ ok: false, error: msg })
    expect(parseMusicXml('<score-partwise><part></score-partwise>', 'a.xml')).toEqual({ ok: false, error: msg })
  })

  it('falls back to the file name for the title', () => {
    expect(ok(scoreXml(m(n('C', 4, 1))), 'Fur Elise.xml').title).toBe('Fur Elise')
  })
})

describe('parseMxl', () => {
  it('reads the root file named in container.xml', () => {
    const r = parseMxl(twoStaffMxl(), 'two.mxl')
    if (!r.ok) throw new Error(r.error)
    expect(r.song.title).toBe('Two Staff Tune')
    expect(r.song.notes).toHaveLength(6)
    expect(r.song.source).toEqual({ kind: 'musicxml', fileName: 'two.mxl' })
  })

  it('falls back to the first .musicxml outside META-INF', () => {
    const r = parseMxl(twoStaffMxlNoContainer(), 'two.mxl')
    expect(r.ok).toBe(true)
  })

  it('gives a plain error for a broken zip', () => {
    expect(parseMxl(new Uint8Array([1, 2, 3, 4]), 'a.mxl')).toEqual({
      ok: false,
      error: 'This file could not be read as MusicXML.'
    })
  })
})
