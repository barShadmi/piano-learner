import { useEffect, useState } from 'react'
import Latency from './screens/Latency'
import Library from './screens/Library'
import NotFound from './screens/NotFound'
import Play from './screens/Play'
import Sound from './screens/Sound'
import { documentTitle, screenFor, songIdFor } from './routes'

export default function App() {
  const [hash, setHash] = useState(window.location.hash)

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const screen = screenFor(hash)

  // On every route change (including the first load): set the window title and move focus
  // to the screen's h1 so a screen reader announces the new screen. If focus is already inside
  // this screen, leave it where it is.
  useEffect(() => {
    document.title = documentTitle(screen)
    const heading = document.querySelector<HTMLHeadingElement>('main h1')
    if (!heading) return
    const active = document.activeElement
    if (active && heading.closest('main')?.contains(active)) return
    heading.tabIndex = -1
    // The h1 is a focus target only, not a control: no outline on it.
    heading.style.outline = 'none'
    heading.focus({ preventScroll: true })
  }, [hash, screen])

  if (screen === 'library') return <Library />
  if (screen === 'sound') return <Sound />
  if (screen === 'latency') return <Latency />
  if (screen === 'play') return <Play key={songIdFor(hash) ?? 'sample'} songId={songIdFor(hash)} />
  return <NotFound />
}
