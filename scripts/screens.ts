/// <reference lib="dom" />
// Saves a screenshot of every screen in light and dark at two window sizes.
// Usage: npm run screens -- --out <folder>
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { _electron as electron } from '@playwright/test'
import { screens } from './screens.config'

const themes = ['light', 'dark'] as const
const sizes = [
  { w: 1280, h: 800 },
  { w: 1920, h: 1080 }
]

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { out: { type: 'string', default: 'screens-out' } }
  })
  const outDir = resolve(values.out ?? 'screens-out')
  mkdirSync(outDir, { recursive: true })

  const root = resolve(__dirname, '..')
  const written: string[] = []

  for (const screen of screens) {
    for (const theme of themes) {
      for (const size of sizes) {
        const env: Record<string, string> = {}
        for (const [key, value] of Object.entries(process.env)) {
          if (value !== undefined && key !== 'ELECTRON_RENDERER_URL') env[key] = value
        }
        env['PIANO_SCREEN'] = screen.hash
        env['PIANO_THEME'] = theme

        const app = await electron.launch({ args: ['.', '--no-sandbox'], cwd: root, env })
        try {
          const page = await app.firstWindow()
          await app.evaluate(
            ({ BrowserWindow }, s) => {
              BrowserWindow.getAllWindows()[0]?.setContentSize(s.w, s.h)
            },
            size
          )
          await page.waitForLoadState('networkidle')
          await page.evaluate(() => document.fonts.ready)

          // A screen that does not exist shows "Screen not found". Stop instead of saving it.
          if (await page.getByText('Screen not found').isVisible()) {
            throw new Error(`Screen "${screen.name}" shows "Screen not found"`)
          }

          const file = join(outDir, `${screen.name}-${theme}-${size.w}x${size.h}.png`)
          await page.screenshot({ path: file })
          written.push(file)
        } finally {
          await app.close()
        }
      }
    }
  }

  console.log(`Saved ${written.length} screenshots:`)
  for (const file of written) console.log(file)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
