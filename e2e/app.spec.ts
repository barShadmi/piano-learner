import { _electron as electron, expect, test } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Each launch gets its own profile folder so parallel or repeated runs never share state.
function launch(): ReturnType<typeof electron.launch> {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-'))
  const launched = electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`] })
  // Remove the profile folder once the app has closed (or failed to start).
  const cleanup = (): void => fs.rmSync(userData, { recursive: true, force: true })
  void launched.then((app) => app.once('close', cleanup), cleanup)
  return launched
}

test('the app opens to the Your songs screen', async () => {
  const app = await launch()
  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    expect(await window.title()).toBe('PianoLearner')
    await expect(window.getByRole('heading', { name: 'Your songs' })).toBeVisible()
  } finally {
    await app.close()
  }
})

test('the Import file button is off and reachable by keyboard', async () => {
  const app = await launch()
  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const importButton = window.getByRole('button', { name: 'Import file' })
    await expect(importButton).toBeVisible()
    await expect(importButton).toHaveAttribute('aria-disabled', 'true')

    await window.keyboard.press('Tab')
    await expect(importButton).toBeFocused()
  } finally {
    await app.close()
  }
})

test('the window is locked down: no Node, no new windows, only the safe bridge', async () => {
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    const result = await page.evaluate(async () => ({
      require: typeof (globalThis as { require?: unknown }).require,
      process: typeof (globalThis as { process?: unknown }).process,
      opened: window.open('https://example.com'),
      midi: await navigator.requestMIDIAccess().then(
        () => 'granted',
        () => 'denied'
      ),
      bridge: Object.keys(
        (window as unknown as { pianoLearner: Record<string, unknown> }).pianoLearner
      ).sort()
    }))

    expect(result.require).toBe('undefined')
    expect(result.process).toBe('undefined')
    expect(result.opened).toBeNull()
    expect(result.midi).toBe('denied')
    expect(result.bridge).toEqual(['version'])

    await page.evaluate(() => {
      location.href = 'https://example.com'
    })
    await page.waitForTimeout(500)
    expect(page.url().startsWith('file:')).toBe(true)
  } finally {
    await app.close()
  }
})

test('an unknown route shows a way back to Your songs', async () => {
  const app = await launch()
  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.evaluate(() => {
      location.hash = '#/nope'
    })
    const back = window.getByRole('link', { name: 'Back to your songs' })
    await expect(back).toBeVisible()
    await back.click()
    await expect(window.getByRole('heading', { name: 'Your songs' })).toBeVisible()
  } finally {
    await app.close()
  }
})
