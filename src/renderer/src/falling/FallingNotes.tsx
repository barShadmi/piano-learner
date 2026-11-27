// The falling notes: one PixiJS (WebGL) canvas. It only draws. It never makes sound.
// Notes come from a pool of reusable Pixi objects, so a frame only moves, shows or hides them.
import { useEffect, useRef, useState } from 'react'
import { Application, BitmapFont, BitmapText, Container, Graphics } from 'pixi.js'
// Pixi's own CSP-safe build of its shader code. Without it Pixi fails to start under our script-src 'self' rule (no eval).
import 'pixi.js/unsafe-eval'
import { keyboardLayout } from '../keyboard/layout'
import type { Hand } from '../../../shared/song/types'
import type { SongClock } from './clock'
import { parseHex, pickTextColour } from './colors'
import { SoundingTracker } from './sounding'
import type { NoteTiming, TimedNotes } from './songTime'
import { visibleFrom, visibleRange, visibleTo } from './visible'
import styles from './FallingNotes.module.css'

export const LOOKAHEAD_S = 3
const FONT_NAME = 'NoteLabel'
// A label is shown on notes down to this size, scaled to fit. Colour is never the only signal.
const MIN_LABEL_PX = 9
const FULL_LABEL_PX = 14
// The label font is installed once for the whole app run (the colour is a tint, so a theme change needs no new font).
let fontInstalled = false
const WHITE_KEYS = 52

// Where each pitch sits, in white-key units. Built once; the draw loop only reads it.
const PITCH_X = new Float64Array(128)
const PITCH_W = new Float64Array(128)
const PITCH_BLACK = new Uint8Array(128)
for (const k of keyboardLayout()) {
  PITCH_X[k.note] = k.x
  PITCH_W[k.note] = k.width
  PITCH_BLACK[k.note] = k.black ? 1 : 0
}

type Slot = {
  box: Container
  g: Graphics
  label: BitmapText
  note: NoteTiming | null
  seen: boolean
  // What the Graphics shows now, so it is redrawn only when one of these changes.
  w: number
  h: number
  version: number
  black: number
}

type Theme = {
  right: number
  left: number
  rightText: number
  leftText: number
  edge: number
  line: number
  radius: number
  font: string
}

type Props = {
  timed: TimedNotes
  clock: SongClock
  /** Called when the set of sounding notes changes (pitch to hand). Not every frame. */
  onSounding: (byPitch: ReadonlyMap<number, Hand>) => void
  /** Song time in seconds at which the song is over. */
  endS: number
  /** Called once when the clock passes endS while playing. */
  onEnd: () => void
}

