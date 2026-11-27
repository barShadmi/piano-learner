// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Keyboard from './Keyboard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Lit = ReadonlyMap<number, 'pressed' | 'right' | 'left'>

let root: Root
let host: HTMLElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function show(lit: Lit = new Map()) {
  await act(async () => {
    root.render(<Keyboard lit={lit} />)
  })
}

const key = (note: number) => host.querySelector<HTMLElement>(`[data-note="${note}"]`)

describe('Keyboard', () => {
  it('renders 88 keys, 52 white and 36 black', async () => {
    await show()
    const keys = host.querySelectorAll('[data-note]')
    expect(keys.length).toBe(88)
    expect(host.querySelectorAll('[data-black="true"]').length).toBe(36)
    expect(host.querySelectorAll('[data-black="false"]').length).toBe(52)
  })

  it('is a labelled picture of a piano keyboard', async () => {
    await show()
    const board = host.querySelector('[role="img"]')
    expect(board?.getAttribute('aria-label')).toBe('Piano keyboard')
  })

  it('marks a pressed note and draws its dot', async () => {
    await show(new Map([[60, 'pressed']]))
    expect(key(60)?.getAttribute('data-state')).toBe('pressed')
    expect(key(60)?.querySelector('[data-dot]')).not.toBeNull()
    expect(key(64)?.getAttribute('data-state')).toBe('idle')
    expect(key(64)?.querySelector('[data-dot]')).toBeNull()
  })

  it('shows an R on a right-hand white key and an L on a left-hand white key', async () => {
    await show(
      new Map<number, 'pressed' | 'right' | 'left'>([
        [72, 'right'],
        [48, 'left']
      ])
    )
    expect(key(72)?.getAttribute('data-state')).toBe('right')
    expect(key(72)?.textContent).toContain('R')
    expect(key(48)?.getAttribute('data-state')).toBe('left')
    expect(key(48)?.textContent).toContain('L')
  })

  it('labels every C and marks middle C', async () => {
    await show()
    const text = host.textContent ?? ''
    for (let octave = 1; octave <= 8; octave++) {
      expect(text).toContain(`C${octave}`)
    }
    expect(text).toContain('Middle C')
  })
})
