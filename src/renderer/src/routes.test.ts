import { describe, expect, it } from 'vitest'
import { documentTitle, screenFor, songIdFor } from './routes'

describe('documentTitle', () => {
  it('names the screen and the app for each screen', () => {
    expect(documentTitle('library')).toBe('Your songs · PianoLearner')
    expect(documentTitle('sound')).toBe('Sound · PianoLearner')
    expect(documentTitle('latency')).toBe('Delay test · PianoLearner')
    expect(documentTitle('play')).toBe('Play · PianoLearner')
    expect(documentTitle('not-found')).toBe('Screen not found · PianoLearner')
  })
})

describe('screenFor', () => {
  it('shows the library for an empty hash, a lone # and #/', () => {
    expect(screenFor('')).toBe('library')
    expect(screenFor('#')).toBe('library')
    expect(screenFor('#/')).toBe('library')
  })

  it('shows not-found for any other hash', () => {
    expect(screenFor('#/nope')).toBe('not-found')
  })
})

describe('screenFor sound', () => {
  it('shows the sound screen for #/sound', () => {
    expect(screenFor('#/sound')).toBe('sound')
  })

  it('does not match look-alikes', () => {
    expect(screenFor('#/sounds')).toBe('not-found')
    expect(screenFor('#/sound/x')).toBe('not-found')
  })
})

describe('screenFor latency', () => {
  it('shows the delay test for #/latency', () => {
    expect(screenFor('#/latency')).toBe('latency')
  })

  it('does not match look-alikes', () => {
    expect(screenFor('#/latency/x')).toBe('not-found')
    expect(screenFor('#/latencies')).toBe('not-found')
  })
})

describe('screenFor play', () => {
  it('shows the play screen for #/play', () => {
    expect(screenFor('#/play')).toBe('play')
  })

  it('does not match look-alikes', () => {
    expect(screenFor('#/plays')).toBe('not-found')
    expect(screenFor('#/play/x')).toBe('not-found')
  })
})

describe('screenFor play with a song', () => {
  const id = '6f1c2a3e-1b2c-4d5e-8f90-a1b2c3d4e5f6'

  it('shows the play screen for #/play/<song id>', () => {
    expect(screenFor(`#/play/${id}`)).toBe('play')
  })

  it('gives the song id from the route, and none for plain #/play', () => {
    expect(songIdFor(`#/play/${id}`)).toBe(id)
    expect(songIdFor('#/play')).toBeUndefined()
    expect(songIdFor('#/sound')).toBeUndefined()
  })

  it('does not take an id that is not a UUID', () => {
    expect(screenFor('#/play/x')).toBe('not-found')
    expect(screenFor('#/play/../secret')).toBe('not-found')
    expect(songIdFor('#/play/x')).toBeUndefined()
  })
})
