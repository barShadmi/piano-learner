import { _electron as electron, expect, test } from '@playwright/test'

test('the app opens to the Your songs screen', async () => {
  const app = await electron.launch({ args: ['.', '--no-sandbox'] })
  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    expect(await window.title()).toBe('PianoLearner')
    await expect(window.getByText('Your songs')).toBeVisible()
  } finally {
    await app.close()
  }
})

test('the Import file button is off and reachable by keyboard', async () => {
  const app = await electron.launch({ args: ['.', '--no-sandbox'] })
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
  const app = await electron.launch({ args: ['.', '--no-sandbox'] })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    const result = await page.evaluate(() => ({
      require: typeof (globalThis as { require?: unknown }).require,
      process: typeof (globalThis as { process?: unknown }).process,
      opened: window.open('https://example.com'),
      bridge: Object.keys(
        (window as unknown as { pianoLearner: Record<string, unknown> }).pianoLearner
      ).sort()
    }))

    expect(result.require).toBe('undefined')
    expect(result.process).toBe('undefined')
    expect(result.opened).toBeNull()
    expect(['forcedTheme,version', 'version']).toContain(result.bridge.join(','))
  } finally {
    await app.close()
  }
})
