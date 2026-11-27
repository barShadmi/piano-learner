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
    expect(result.bridge).toEqual(['audio', 'midi', 'version'])

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

test('the Sound screen opens from the library, says sound state, and goes back', async () => {
  const app = await launch()
  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Import file stays first in the Tab order; the Sound link comes right after it.
    await window.keyboard.press('Tab')
    await window.keyboard.press('Tab')
    const soundLink = window.getByRole('link', { name: 'Sound' })
    await expect(soundLink).toBeFocused()
    await window.keyboard.press('Enter')

    await expect(window.getByRole('heading', { name: 'Sound', level: 1 })).toBeVisible()
    // This container has no sound card, so sound ends up "could not start" (not a crash).
    // On a machine with sound it ends up "on". Either way it leaves "Starting".
    await expect(window.getByText(/^Sound (could not start|is on)\./)).toBeVisible({
      timeout: 20_000
    })

    // The piano sound loads on its own, even with no sound card to play it on.
    await expect(window.getByText('Piano sound is ready.')).toBeVisible({ timeout: 30_000 })
    await expect(
      window.getByText('Piano sound: Salamander Grand Piano by Alexander Holm (CC BY 3.0).')
    ).toBeVisible()

    // This container has no MIDI ports, so the piano shows as not found.
    await expect(
      window.getByText('No piano found. Check that the piano is on and the USB cable is plugged in.')
    ).toBeVisible({ timeout: 10_000 })
    await expect(window.getByRole('button', { name: 'Reconnect piano' })).toBeVisible()

    const play = window.getByRole('button', { name: 'Play test sound' })
    await expect(play).toBeVisible()
    if (await window.getByRole('button', { name: 'Try again' }).isVisible()) {
      await expect(play).toHaveAttribute('aria-disabled', 'true')
      await expect(window.getByText('Reason:')).toBeVisible()
    }

    await window.getByRole('link', { name: 'Back to your songs' }).click()
    await expect(window.getByRole('heading', { name: 'Your songs' })).toBeVisible()
  } finally {
    await app.close()
  }
})

test('the sound questions are answered through the bridge and bad input is refused', async () => {
  const app = await launch()
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    const result = await page.evaluate(async () => {
      const audio = (
        window as unknown as { pianoLearner: { audio: Record<string, (x?: unknown) => Promise<unknown>> } }
      ).pianoLearner.audio
      return {
        keys: Object.keys(audio).sort(),
        badStart: await audio.start({ bufferFrames: 1 }),
        badTone: await audio.testTone({ frequencyHz: -5 })
      }
    })
    expect(result.keys).toEqual(['listOutputs', 'start', 'state', 'status', 'testTone'])
    expect(result.badStart).toMatchObject({ phase: 'failed' })
    expect(result.badTone).toMatchObject({ ok: false })

    const piano = await page.evaluate(async () => {
      const midi = (window as unknown as { pianoLearner: { midi: Record<string, unknown> } }).pianoLearner
        .midi
      return { keys: Object.keys(midi).sort(), status: await (midi.status as () => Promise<unknown>)() }
    })
    expect(piano.keys).toEqual(['onEvents', 'reconnect', 'status'])
    expect(piano.status).toMatchObject({ ok: true, status: { connected: false } })
  } finally {
    await app.close()
  }
})
