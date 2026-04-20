import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import Home from './pages/Home'
import { AggregatedCourt } from './types'
import './App.css'

const apiBaseUrl = (import.meta.env.VITE_API_URL ?? 'https://when-baddy-api.onrender.com').replace(/\/$/, '')

function HeroHeader() {
  return (
    <header style={{ position: 'relative', overflow: 'hidden', background: '#ffffff', borderBottom: '1px solid #e0e0e0' }}>
      {/* Faint badminton court line pattern in the background */}
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.1, pointerEvents: 'none' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="court" width="140" height="140" patternUnits="userSpaceOnUse">
            <rect width="140" height="140" fill="none" stroke="#4CAF50" strokeWidth="1.5" />
            <line x1="70" y1="0" x2="70" y2="140" stroke="#4CAF50" strokeWidth="1" />
            <line x1="0" y1="46" x2="140" y2="46" stroke="#4CAF50" strokeWidth="1" />
            <line x1="0" y1="94" x2="140" y2="94" stroke="#4CAF50" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#court)" />
      </svg>

      {/* Title */}
      <div style={{ position: 'relative', maxWidth: '80rem', margin: '0 auto', padding: '3.7rem 1.5rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: 'clamp(2.5rem, 6vw, 4.5rem)', fontWeight: 900, fontStyle: 'italic', letterSpacing: '-0.02em', margin: 0, lineHeight: 1.1 }}>
          <span style={{ color: '#1a1a1a' }}>WHEN </span>
          <span style={{ color: '#4CAF50' }}>BADDY?</span>
        </h1>
        <p style={{ marginTop: '1rem', fontSize: '0.85rem', letterSpacing: '0.25em', textTransform: 'uppercase', color: '#777777', fontWeight: 500, whiteSpace: 'nowrap', margin: '1rem auto 0' }}>
          Find available badminton courts near you
        </p>
      </div>

      {/* Bottom accent stripe */}
      <div style={{ height: '3px', width: '100%', background: '#4CAF50' }} />
    </header>
  );
}

function todayStr(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const year = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  const day = parts.find((p) => p.type === 'day')?.value

  if (!year || !month || !day) {
    const fallback = new Date()
    return `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, '0')}-${String(fallback.getDate()).padStart(2, '0')}`
  }

  return `${year}-${month}-${day}`
}

function App() {
  const [courts, setCourts] = useState<AggregatedCourt[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string>(todayStr())
  const dateCache = useRef<Map<string, AggregatedCourt[]>>(new Map())
  const latestRequestRef = useRef(0)

  const fetchCourts = async (date: string, forceRefresh = false) => {
    const requestId = ++latestRequestRef.current
    if (!forceRefresh && dateCache.current.has(date)) {
      setCourts(dateCache.current.get(date)!)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    setCourts([])
    try {
      const apiUrl = `${apiBaseUrl}/api/courts?date=${date}`
      const response = await axios.get(apiUrl)
      if (requestId !== latestRequestRef.current) return
      const data: AggregatedCourt[] = response.data.data
      if (data.length > 0) {
        dateCache.current.set(date, data)
      } else {
        dateCache.current.delete(date)
      }
      setCourts(data)
    } catch (err) {
      if (requestId !== latestRequestRef.current) return
      let message = 'Failed to fetch courts'

      if (axios.isAxiosError(err)) {
        if (err.response) {
          message = `API error (${err.response.status}) from ${apiBaseUrl}`
        } else if (err.request) {
          message = `Network error: cannot reach API at ${apiBaseUrl}`
        } else if (err.message) {
          message = err.message
        }
      } else if (err instanceof Error) {
        message = err.message
      }

      setError(message)
      console.error('Error fetching courts:', err)
    } finally {
      if (requestId === latestRequestRef.current) {
        setLoading(false)
      }
    }
  }

  const handleDateChange = (date: string) => {
    setSelectedDate(date)
    fetchCourts(date)
  }

  const handleRefresh = () => {
    dateCache.current.delete(selectedDate)
    fetchCourts(selectedDate, true)
  }

  useEffect(() => {
    fetchCourts(todayStr())
  }, [])

  return (
    <div className="app-container">
      <HeroHeader />

      <main className="app-main">
        {error && <div className="error-banner">{error}</div>}

        <Home
          courts={courts}
          loading={loading}
          onRefresh={handleRefresh}
          selectedDate={selectedDate}
          onDateChange={handleDateChange}
        />
      </main>

      <footer className="app-footer">
        <p>Aggregating courts from Alpha Badminton, NBC Badminton, Pro1 Badminton & Roketto</p>
      </footer>
    </div>
  )
}

export default App
