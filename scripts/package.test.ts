import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pkgPath = new URL('../package.json', import.meta.url)
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
  productName?: string
  scripts: Record<string, string>
}

describe('package.json', () => {
  it('names the app PianoLearner', () => {
    expect(pkg.productName).toBe('PianoLearner')
  })

  it('builds the sound engine before the app and the installer', () => {
    expect(pkg.scripts['build']).toMatch(/^npm run build:native /)
    expect(pkg.scripts['dist:win']).toMatch(/^npm run build:native:asio /)
  })

  it('does not need the sound engine to run tests or the type check', () => {
    expect(pkg.scripts['test']).not.toMatch(/native/)
    expect(pkg.scripts['typecheck']).not.toMatch(/native/)
  })

  it('copies the engine file into the installer resources', () => {
    const builder = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8')
    expect(builder).toMatch(/extraResources:[\s\S]*from: native\/audio-engine[\s\S]*to: native/)
  })
})
