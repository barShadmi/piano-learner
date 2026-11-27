// Runs the importer in a worker thread, so a big file never freezes the window.
// If the worker takes longer than the limit it is stopped and Bar is told so.
import { Worker } from 'node:worker_threads'
import type { ImportResult } from './index'

export const IMPORT_TIMEOUT_MS = 60_000

const TOO_LONG: ImportResult = { ok: false, error: 'Importing took too long. Try a smaller file.' }
const CRASHED: ImportResult = { ok: false, error: 'This file could not be imported.' }

export interface WorkerOptions {
  /** The built worker file (importWorker.js). */
  workerFile: string
  /** Defaults to IMPORT_TIMEOUT_MS. */
  timeoutMs?: number
}

// Resolves once, with the worker's answer, a timeout, or a crash. Never rejects.
export function runImportInWorker(path: string, { workerFile, timeoutMs = IMPORT_TIMEOUT_MS }: WorkerOptions): Promise<ImportResult> {
  return new Promise((resolve) => {
    let finished = false
    const worker = new Worker(workerFile, { workerData: { path } })
    const finish = (result: ImportResult): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      void worker.terminate()
      resolve(result)
    }
    const timer = setTimeout(() => finish(TOO_LONG), timeoutMs)
    worker.once('message', (result: ImportResult) => finish(result))
    worker.once('error', () => finish(CRASHED))
    worker.once('exit', () => finish(CRASHED))
  })
}
