import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startSetLinkSync } from './lib/setLinkSync'
import { startLiveShareSync } from './lib/liveShareSync'
import { startLyricsSync } from './lib/lyricsSync'

startSetLinkSync()
startLiveShareSync()
startLyricsSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
