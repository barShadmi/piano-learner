import { describe, expect, it } from 'vitest'
import { validateSong } from './validate'
import sampleJson from './samples/canon-opening.json'

// Loose view of a song so tests can break one field at a time.
type Obj = Record<string, unknown>

function freshSong(): Obj {
  return structuredClone(sampleJson) as unknown as Obj
}

function noteAt(song: Obj, i: number): Obj {
  return (song.notes as Obj[])[i]
}

function measureAt(song: Obj, i: number): Obj {
  return (song.measures as Obj[])[i]
}

function tempoAt(song: Obj, i: number): Obj {
  return (song.tempos as Obj[])[i]
}

function errorsOf(value: unknown): string[] {
  const result = validateSong(value)
  return result.ok ? [] : result.errors
}

function hasErrorAt(errors: string[], path: string): boolean {
  return errors.some((e) => e.startsWith(`${path}:`))
}

// Pitches of the notes that start inside one 4/4 bar (0-based), for one hand, in time order.
function pitchesInBar(song: { notes: { pitch: number; start: number; hand: string }[] }, bar: number, hand: string): number[] {
  const from = bar * 4
  return song.notes
    .filter((n) => n.hand === hand && n.start >= from && n.start < from + 4)
    .sort((a, b) => a.start - b.start)
    .map((n) => n.pitch)
}

describe('canon-opening sample', () => {
  it('is a valid song', () => {
    const result = validateSong(sampleJson)
    expect(result.ok).toBe(true)
  })

  it('has 64 left-hand notes and 8 right-hand notes', () => {
    const notes = (sampleJson as { notes: { hand: string }[] }).notes
    expect(notes.filter((n) => n.hand === 'left')).toHaveLength(64)
    expect(notes.filter((n) => n.hand === 'right')).toHaveLength(8)
  })

  it('has bar 2 left-hand pitches as written', () => {
    const song = sampleJson as { notes: { pitch: number; start: number; hand: string }[] }
    expect(pitchesInBar(song, 1, 'left')).toEqual([47, 54, 59, 62, 42, 49, 54, 57])
  })

  it('has bar 7 right-hand pitches as written', () => {
    const song = sampleJson as { notes: { pitch: number; start: number; hand: string }[] }
    expect(pitchesInBar(song, 6, 'right')).toEqual([71, 69])
  })
})

describe('validateSong rules', () => {
  it('rejects a formatVersion other than 1', () => {
    const song = freshSong()
    song.formatVersion = 2
    expect(hasErrorAt(errorsOf(song), 'formatVersion')).toBe(true)
  })

  it('rejects an empty title', () => {
    const song = freshSong()
    song.title = ''
    expect(hasErrorAt(errorsOf(song), 'title')).toBe(true)
  })

  it('rejects keyFifths outside -7..7', () => {
    const song = freshSong()
    song.keyFifths = 8
    expect(hasErrorAt(errorsOf(song), 'keyFifths')).toBe(true)
  })

  it('rejects a song with no measures', () => {
    const song = freshSong()
    song.measures = []
    expect(hasErrorAt(errorsOf(song), 'measures')).toBe(true)
  })

  it('rejects measure indexes that are not 0, 1, 2 in order', () => {
    const song = freshSong()
    measureAt(song, 1).index = 5
    expect(hasErrorAt(errorsOf(song), 'measures[1].index')).toBe(true)
  })

  it('rejects measure starts that do not strictly increase', () => {
    const song = freshSong()
    measureAt(song, 2).start = measureAt(song, 1).start
    expect(hasErrorAt(errorsOf(song), 'measures[2].start')).toBe(true)
  })

  it('rejects a first measure that does not start at 0', () => {
    const song = freshSong()
    measureAt(song, 0).start = 1
    expect(hasErrorAt(errorsOf(song), 'measures[0].start')).toBe(true)
  })

  it('rejects a song with no tempo', () => {
    const song = freshSong()
    song.tempos = []
    expect(hasErrorAt(errorsOf(song), 'tempos')).toBe(true)
  })

  it('rejects a first tempo that does not start at 0', () => {
    const song = freshSong()
    tempoAt(song, 0).start = 2
    expect(hasErrorAt(errorsOf(song), 'tempos[0].start')).toBe(true)
  })

  it('rejects a tempo outside 20..300 bpm', () => {
    const song = freshSong()
    tempoAt(song, 0).bpm = 400
    expect(hasErrorAt(errorsOf(song), 'tempos[0].bpm')).toBe(true)
  })

  it('rejects duplicate note ids', () => {
    const song = freshSong()
    noteAt(song, 1).id = noteAt(song, 0).id
    expect(hasErrorAt(errorsOf(song), 'notes[1].id')).toBe(true)
  })

  it('rejects a pitch outside 21..108', () => {
    const song = freshSong()
    noteAt(song, 3).pitch = 109
    expect(hasErrorAt(errorsOf(song), 'notes[3].pitch')).toBe(true)
  })

  it('rejects a pitch that is not a whole number', () => {
    const song = freshSong()
    noteAt(song, 3).pitch = 60.5
    expect(hasErrorAt(errorsOf(song), 'notes[3].pitch')).toBe(true)
  })

  it('rejects a negative start', () => {
    const song = freshSong()
    noteAt(song, 4).start = -0.5
    expect(hasErrorAt(errorsOf(song), 'notes[4].start')).toBe(true)
  })

  it('rejects a zero duration', () => {
    const song = freshSong()
    noteAt(song, 0).duration = 0
    expect(hasErrorAt(errorsOf(song), 'notes[0].duration')).toBe(true)
  })

  it('rejects a hand that is not left or right', () => {
    const song = freshSong()
    noteAt(song, 0).hand = 'middle'
    expect(hasErrorAt(errorsOf(song), 'notes[0].hand')).toBe(true)
  })

  it('rejects a finger outside 1..5', () => {
    const song = freshSong()
    noteAt(song, 0).finger = 6
    expect(hasErrorAt(errorsOf(song), 'notes[0].finger')).toBe(true)
  })

  it('rejects a velocity outside 1..127', () => {
    const song = freshSong()
    noteAt(song, 0).velocity = 0
    expect(hasErrorAt(errorsOf(song), 'notes[0].velocity')).toBe(true)
  })

  it('rejects a confidence outside 0..1', () => {
    const song = freshSong()
    noteAt(song, 0).confidence = 1.5
    expect(hasErrorAt(errorsOf(song), 'notes[0].confidence')).toBe(true)
  })

  it('rejects a note that starts at or after the end of the last measure', () => {
    const song = freshSong()
    // 8 measures of 4 beats: the song ends at beat 32.
    noteAt(song, 0).start = 32
    expect(hasErrorAt(errorsOf(song), 'notes[0].start')).toBe(true)
  })

  it('rejects a value that is not an object', () => {
    expect(hasErrorAt(errorsOf(null), 'song')).toBe(true)
  })

  it('reports every broken field together, not just the first', () => {
    const song = freshSong()
    song.title = ''
    song.keyFifths = 9
    noteAt(song, 3).pitch = 109
    const errors = errorsOf(song)
    expect(hasErrorAt(errors, 'title')).toBe(true)
    expect(hasErrorAt(errors, 'keyFifths')).toBe(true)
    expect(hasErrorAt(errors, 'notes[3].pitch')).toBe(true)
  })
})

