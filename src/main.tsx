import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startSetLinkSync, flushSetLinkSync } from './lib/setLinkSync'
import { startLiveShareSync, flushLiveShareSync } from './lib/liveShareSync'
import { startLyricsSync, flushLyricsSync } from './lib/lyricsSync'
import { installStore } from './lib/installPrompt'
import { prefetchPads } from './lib/prefetchPads'
import { resetServiceWorker, serviceWorkerResetRequested } from './lib/serviceWorker'

startSetLinkSync()
startLiveShareSync()
startLyricsSync()

// Listen before React renders: the browser can fire this as soon as the page is installable.
installStore.start()

window.addEventListener('online', () => {
  void flushSetLinkSync()
  void flushLiveShareSync()
  void flushLyricsSync()
})

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
