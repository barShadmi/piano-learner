import { useEffect, useState } from 'react'
import Latency from './screens/Latency'
import Library from './screens/Library'
import NotFound from './screens/NotFound'
import Sound from './screens/Sound'
import { screenFor } from './routes'

export default function App() {
  const [hash, setHash] = useState(window.location.hash)

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const screen = screenFor(hash)
  if (screen === 'library') return <Library />
  if (screen === 'sound') return <Sound />
  if (screen === 'latency') return <Latency />
  return <NotFound />
}
