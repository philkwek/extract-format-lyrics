import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startSetLinkSync } from './lib/setLinkSync'
import { startLiveShareSync } from './lib/liveShareSync'
import { startLyricsSync } from './lib/lyricsSync'
import { prefetchPads } from './lib/prefetchPads'
import { resetServiceWorker, serviceWorkerResetRequested } from './lib/serviceWorker'

startSetLinkSync()
startLiveShareSync()
startLyricsSync()

const reset = serviceWorkerResetRequested(window.location.search)
if (reset) {
  void resetServiceWorker().then(() => {
    const url = new URL(window.location.href)
    url.searchParams.delete('sw')
    window.location.replace(url.toString())
  })
} else {
  void prefetchPads()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
