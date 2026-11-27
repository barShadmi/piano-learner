import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('package.json', () => {
  it('names the app PianoLearner', () => {
    const pkgPath = new URL('../../package.json', import.meta.url)
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { productName?: string }
    expect(pkg.productName).toBe('PianoLearner')
  })
})
