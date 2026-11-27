// The delay test: plain numbers, the verdict and the report text. Pure: no sound, no files.
// The native engine reports the numbers; this file only turns them into words.

// How many keys make a full result.
export const KEYS_NEEDED = 20

// The fixed allowance for the USB cable from the piano (an estimate, not measured).
export const USB_MS = 1

// What the native engine reports (latencySummary). Same names as the engine's own type.
export type LatencySummary = {
  count: number
  medianMs: number
  p95Ms: number
  maxMs: number
  outputMs: number
  bufferFrames: number
  sampleRate: number
  backend: string
  underruns: number
}

export type LatencyVerdict = 'good' | 'close' | 'slow'

// Good when the slowest of most keys is under 10 ms; close up to 15 ms; slow above.
export function verdict(summary: LatencySummary): LatencyVerdict {
  if (summary.p95Ms < 10) return 'good'
  if (summary.p95Ms <= 15) return 'close'
  return 'slow'
}

export type VerdictWords = { glyph: string; text: string; tips: string[] }

// The same names as the Sound screen (its Mode and Buffer fields).
const tryThese = [
  'On the Sound screen, set Mode to Fastest (exclusive) or ASIO driver.',
  'Pick a smaller Buffer on the Sound screen.'
]

// A symbol and words for each verdict, so colour is never the only signal.
// The words name what the verdict judges: the slowest of most keys (95 in 100).
export function verdictWords(level: LatencyVerdict): VerdictWords {
  switch (level) {
    case 'good':
      return { glyph: '✓', text: 'Almost every key sounds in under 10 ms. Good.', tips: [] }
    case 'close':
      return {
        glyph: '▲',
        text: 'Most keys are fast, but some take over 10 ms.',
        tips: tryThese
      }
    case 'slow':
      return { glyph: '✗', text: 'Some keys take over 15 ms. Too slow.', tips: tryThese }
  }
}

// The big line: the typical key, from key to sound.
export function resultLine(medianMs: number): string {
  return `Typical key: about ${medianMs.toFixed(1)} ms.`
}

// Shown instead of the key count when the piano is there but no sound output is running.
export const SOUND_OFF_LINE = 'Sound is off. Go back to Sound and press Start sound or Try again.'

// Start over and Save report do nothing until one key is timed. This is the hint shown then.
export const PLAY_A_KEY_FIRST = 'Play a key first.'

// True once at least one key has been timed.
export function hasTimedKey(summary: LatencySummary | undefined): boolean {
  return summary !== undefined && summary.count > 0
}

// The words a screen reader hears about the count. Only every 5 keys and at the end,
// so the count is not read out after each key. Empty when nothing should be read.
export function progressAnnouncement(count: number): string {
  if (count === KEYS_NEEDED) return `All ${KEYS_NEEDED} keys timed.`
  if (count > 0 && count % 5 === 0) return `${count} of ${KEYS_NEEDED} keys timed.`
  return ''
}

// The line about where the sound card figure came from. WASAPI reports it from the driver;
// the other modes measure it.
export function soundCardLine(backend: string): string {
  const source = backend.startsWith('wasapi') ? 'reported by the sound driver' : 'measured'
  return `The sound card figure was ${source} when sound started.`
}

// True when no sound output is running, so no key can be timed yet.
export function soundIsOff(summary: LatencySummary): boolean {
  return summary.backend === ''
}

// The way sound is played, in words. Same words as the Sound screen.
export function outputWords(backend: string): string {
  switch (backend) {
    case 'wasapi-exclusive':
      return 'exclusive mode'
    case 'wasapi-shared':
      return 'shared mode'
    case 'asio':
      return 'ASIO'
    case 'cpal':
      return 'standard mode'
    default:
      return 'Not running'
  }
}

export type Row = { label: string; value: string }

const ms = (value: number): string => `${value.toFixed(1)} ms`

// The waiting time at the typical (median) key: the total minus the sound card and the USB allowance.
export function waitMs(summary: LatencySummary): number {
  return Math.max(0, summary.medianMs - summary.outputMs - USB_MS)
}

// The timing rows. Only meaningful once keys have been timed.
export function timingRows(summary: LatencySummary): Row[] {
  return [
    { label: 'Typical key', value: ms(summary.medianMs) },
    { label: 'Almost every key (95 in 100)', value: ms(summary.p95Ms) },
    { label: 'Slowest', value: ms(summary.maxMs) },
    { label: 'Waiting for the next sound slot (typical key)', value: ms(waitMs(summary)) },
    { label: 'Sound card and driver', value: ms(summary.outputMs) },
    { label: 'USB from the piano', value: `${ms(USB_MS)} (estimated)` }
  ]
}

// How sound is set up. Shown always.
export function setupRows(summary: LatencySummary): Row[] {
  return [
    { label: 'Mode', value: outputWords(summary.backend) },
    { label: 'Buffer', value: `${summary.bufferFrames} samples` },
    { label: 'Sample rate', value: `${summary.sampleRate} Hz` },
    { label: 'Sound gaps', value: String(summary.underruns) }
  ]
}

// The plain-text report, saved as latency-report.txt.
export function reportText(summary: LatencySummary, now: Date): string {
  const lines = ['PianoLearner delay test', `Saved at: ${now.toISOString()}`, '']
  if (summary.count === 0) {
    lines.push('No keys have been timed yet. Play some keys, then save the report again.')
  } else if (summary.count < KEYS_NEEDED) {
    lines.push(`Only ${summary.count} of ${KEYS_NEEDED} keys timed so far.`)
  } else {
    const words = verdictWords(verdict(summary))
    lines.push(resultLine(summary.medianMs), words.text)
  }
  if (summary.count > 0) {
    lines.push('')
    for (const row of timingRows(summary)) lines.push(`${row.label}: ${row.value}`)
    lines.push(soundCardLine(summary.backend))
  }
  lines.push('')
  for (const row of setupRows(summary)) lines.push(`${row.label}: ${row.value}`)
  lines.push(
    '',
    'This is an estimate. It does not count the headphone cable or the piano\'s own key scanning (a fraction of a millisecond).',
    ''
  )
  return lines.join('\n')
}

// The same numbers as JSON, saved as latency-report.json.
export function reportJson(summary: LatencySummary, now: Date): string {
  const full = summary.count >= KEYS_NEEDED
  const data = {
    savedAt: now.toISOString(),
    keysTimed: summary.count,
    medianMs: summary.medianMs,
    p95Ms: summary.p95Ms,
    maxMs: summary.maxMs,
    waitMs: summary.count > 0 ? waitMs(summary) : null,
    outputMs: summary.outputMs,
    outputMeasuredAt: 'when sound started',
    usbMs: USB_MS,
    verdict: full ? verdict(summary) : null,
    backend: summary.backend,
    bufferFrames: summary.bufferFrames,
    sampleRate: summary.sampleRate,
    underruns: summary.underruns
  }
  return `${JSON.stringify(data, null, 2)}\n`
}

// Replies from the main process to the Delay test screen. Errors are plain words.
export type LatencyReply = { ok: true; summary: LatencySummary } | { ok: false; error: string }
export type LatencyClearReply = { ok: true } | { ok: false; error: string }
export type LatencyOpenReply = { ok: true } | { ok: false; error: string }
export type LatencySaveReply = { ok: true; path: string } | { ok: false; error: string }
export type LatencyReportReply = { ok: true; text: string; json: string } | { ok: false; error: string }
