// The worker entry. It reads one file, runs the importer, and sends the result back.
// It is built as its own file (importWorker.js) next to the main process.
import { parentPort, workerData } from 'node:worker_threads'
import { importSongFile } from './index'

const { path } = workerData as { path: string }

void importSongFile(path).then((result) => {
  parentPort?.postMessage(result)
})
