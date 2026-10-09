import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage'
import SearchPage from './pages/SearchPage'
import SessionPage from './pages/SessionPage'

function App() {
  return (
    <BrowserRouter>
      <header className="flex items-center justify-between border-b border-gray-300/40 px-4 py-3">
        <Link to="/" className="text-lg font-semibold">
          Chord Sheets
        </Link>
        <Link to="/search" className="text-sm underline">
          Search
        </Link>
      </header>
      <main className="mx-auto max-w-5xl p-4">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/session/:sessionId" element={<SessionPage />} />
          <Route path="/search" element={<SearchPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}

export default App
