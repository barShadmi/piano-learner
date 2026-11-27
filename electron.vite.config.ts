import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // Two main entries: the app, and the import worker (out/main/importWorker.js).
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          importWorker: resolve(__dirname, 'src/main/import/importWorker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()]
  }
})
