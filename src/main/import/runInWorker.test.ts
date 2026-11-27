import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runImportInWorker } from './runInWorker'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'worker-test-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

// A stand-in worker file, written as plain JavaScript so a real worker_thread can run it.
function workerFile(body: string): string {
  const p = join(dir, `worker-${Math.random().toString(36).slice(2)}.js`)
  writeFileSync(p, body, 'utf8')
  return p
}

describe('runImportInWorker', () => {
  it('gives back the result the worker sends, with the path it was given', async () => {
    const file = workerFile(`
      const { parentPort, workerData } = require('node:worker_threads')
      parentPort.postMessage({ ok: false, error: 'seen ' + workerData.path })
    `)
    const result = await runImportInWorker('/music/a.mid', { workerFile: file, timeoutMs: 5000 })
    expect(result).toEqual({ ok: false, error: 'seen /music/a.mid' })
  })

  it('gives the timeout message when the worker takes too long', async () => {
    const file = workerFile(`setInterval(() => {}, 1000)`)
    const result = await runImportInWorker('/music/a.mid', { workerFile: file, timeoutMs: 100 })
    expect(result).toEqual({ ok: false, error: 'Importing took too long.' })
  })

  it('gives a plain error when the worker crashes', async () => {
    const file = workerFile(`throw new Error('boom')`)
    const result = await runImportInWorker('/music/a.mid', { workerFile: file, timeoutMs: 5000 })
    expect(result).toEqual({ ok: false, error: 'This file could not be imported.' })
  })
})