describe('validateSong step 2 checks', () => {
  it('rejects a second tempo that starts before the first', () => {
    const song = freshSong()
    song.tempos = [
      { start: 0, bpm: 100 },
      { start: 0, bpm: 120 },
    ]
    expect(hasErrorAt(errorsOf(song), 'tempos[1].start')).toBe(true)
  })

  it('rejects a later tempo with a bpm outside 20..300', () => {
    const song = freshSong()
    song.tempos = [
      { start: 0, bpm: 100 },
      { start: 8, bpm: 400 },
    ]
    expect(hasErrorAt(errorsOf(song), 'tempos[1].bpm')).toBe(true)
  })

  it('rejects a negative tempo start', () => {
    const song = freshSong()
    song.tempos = [
      { start: 0, bpm: 100 },
      { start: -4, bpm: 120 },
    ]
    expect(hasErrorAt(errorsOf(song), 'tempos[1].start')).toBe(true)
  })

  it('rejects a fingerSource that is not printed, auto or user', () => {
    const song = freshSong()
    noteAt(song, 0).fingerSource = 'guess'
    expect(hasErrorAt(errorsOf(song), 'notes[0].fingerSource')).toBe(true)
  })

  it('accepts a fingerSource of user', () => {
    const song = freshSong()
    noteAt(song, 0).fingerSource = 'user'
    expect(errorsOf(song)).toEqual([])
  })

  it('rejects a sheet source with an empty fileName', () => {
    const song = freshSong()
    song.source = { kind: 'sheet', fileName: '' }
    expect(hasErrorAt(errorsOf(song), 'source.fileName')).toBe(true)
  })

  it('rejects a midi source with no fileName', () => {
    const song = freshSong()
    song.source = { kind: 'midi' }
    expect(hasErrorAt(errorsOf(song), 'source.fileName')).toBe(true)
  })

  it('rejects a musicxml source with no fileName', () => {
    const song = freshSong()
    song.source = { kind: 'musicxml' }
    expect(hasErrorAt(errorsOf(song), 'source.fileName')).toBe(true)
  })

  it('rejects a video source with neither url nor fileName', () => {
    const song = freshSong()
    song.source = { kind: 'video', url: '', fileName: '' }
    expect(hasErrorAt(errorsOf(song), 'source')).toBe(true)
  })

  it('accepts a video source that has only a url', () => {
    const song = freshSong()
    song.source = { kind: 'video', url: 'https://example.com/v' }
    expect(errorsOf(song)).toEqual([])
  })

  it('rejects a level that is not melody, melody-bass or full', () => {
    const song = freshSong()
    song.level = 'piano'
    expect(hasErrorAt(errorsOf(song), 'level')).toBe(true)
  })

  it('rejects an empty composer', () => {
    const song = freshSong()
    song.composer = ''
    expect(hasErrorAt(errorsOf(song), 'composer')).toBe(true)
  })

  it('reports a hole in the notes array as not an object', () => {
    const song = freshSong()
    delete (song.notes as unknown[])[1]
    expect(hasErrorAt(errorsOf(song), 'notes[1]')).toBe(true)
  })

  it('reports a hole in the tempos array as not an object', () => {
    const song = freshSong()
    song.tempos = [
      { start: 0, bpm: 100 },
      { start: 8, bpm: 120 },
    ]
    delete (song.tempos as unknown[])[1]
    expect(hasErrorAt(errorsOf(song), 'tempos[1]')).toBe(true)
  })

  it('rejects a pitch of 20, just below the piano range', () => {
    const song = freshSong()
    noteAt(song, 0).pitch = 20
    expect(hasErrorAt(errorsOf(song), 'notes[0].pitch')).toBe(true)
  })

  it('rejects an unknown source kind', () => {
    const song = freshSong()
    song.source = { kind: 'cassette', fileName: 'tape.wav' }
    expect(hasErrorAt(errorsOf(song), 'source.kind')).toBe(true)
  })

  it('rejects a beatUnit that is not 1, 2, 4, 8 or 16', () => {
    const song = freshSong()
    ;(measureAt(song, 0).timeSignature as Obj).beatUnit = 3
    expect(hasErrorAt(errorsOf(song), 'measures[0].timeSignature.beatUnit')).toBe(true)
  })
})

