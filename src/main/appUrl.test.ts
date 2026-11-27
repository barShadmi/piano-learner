import { describe, expect, it } from 'vitest'
import { isAppUrl } from './appUrl'

const rendererFileUrl = 'file:///app/out/renderer/index.html'

describe('isAppUrl', () => {
  const packaged = { rendererUrl: undefined, rendererFileUrl }

  it('allows the own file with a #/route', () => {
    expect(isAppUrl(`${rendererFileUrl}#/songs`, packaged)).toBe(true)
  })
  it('refuses the same file with a query', () => {
    expect(isAppUrl(`${rendererFileUrl}?x=1`, packaged)).toBe(false)
  })
  it('refuses another file URL', () => {
    expect(isAppUrl('file:///etc/passwd', packaged)).toBe(false)
  })
  it('refuses https', () => {
    expect(isAppUrl('https://example.com', packaged)).toBe(false)
  })
  it('refuses a malformed URL', () => {
    expect(isAppUrl('not a url', packaged)).toBe(false)
  })
  it('allows the dev origin only when rendererUrl is set', () => {
    const dev = { rendererUrl: 'http://localhost:5173', rendererFileUrl }
    expect(isAppUrl('http://localhost:5173/#/x', dev)).toBe(true)
    expect(isAppUrl('http://localhost:5173/#/x', packaged)).toBe(false)
  })
})
