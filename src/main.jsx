import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

if (import.meta.hot) {
  import.meta.hot.on('sargam:songs-updated', () => {
    window.dispatchEvent(new Event('sargam:songs-updated'))
  })
}

createRoot(document.getElementById('root')).render(<App />)
