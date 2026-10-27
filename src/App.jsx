import { useEffect, useState } from 'react'
import { Library } from './Library.jsx'
import { Reader } from './Reader.jsx'

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0] === 'war' && parts[1]) return { name: 'war', warId: parts[1] }
  if (parts[0] === 'servants') return { name: 'servants' }
  if (parts[0] === 'read' && parts[2]) return { name: 'read', warId: parts[1], scriptId: parts[2] }
  return { name: 'home' }
}

export function App() {
  const [route, setRoute] = useState(parseHash)
  useEffect(() => {
    const f = () => setRoute(parseHash())
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  const navigate = (h) => {
    location.hash = h
  }
  if (route.name === 'read') return <Reader key={route.scriptId} warId={route.warId} scriptId={route.scriptId} navigate={navigate} />
  return <Library route={route} navigate={navigate} />
}
