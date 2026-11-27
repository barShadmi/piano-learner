import { describe, expect, it } from 'vitest'
import { pickAddonFile } from './addonFile'

describe('pickAddonFile', () => {
  const files = [
    'audio-engine.win32-x64-msvc.node',
    'audio-engine.linux-x64-gnu.node',
    'audio-engine.darwin-arm64.node',
    'notes.txt'
  ]

  it('picks the file for this platform and CPU', () => {
    expect(pickAddonFile(files, 'win32', 'x64')).toBe('audio-engine.win32-x64-msvc.node')
    expect(pickAddonFile(files, 'linux', 'x64')).toBe('audio-engine.linux-x64-gnu.node')
    expect(pickAddonFile(files, 'darwin', 'arm64')).toBe('audio-engine.darwin-arm64.node')
  })

  it('returns undefined when no file matches', () => {
    expect(pickAddonFile(files, 'win32', 'arm64')).toBeUndefined()
    expect(pickAddonFile([], 'linux', 'x64')).toBeUndefined()
  })

  it('does not match a name that merely starts with the same letters', () => {
    expect(pickAddonFile(['audio-engine.linux-x640-gnu.node'], 'linux', 'x64')).toBeUndefined()
    expect(pickAddonFile(['other.linux-x64-gnu.node'], 'linux', 'x64')).toBeUndefined()
  })
})
