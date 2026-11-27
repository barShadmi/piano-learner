import { _electron as electron, expect, test } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Each launch gets its own profile folder so parallel or repeated runs never share state.
// A test that must keep state across two launches passes the same folder to both, and removes it itself.
function launch(sharedUserData?: string): ReturnType<typeof electron.launch> {
  const userData = sharedUserData ?? fs.mkdtempSync(path.join(os.tmpdir(), 'pl-'))
  const launched = electron.launch({ args: ['.', '--no-sandbox', `--user-data-dir=${userData}`] })
  if (sharedUserData !== undefined) return launched
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

    await expect(window.getByRole('button', { name: 'Import file' })).toBeVisible()
    await expect.poll(() => window.evaluate(() => document.hasFocus())).toBe(true)
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
    expect(result.bridge).toEqual(['audio', 'latency', 'midi', 'settings', 'version'])

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

    await expect(window.getByRole('button', { name: 'Import file' })).toBeVisible()
    await expect.poll(() => window.evaluate(() => document.hasFocus())).toBe(true)
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

test('the Play screen opens from the library, shows 88 keys, and goes back by keyboard', async () => {
  const app = await launch()
  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await window.getByRole('link', { name: 'Play the piano' }).click()
    await expect(window.getByRole('heading', { name: 'Play', level: 1 })).toBeVisible()

    await expect(window.getByRole('img', { name: 'Piano keyboard' })).toBeVisible()
    await expect(window.locator('[data-note]')).toHaveCount(88)
    await expect(window.getByText('No keys down.')).toBeVisible()

    // Keyboard only: the first Tab stop on this screen is the way back.
    await window.keyboard.press('Tab')
    const back = window.getByRole('link', { name: 'Back to your songs' })
    await expect(back).toBeFocused()
    await window.keyboard.press('Enter')
    await expect(window.getByRole('heading', { name: 'Your songs' })).toBeVisible()
  } finally {
    await app.close()
  }
})

test('the falling notes run, pause, reset, and look right in light and dark', async () => {
  test.setTimeout(60_000)
  const app = await launch()
  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    // Open, leave and open again: the view starts cleanly a second time.
    await window.getByRole('link', { name: 'Play the piano' }).click()
    await expect(window.locator('[data-frames] canvas')).toHaveCount(1)
    await window.getByRole('link', { name: 'Back to your songs' }).click()
    await window.getByRole('link', { name: 'Play the piano' }).click()
    await expect(window.getByText('Song: Canon in D (opening)')).toBeVisible()
    await expect(window.getByText('The falling notes could not start on this PC.')).toHaveCount(0)

    const notes = window.locator('[data-frames]')
    const frames = async (): Promise<number> => Number(await notes.getAttribute('data-frames'))
    // The canvas is there and the view is drawing.
    await expect(window.locator('[data-frames] canvas')).toHaveCount(1)
    await expect.poll(frames, { timeout: 15_000 }).toBeGreaterThan(0)

    // Not started: the picture is not redrawn (render on demand).
    await window.waitForTimeout(700)
    const idle = await frames()
    await window.waitForTimeout(700)
    expect(await frames()).toBe(idle)

    // The canvas is exactly as wide as the keyboard.
    const widths = await window.evaluate(() => ({
      canvas: document.querySelector('[data-frames] canvas')?.getBoundingClientRect().width,
      keyboard: document.querySelector('[role="img"]')?.getBoundingClientRect().width
    }))
    expect(widths.canvas).toBe(widths.keyboard)

    await window.getByRole('button', { name: 'Start', exact: true }).click()
    const before = await frames()
    // At least 30 frames a second: 45 new frames within 1.5 s of drawing, polled because
    // the count is only written twice a second.
    await expect.poll(async () => (await frames()) - before, { timeout: 3000 }).toBeGreaterThanOrEqual(45)
    await window.waitForTimeout(600)
    const fps = Number(await notes.getAttribute('data-fps'))
    console.log(`falling notes: data-fps=${fps}`)
    expect(fps).toBeGreaterThanOrEqual(30)

    // Pause stops the song clock: the lit keys stop changing and the frames stop growing.
    await window.getByRole('button', { name: 'Pause' }).click()
    const lit = async (): Promise<string> =>
      window.evaluate(() =>
        Array.from(document.querySelectorAll('[data-note]'))
          .filter((e) => ['right', 'left'].includes(e.getAttribute('data-state') ?? ''))
          .map((e) => `${e.getAttribute('data-note') ?? ''}${e.getAttribute('data-state') ?? ''}`)
          .join(',')
      )
    const pausedLit = await lit()
    await window.waitForTimeout(800)
    const pausedFrames = await frames()
    await window.waitForTimeout(800)
    expect(await lit()).toBe(pausedLit)
    expect(await frames()).toBe(pausedFrames)

    // Back to the start: nothing is lit (the song begins 2 s before its first note).
    await window.getByRole('button', { name: 'Back to the start' }).click()
    await expect.poll(lit).toBe('')

    // Screenshots 4 s into the song, in both themes.
    const shots = process.env['FALLING_SHOTS']
    for (const theme of ['light', 'dark'] as const) {
      await window.evaluate((t) => {
        document.documentElement.dataset.theme = t
      }, theme)
      await window.getByRole('button', { name: 'Back to the start' }).click()
      await window.getByRole('button', { name: 'Start', exact: true }).click()
      await window.waitForTimeout(4000)
      await expect.poll(async () => (await lit()) !== '').toBe(true)
      if (shots) await window.screenshot({ path: path.join(shots, `falling-${theme}.png`) })
      await window.getByRole('button', { name: 'Pause' }).click()
    }
  } finally {
    await app.close()
  }
})

