import { describe, expect, it } from 'vitest'
import { engineStart, leadInEnd, playView } from './playState'

describe('engineStart', () => {
  it('waits for the rest of the lead-in when the clock is before 0', () => {
    expect(engineStart(-2)).toEqual({ kind: 'wait', waitMs: 2000 })
    expect(engineStart(-0.5)).toEqual({ kind: 'wait', waitMs: 500 })
  })
  it('starts at once from the clock position when it is 0 or later', () => {
    expect(engineStart(0)).toEqual({ kind: 'now', fromMs: 0 })
    expect(engineStart(12.5)).toEqual({ kind: 'now', fromMs: 12500 })
  })
})

describe('leadInEnd', () => {
  it('seeks the clock to 0 and sends 0, even when the timer fired a few ms late', () => {
    expect(leadInEnd()).toEqual({ seekS: 0, fromMs: 0 })
  })
})

describe('playView', () => {
  const idle = playView({ activity: 'idle' })
  it('says nothing and has nothing pressed before the first press', () => {
    expect(idle.status).toBe('')
    expect(idle.listenPressed).toBe(false)
    expect(idle.watchPressed).toBe(false)
    expect(idle.pauseDisabled).toBe(true)
    expect(idle.soundLink).toBe(false)
  })
  it('shows Listen pressed and enables Pause while it plays with sound', () => {
    const v = playView({ activity: 'listen' })
    expect(v.status).toBe('Playing with sound.')
    expect(v.listenPressed).toBe(true)
    expect(v.watchPressed).toBe(false)
    expect(v.pauseDisabled).toBe(false)
  })
  it('shows Watch pressed and enables Pause while it plays without sound', () => {
    const v = playView({ activity: 'watch' })
    expect(v.status).toBe('Playing without sound.')
    expect(v.watchPressed).toBe(true)
    expect(v.listenPressed).toBe(false)
    expect(v.pauseDisabled).toBe(false)
  })
  it('says Paused and disables Pause when paused', () => {
    const v = playView({ activity: 'paused' })
    expect(v.status).toBe('Paused.')
    expect(v.pauseDisabled).toBe(true)
    expect(v.listenPressed).toBe(false)
    expect(v.watchPressed).toBe(false)
  })
  it('tells how to hear the song again when it has finished', () => {
    const v = playView({ activity: 'finished' })
    expect(v.status).toBe('Song finished. Press Listen to hear it again.')
    expect(v.pauseDisabled).toBe(true)
  })
  it('shows the engine reason with the Sound link while the notes fall without sound', () => {
    const v = playView({ activity: 'watch', reason: 'Sound is not on yet.' })
    expect(v.status).toBe('Sound is not on yet.')
    expect(v.soundLink).toBe(true)
    expect(v.watchPressed).toBe(true)
    expect(v.pauseDisabled).toBe(false)
  })
})
