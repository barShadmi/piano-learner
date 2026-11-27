// Tiny test fixtures, built in code so no binary files sit in the repo.
import { Midi } from '@tonejs/midi'
import { zipSync, strToU8 } from 'fflate'

/**
 * Sets the sharps/flats byte of the first key signature event (FF 59 02 sf mi).
 * @tonejs/midi's writer stores a wrong value there, so the fixture is patched by hand.
 */
function setKeyFifths(bytes: Uint8Array, fifths: number): Uint8Array {
  for (let i = 0; i < bytes.length - 4; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0x59 && bytes[i + 2] === 0x02) {
      bytes[i + 3] = fifths & 0xff
      return bytes
    }
  }
  throw new Error('fixture has no key signature')
}

/** Two tracks: a melody (higher) and a bass (lower), 120 bpm, 3/4, key of Bb (2 flats). */
export function twoTrackMidi(): Uint8Array {
  const midi = new Midi()
  midi.header.name = 'Little Tune'
  midi.header.setTempo(120)
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [3, 4] })
  midi.header.keySignatures.push({ ticks: 0, key: 'Cb', scale: 'major' }) // placeholder: setKeyFifths overwrites it
  midi.header.update()
  const ppq = midi.header.ppq

  const bass = midi.addTrack()
  bass.name = 'Bass'
  bass.addNote({ midi: 48, ticks: 0, durationTicks: ppq * 3, velocity: 0.5 })

  const melody = midi.addTrack()
  melody.name = 'Melody'
  melody.addNote({ midi: 72, ticks: 0, durationTicks: ppq, velocity: 0.8 })
  melody.addNote({ midi: 74, ticks: ppq, durationTicks: ppq / 2, velocity: 0.8 })
  melody.addNote({ midi: 76, ticks: ppq * 2, durationTicks: ppq, velocity: 0.8 })
  // Outside the piano range (below A0), must be dropped.
  melody.addNote({ midi: 10, ticks: 0, durationTicks: ppq, velocity: 0.8 })
  return setKeyFifths(midi.toArray(), -2)
}

/** One track, no name, notes on both sides of middle C, a tempo change, 4/4 default. */
export function oneTrackMidi(): Uint8Array {
  const midi = new Midi()
  midi.header.tempos.push({ ticks: 0, bpm: 100 }, { ticks: 960, bpm: 140 })
  midi.header.update()
  const ppq = midi.header.ppq
  const t = midi.addTrack()
  t.addNote({ midi: 59, ticks: 0, durationTicks: ppq, velocity: 0.5 })
  t.addNote({ midi: 60, ticks: ppq, durationTicks: ppq, velocity: 0.5 })
  t.addNote({ midi: 64, ticks: ppq * 5, durationTicks: ppq, velocity: 0.5 })
  return midi.toArray()
}

export function emptyMidi(): Uint8Array {
  const midi = new Midi()
  midi.addTrack()
  return midi.toArray()
}

/**
 * Two staves, divisions 2, 4/4, key of D, 2 measures. Has a chord, a tie across the
 * bar line, a backup, a forward, a rest, a grace note, fingerings, a tempo (sound)
 * and a tempo (metronome), and one note above the piano range.
 */
export const TWO_STAFF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>Two Staff Tune</work-title></work>
  <identification><creator type="composer">A. Writer</creator></identification>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <key><fifths>2</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
      </attributes>
      <direction><direction-type><words>Moderato</words></direction-type><sound tempo="120"/></direction>
      <note><grace/><pitch><step>C</step><alter>1</alter><octave>5</octave></pitch><voice>1</voice><staff>1</staff></note>
      <note>
        <pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff>
        <notations><technical><fingering>1</fingering></technical></notations>
      </note>
      <note>
        <chord/><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff>
        <notations><technical><fingering>3</fingering></technical></notations>
      </note>
      <note>
        <pitch><step>D</step><octave>5</octave></pitch><duration>6</duration><tie type="start"/><voice>1</voice><staff>1</staff>
        <notations><tied type="start"/></notations>
      </note>
      <backup><duration>8</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>8</duration><voice>2</voice><staff>2</staff></note>
    </measure>
    <measure number="2">
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>80</per-minute></metronome></direction-type></direction>
      <note>
        <pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><tie type="stop"/><voice>1</voice><staff>1</staff>
        <notations><tied type="stop"/></notations>
      </note>
      <note><rest/><duration>2</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
      <note><chord/><pitch><step>C</step><octave>9</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
      <backup><duration>8</duration></backup>
      <forward><duration>4</duration></forward>
      <note><pitch><step>F</step><octave>2</octave></pitch><duration>4</duration><voice>2</voice><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>
`

/** The same score, zipped the way notation programs write an .mxl. */
export function twoStaffMxl(): Uint8Array {
  return zipSync({
    'META-INF/container.xml': strToU8(
      '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score/main.xml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>'
    ),
    'score/main.xml': strToU8(TWO_STAFF_XML)
  })
}

/** A zip with no container.xml: the first .musicxml outside META-INF is used. */
export function twoStaffMxlNoContainer(): Uint8Array {
  return zipSync({
    'META-INF/readme.xml': strToU8('<readme/>'),
    'song.musicxml': strToU8(TWO_STAFF_XML)
  })
}

/** Builds a one-part score from measure XML, divisions 1 unless the measure says otherwise. */
export function scoreXml(partBody: string, extra = ''): string {
  return `<?xml version="1.0"?><score-partwise version="3.1">${extra}<part-list><score-part id="P1"/></part-list>${partBody}</score-partwise>`
}
