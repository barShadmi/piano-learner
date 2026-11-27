import { describe, expect, it } from 'vitest'
import { correction } from './follow'

describe('correction', () => {
  it('asks for no change when the engine says nothing is playing', () => {
    expect(correction(1.5, null)).toBeUndefined()
  })

  it('asks for no change when the clock is within 20 ms of the engine', () => {
    expect(correction(1.505, 1500)).toBeUndefined()
    expect(correction(1.495, 1500)).toBeUndefined()
  })

  it('moves the clock to the engine position when it is more than 20 ms ahead', () => {
    expect(correction(1.53, 1500)).toBeCloseTo(1.5, 10)
  })

  it('moves the clock to the engine position when it is more than 20 ms behind', () => {
    expect(correction(1.4, 1530)).toBeCloseTo(1.53, 10)
  })

  it('uses a threshold given by the caller', () => {
    expect(correction(1.53, 1500, 0.05)).toBeUndefined()
    expect(correction(1.6, 1500, 0.05)).toBeCloseTo(1.5, 10)
  })
})