describe('validateSong measure continuity', () => {
  it('reports only measure 0 when it does not start at 0', () => {
    const song = freshSong()
    measureAt(song, 0).start = 1
    expect(errorsOf(song)).toEqual(['measures[0].start: must be 0'])
  })

  it('rejects a measure that starts after the previous measure ends (a gap)', () => {
    const song = freshSong()
    // Measure 0 is 4 beats long, so measure 1 must start at beat 4. Beat 5 leaves a gap.
    measureAt(song, 1).start = 5
    const errors = errorsOf(song)
    expect(errors).toEqual(['measures[1].start: must start where measure 0 ends (beat 4)'])
  })

  it('rejects a measure that starts before the previous measure ends (an overlap)', () => {
    const song = freshSong()
    // Measure 1 starts at beat 4 and is 4 beats long, so measure 2 must start at beat 8. Beat 6 overlaps.
    measureAt(song, 2).start = 6
    const errors = errorsOf(song)
    expect(errors).toEqual(['measures[2].start: must start where measure 1 ends (beat 8)'])
  })
})

describe('validateSong accepts edge values', () => {
  type Setter = (song: Obj, value: number) => void
  const cases: [string, Setter, number][] = [
    ['a pitch of 21', (s, v) => { noteAt(s, 0).pitch = v }, 21],
    ['a pitch of 108', (s, v) => { noteAt(s, 0).pitch = v }, 108],
    ['a bpm of 20', (s, v) => { tempoAt(s, 0).bpm = v }, 20],
    ['a bpm of 300', (s, v) => { tempoAt(s, 0).bpm = v }, 300],
    ['a finger of 1', (s, v) => { noteAt(s, 0).finger = v }, 1],
    ['a finger of 5', (s, v) => { noteAt(s, 0).finger = v }, 5],
    ['a velocity of 1', (s, v) => { noteAt(s, 0).velocity = v }, 1],
    ['a velocity of 127', (s, v) => { noteAt(s, 0).velocity = v }, 127],
    ['a confidence of 0', (s, v) => { noteAt(s, 0).confidence = v }, 0],
    ['a confidence of 1', (s, v) => { noteAt(s, 0).confidence = v }, 1],
    ['a keyFifths of -7', (s, v) => { s.keyFifths = v }, -7],
    ['a keyFifths of 7', (s, v) => { s.keyFifths = v }, 7],
  ]

  it.each(cases)('gives no errors for %s', (_label, setValue, value) => {
    const song = freshSong()
    setValue(song, value)
    expect(errorsOf(song)).toEqual([])
  })
})

describe('validateSong rejects missing or empty parts', () => {
  it('rejects an empty song id', () => {
    const song = freshSong()
    song.id = ''
    expect(hasErrorAt(errorsOf(song), 'id')).toBe(true)
  })

  it('rejects a time signature with 0 beats', () => {
    const song = freshSong()
    ;(measureAt(song, 0).timeSignature as Obj).beats = 0
    expect(hasErrorAt(errorsOf(song), 'measures[0].timeSignature.beats')).toBe(true)
  })

  it('rejects notes that are not an array', () => {
    const song = freshSong()
    song.notes = 'not a list'
    expect(hasErrorAt(errorsOf(song), 'notes')).toBe(true)
  })

  it('rejects a measure that is not an object', () => {
    const song = freshSong()
    ;(song.measures as unknown[])[1] = 'bar two'
    expect(hasErrorAt(errorsOf(song), 'measures[1]')).toBe(true)
  })
})
