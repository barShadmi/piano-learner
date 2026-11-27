import { useEffect, useState } from 'react'
import Library from './screens/Library'
import NotFound from './screens/NotFound'
import { screenFor } from './routes'

export default function App() {
  const [hash, setHash] = useState(window.location.hash)

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return screenFor(hash) === 'library' ? <Library /> : <NotFound />
}