function cssValue(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

// Reads the colours from the CSS tokens. Undefined when one of them is missing or not a hex colour.
function readTheme(): Theme | undefined {
  const right = parseHex(cssValue('--hand-right'))
  const left = parseHex(cssValue('--hand-left'))
  const surface = parseHex(cssValue('--surface'))
  const text = parseHex(cssValue('--text'))
  const line = parseHex(cssValue('--border'))
  const radius = parseFloat(cssValue('--radius-1'))
  const font = cssValue('--font-sans')
  if (
    right === undefined ||
    left === undefined ||
    surface === undefined ||
    text === undefined ||
    line === undefined ||
    !Number.isFinite(radius) ||
    font === ''
  ) {
    return undefined
  }
  return {
    right,
    left,
    rightText: pickTextColour(right, surface, text),
    leftText: pickTextColour(left, surface, text),
    edge: surface,
    line,
    radius,
    font
  }
}

// The most note slots that can be needed at once: the longest visibleRange over the whole song.
function maxVisible(timed: TimedNotes): number {
  let most = 1
  for (const n of timed.notes) {
    const [from, to] = visibleRange(timed, n.startS - LOOKAHEAD_S + 1e-6, LOOKAHEAD_S)
    most = Math.max(most, to - from)
  }
  return most
}

export default function FallingNotes({ timed, clock, onSounding, endS, onEnd }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  // The newest callbacks, read by the loop without restarting it.
  const callbacks = useRef({ onSounding, onEnd, endS })
  useEffect(() => {
    callbacks.current = { onSounding, onEnd, endS }
  })

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    let cancelled = false
    let cleanup: (() => void) | undefined

    const start = async (): Promise<void> => {
      const app = new Application()
      try {
        await app.init({
          preference: 'webgl',
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: window.devicePixelRatio || 1,
          width: Math.max(1, wrap.clientWidth),
          height: Math.max(1, wrap.clientHeight),
          autoStart: false,
          sharedTicker: false
        })
      } catch {
        try {
          app.destroy(true)
        } catch {
          /* it never started */
        }
        if (!cancelled) setFailed(true)
        return
      }
      if (cancelled) {
        app.destroy(true, { children: true })
        return
      }

      let theme = readTheme()
      if (theme === undefined) {
        app.destroy(true, { children: true })
        if (!cancelled) setFailed(true)
        return
      }
      let themeVersion = 0
      if (!fontInstalled) {
        BitmapFont.install({
          name: FONT_NAME,
          style: { fontFamily: theme.font, fontSize: 32, fontWeight: '700', fill: 0xffffff },
          chars: [['0', '9'], 'RL']
        })
        fontInstalled = true
      }

      wrap.appendChild(app.canvas)
      const lines = new Graphics()
      const whiteLayer = new Container()
      const blackLayer = new Container()
      app.stage.addChild(lines, whiteLayer, blackLayer)

      const tracker = new SoundingTracker(timed)
      const notes = timed.notes
      let poolSize = 0
      let slots: Slot[] = []
      const ensurePool = (n: number): void => {
        if (n <= poolSize) return
        for (const s of slots) s.box.destroy({ children: true })
        poolSize = n
        slots = []
        for (let i = 0; i < poolSize; i++) {
          const box = new Container()
          const g = new Graphics()
          const label = new BitmapText({ text: '', style: { fontFamily: FONT_NAME, fontSize: 12 } })
          label.anchor.set(0.5, 1)
          box.addChild(g, label)
          box.visible = false
          whiteLayer.addChild(box)
          slots.push({ box, g, label, note: null, seen: false, w: -1, h: -1, version: -1, black: 0 })
        }
      }
      ensurePool(maxVisible(timed))

      let width = Math.max(1, wrap.clientWidth)
      let height = Math.max(1, wrap.clientHeight)
      let linesDirty = true
      // The picture is drawn only when something changed: the song time moved, or a size or theme changed.
      let dirty = true
      let lastNowS = Number.NaN

      const drawLines = (): void => {
        const unit = width / WHITE_KEYS
        lines.clear()
        for (let x = 2; x < WHITE_KEYS; x += 7) {
          // One faint line at every C (white keys 2, 9, 16, ...).
          lines.rect(Math.round(x * unit), 0, 1, height)
        }
        lines.fill({ color: theme!.line, alpha: 0.5 })
        linesDirty = false
      }

      const resize = (): void => {
        width = Math.max(1, wrap.clientWidth)
        height = Math.max(1, wrap.clientHeight)
        app.renderer.resolution = window.devicePixelRatio || 1
        app.renderer.resize(width, height)
        linesDirty = true
        themeVersion++ // sizes changed, so every note is redrawn once
        dirty = true
      }
      const resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(wrap)

      // The screen's pixel density can change (another monitor, zoom). Watch for it, then watch for the next change.
      let densityQuery: MediaQueryList | undefined
      const onDensity = (): void => {
        resize()
        watchDensity()
      }
      const watchDensity = (): void => {
        densityQuery?.removeEventListener('change', onDensity)
        densityQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
        densityQuery.addEventListener('change', onDensity, { once: true })
      }
      watchDensity()

      const themeObserver = new MutationObserver(() => {
        const next = readTheme()
        if (next === undefined) return
        theme = next
        themeVersion++
        linesDirty = true
        dirty = true
      })
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

      // Draw one note's rectangle (and its label) into its slot. Only when something about it changed.
      const restyle = (s: Slot, n: NoteTiming, w: number, h: number): void => {
        const t = theme!
        s.w = w
        s.h = h
        s.version = themeVersion
        const colour = n.hand === 'right' ? t.right : t.left
        const r = Math.max(0, Math.min(t.radius, w / 2, h / 2))
        s.g.clear()
        s.g.roundRect(0, 0, w, h, r).fill(colour).stroke({ width: 1, color: t.edge, alignment: 1 })
        const showLabel = w >= MIN_LABEL_PX && h >= MIN_LABEL_PX
        s.label.visible = showLabel
        if (showLabel) {
          s.label.text = n.finger !== undefined ? String(n.finger) : n.hand === 'right' ? 'R' : 'L'
          s.label.tint = n.hand === 'right' ? t.rightText : t.leftText
          s.label.scale.set(Math.min(1, w / FULL_LABEL_PX, h / FULL_LABEL_PX))
          s.label.x = w / 2
          s.label.y = h - 2
        }
      }

      let frames = 0
      let ended = false
      // A small ring of (time, frames) to work out frames in the last second.
      const ringT = [performance.now(), performance.now()]
      const ringF = [0, 0]
      let ringAt = 0
      let lastStat = performance.now()
      let raf = 0

      const draw = (nowS: number): void => {
        if (linesDirty) drawLines()

        const from = visibleFrom(timed, nowS)
        const to = Math.max(from, visibleTo(timed, nowS, LOOKAHEAD_S))
        ensurePool(to - from)
        for (let i = 0; i < poolSize; i++) slots[i].seen = false

        const unit = width / WHITE_KEYS
        const pps = height / LOOKAHEAD_S
        for (let i = from; i < to; i++) {
          const n = notes[i]
          if (n.endS <= nowS) continue
          if (n.pitch < 21 || n.pitch > 108) continue
          const s = slots[i % poolSize]
          const w = PITCH_W[n.pitch] * unit
          const h = (n.endS - n.startS) * pps
          if (s.note !== n || s.w !== w || s.h !== h || s.version !== themeVersion) {
            if (s.note !== n || s.black !== PITCH_BLACK[n.pitch]) {
              s.black = PITCH_BLACK[n.pitch]
              ;(s.black ? blackLayer : whiteLayer).addChild(s.box)
            }
            s.note = n
            restyle(s, n, w, h)
          }
          s.box.x = PITCH_X[n.pitch] * unit
          s.box.y = height - (n.startS - nowS) * pps - h
          s.box.visible = true
          s.seen = true
        }
        for (let i = 0; i < poolSize; i++) {
          if (!slots[i].seen && slots[i].box.visible) slots[i].box.visible = false
        }

        app.render()
        frames++
      }

      const frame = (): void => {
        raf = requestAnimationFrame(frame)
        const nowS = clock.nowSeconds()

        if (nowS !== lastNowS || dirty) {
          lastNowS = nowS
          dirty = false
          if (tracker.update(nowS)) callbacks.current.onSounding(tracker.byPitch())
          if (nowS < callbacks.current.endS) {
            ended = false
          } else if (clock.isPlaying && !ended) {
            ended = true
            callbacks.current.onEnd()
          }
          draw(nowS)
        }

        const t = performance.now()
        if (t - lastStat >= 500) {
          lastStat = t
          wrap.setAttribute('data-frames', String(frames))
          const old = ringAt
          const dt = t - ringT[old]
          wrap.setAttribute('data-fps', String(dt > 0 ? Math.round(((frames - ringF[old]) / dt) * 1000) : 0))
          ringT[ringAt] = t
          ringF[ringAt] = frames
          ringAt = 1 - ringAt
        }
      }
      raf = requestAnimationFrame(frame)

      cleanup = () => {
        cancelAnimationFrame(raf)
        resizeObserver.disconnect()
        themeObserver.disconnect()
        densityQuery?.removeEventListener('change', onDensity)
        app.destroy(true, { children: true })
      }
    }

    void start()
    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [timed, clock])

  return (
    <div className={styles.wrap} ref={wrapRef} data-frames="0" data-fps="0">
      {failed ? <p className={styles.failed}>The falling notes could not start on this PC.</p> : null}
    </div>
  )
}
