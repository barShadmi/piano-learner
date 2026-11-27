import { describe, expect, it } from 'vitest'
import { engineStart, leadInEnd, playView, soundIsRunning, SOUND_OFF } from './playState'

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
    const v = playView({ activity: 'watch', reason: SOUND_OFF })
    expect(v.status).toBe(SOUND_OFF)
    expect(v.soundLink).toBe(true)
    expect(v.watchPressed).toBe(true)
    expect(v.pauseDisabled).toBe(false)
  })
})

describe('soundIsRunning', () => {
  it('is true only when the engine phase is on', () => {
    expect(soundIsRunning({ phase: 'on' })).toBe(true)
    expect(soundIsRunning({ phase: 'off' })).toBe(false)
    expect(soundIsRunning({ phase: 'starting' })).toBe(false)
    expect(soundIsRunning({ phase: 'failed' })).toBe(false)
  })
  it('says how to turn the sound on', () => {
    expect(SOUND_OFF).toBe('Sound is off. Press Open Sound to turn it on.')
  })
})

describe('playView while waiting for the engine', () => {
  it('shows Starting the sound with Listen as the mode that is on, and no Sound link', () => {
    const v = playView({ activity: 'starting' })
    expect(v.status).toBe('Starting the sound…')
    expect(v.listenPressed).toBe(true)
    expect(v.soundLink).toBe(false)
    expect(v.pauseDisabled).toBe(true)
  })
})

describe('playView button looks', () => {
  it('before any press: Listen is primary, Watch secondary', () => {
    const v = playView({ activity: 'idle' })
    expect(v.listenClass).toBe('button')
    expect(v.watchClass).toBe('button button-secondary')
  })
  it('while Listen runs: Listen primary, Watch secondary', () => {
    const v = playView({ activity: 'listen' })
    expect(v.listenClass).toBe('button')
    expect(v.watchClass).toBe('button button-secondary')
  })
  it('while Watch runs: Watch primary, Listen secondary', () => {
    const v = playView({ activity: 'watch' })
    expect(v.watchClass).toBe('button')
    expect(v.listenClass).toBe('button button-secondary')
  })
  it('when paused, the mode that was running stays primary and pressed', () => {
    const w = playView({ activity: 'paused', mode: 'watch' })
    expect(w.watchPressed).toBe(true)
    expect(w.watchClass).toBe('button')
    expect(w.listenClass).toBe('button button-secondary')
    const l = playView({ activity: 'paused', mode: 'listen' })
    expect(l.listenPressed).toBe(true)
    expect(l.listenClass).toBe('button')
    expect(l.watchClass).toBe('button button-secondary')
    expect(l.pauseDisabled).toBe(true)
  })
  it('after a restart (idle) nothing is pressed even if a mode ran before', () => {
    const v = playView({ activity: 'idle', mode: 'watch' })
    expect(v.watchPressed).toBe(false)
    expect(v.listenClass).toBe('button')
  })
})
