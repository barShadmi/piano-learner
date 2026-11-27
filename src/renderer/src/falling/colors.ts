// Small colour helpers for the falling notes. Pure TypeScript.

/** "#rrggbb" or "#rgb" to a number, or undefined when it is not a hex colour. */
export function parseHex(text: string): number | undefined {
  const t = text.trim()
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t)
  if (!m) return undefined
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return parseInt(h, 16)
}

function channel(v: number): number {
  const c = v / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function luminance(rgb: number): number {
  return 0.2126 * channel((rgb >> 16) & 255) + 0.7152 * channel((rgb >> 8) & 255) + 0.0722 * channel(rgb & 255)
}

function contrast(a: number, b: number): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Of two text colours, the one with more contrast against the background. */
export function pickTextColour(background: number, a: number, b: number): number {
  return contrast(background, a) >= contrast(background, b) ? a : b
}
