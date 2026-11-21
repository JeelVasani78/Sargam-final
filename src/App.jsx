import { useEffect } from 'react'
import { sargamBackend } from './lib/supabase.js'
import markup from './legacyMarkup.html?raw'

function App() {
  useEffect(() => {
    window.sargamBackend = sargamBackend
    const playerScript = document.createElement('script')
    playerScript.src = '/sargam.js'
    playerScript.async = false

    let disposed = false
    const startPlayer = async () => {
      try {
        await sargamBackend.initialize()
      } catch (error) {
        console.error('Supabase setup is incomplete:', error)
      }

      if (!disposed) document.body.appendChild(playerScript)
    }

    startPlayer()

    return () => {
      disposed = true
      playerScript.remove()
      delete window.sargamBackend
    }
  }, [])

  return <div className="legacy-app" dangerouslySetInnerHTML={{ __html: markup }} />
}

export default App