test('the Delay test opens from Sound, says there is no piano, and saves a report', async () => {
  const app = await launch()
  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    await window.getByRole('link', { name: 'Sound' }).click()
    await window.getByRole('link', { name: 'Test the delay' }).click()

    await expect(window.getByRole('heading', { name: 'Delay test', level: 1 })).toBeVisible()
    // This container has no MIDI ports, so the test asks for the piano first.
    await expect(window.getByText('Connect the piano to run the test.')).toBeVisible({ timeout: 10_000 })
    await expect(window.getByRole('button', { name: 'Reconnect piano' })).toBeVisible()
    await expect(window.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
    await expect(window.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '20')

    const saved = await window.evaluate(async () => {
      const latency = (
        window as unknown as {
          pianoLearner: { latency: Record<string, () => Promise<unknown>> }
        }
      ).pianoLearner.latency
      return { keys: Object.keys(latency).sort(), save: (await latency.save()) as { ok: boolean; path?: string } }
    })
    expect(saved.keys).toEqual(['clear', 'save', 'showFile', 'summary'])
    expect(saved.save.ok).toBe(true)

    // The report lands in the app's own user data folder, under fixed names.
    const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
    expect(saved.save.path).toBe(path.join(userData, 'latency-report.txt'))
    expect(fs.existsSync(saved.save.path ?? '')).toBe(true)
    expect(fs.readFileSync(saved.save.path ?? '', 'utf8')).toContain('PianoLearner delay test')
    expect(fs.existsSync(path.join(userData, 'latency-report.json'))).toBe(true)

    await window.getByRole('link', { name: 'Back to Sound' }).click()
    await expect(window.getByRole('heading', { name: 'Sound', level: 1 })).toBeVisible()
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
        badTone: await audio.testTone({ frequencyHz: -5 }),
        goodVolume: await audio.setVolume(0.5),
        badVolume: await audio.setVolume(2)
      }
    })
    expect(result.keys).toEqual(['listOutputs', 'setVolume', 'start', 'state', 'status', 'testTone'])
    expect(result.badStart).toMatchObject({ phase: 'failed' })
    expect(result.badTone).toMatchObject({ ok: false })
    expect(result.goodVolume).toEqual({ ok: true })
    expect(result.badVolume).toMatchObject({ ok: false })

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

test('the sound settings are labelled, save at once, and are kept after a restart', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-settings-'))
  try {
    const first = await launch(userData)
    try {
      const window = await first.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await window.getByRole('link', { name: 'Sound' }).click()
      await expect(window.getByRole('heading', { name: 'Sound', level: 1 })).toBeVisible()

      for (const label of ['Output', 'Mode', 'Buffer', 'Volume']) {
        await expect(window.getByLabel(label, { exact: true })).toBeVisible()
      }
      await expect(window.getByLabel("Let the piano's own speakers play too", { exact: true })).not.toBeChecked()

      const buffer = window.getByLabel('Buffer', { exact: true })
      await expect(buffer).toHaveValue('128')
      await buffer.selectOption('256')
      await expect(window.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible()
    } finally {
      await first.close()
    }

    const second = await launch(userData)
    try {
      const window = await second.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      await window.getByRole('link', { name: 'Sound' }).click()
      await expect(window.getByLabel('Buffer', { exact: true })).toHaveValue('256')
    } finally {
      await second.close()
    }
  } finally {
    fs.rmSync(userData, { recursive: true, force: true })
  }
})
