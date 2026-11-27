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
