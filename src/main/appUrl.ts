export type AppUrlConfig = {
  /** Dev server address, only set in a development run. */
  rendererUrl: string | undefined
  /** file:// address of the built page. */
  rendererFileUrl: string
}

// Only the app's own page may load in a window. Anything else is refused.
// The part after '#' is the app's own screen route, so it is ignored.
export function isAppUrl(url: string, { rendererUrl, rendererFileUrl }: AppUrlConfig): boolean {
  try {
    const parsed = new URL(url)
    if (rendererUrl) return parsed.origin === new URL(rendererUrl).origin
    parsed.hash = ''
    return parsed.href === rendererFileUrl
  } catch {
    return false
  }
}
