import { describe, expect, it } from 'vitest'
import { SongClock } from './clock'

// A fake clock: the test moves `t` by hand, in milliseconds.
function fakeClock() {
  const state = { t: 1000 }
  const clock = new SongClock({ now: () => state.t })
  return { clock, state }
}

describe('SongClock', () => {
  it('starts paused at 0 seconds with speed 1', () => {
    const { clock, state } = fakeClock()
    expect(clock.nowSeconds()).toBe(0)
    expect(clock.speed).toBe(1)
    state.t += 5000
    expect(clock.nowSeconds()).toBe(0)
  })

  it('moves forward while playing', () => {
    const { clock, state } = fakeClock()
    clock.play()
    state.t += 1500
    expect(clock.nowSeconds()).toBeCloseTo(1.5, 10)
  })

  it('stops at the paused position', () => {
    const { clock, state } = fakeClock()
    clock.play()
    state.t += 1000
    clock.pause()
    state.t += 10000
    expect(clock.nowSeconds()).toBeCloseTo(1, 10)
  })

  it('carries on from the paused position when played again', () => {
    const { clock, state } = fakeClock()
    clock.play()
    state.t += 1000
    clock.pause()
    state.t += 10000
    clock.play()
    state.t += 500
    expect(clock.nowSeconds()).toBeCloseTo(1.5, 10)
  })

  it('seek sets the position while paused', () => {
    const { clock, state } = fakeClock()
    clock.seek(12.25)
    expect(clock.nowSeconds()).toBe(12.25)
    state.t += 1000
    expect(clock.nowSeconds()).toBe(12.25)
  })

  it('seek sets the position while playing and keeps playing from there', () => {
    const { clock, state } = fakeClock()
    clock.play()
    state.t += 1000
    clock.seek(10)
    expect(clock.nowSeconds()).toBeCloseTo(10, 10)
    state.t += 2000
    expect(clock.nowSeconds()).toBeCloseTo(12, 10)
  })

  it('goes at half speed when speed is 0.5 at play', () => {
    const { clock, state } = fakeClock()
    clock.play(0.5)
    expect(clock.speed).toBe(0.5)
    state.t += 2000
    expect(clock.nowSeconds()).toBeCloseTo(1, 10)
  })

  it('keeps its position when the speed changes while playing', () => {
    const { clock, state } = fakeClock()
    clock.play()
    state.t += 2000
    clock.play(0.5)
    expect(clock.nowSeconds()).toBeCloseTo(2, 10)
    state.t += 2000
    expect(clock.nowSeconds()).toBeCloseTo(3, 10)
  })

  it('play while already playing does not jump the position', () => {
    const { clock, state } = fakeClock()
    clock.play()
    state.t += 1000
    clock.play()
    state.t += 1000
    expect(clock.nowSeconds()).toBeCloseTo(2, 10)
  })

  it('uses the real performance.now clock when no now() is given', () => {
    const clock = new SongClock()
    expect(clock.nowSeconds()).toBe(0)
    clock.seek(3)
    expect(clock.nowSeconds()).toBe(3)
  })
})
