import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import Home from './pages/Home'
import { AggregatedCourt } from './types'
import './App.css'

const apiBaseUrl = (import.meta.env.VITE_API_URL ?? 'https://when-baddy-api.onrender.com').replace(/\/$/, '')

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
      setError(err instanceof Error ? err.message : 'Failed to fetch courts')
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
      <header className="app-header">
        <div className="header-content">
          <h1><em>WHEN</em> <span>BADDY?</span></h1>
          <img src="/ant.jpeg" alt="Friend cameo" className="friend-pic" />
        </div>
        <p>Find Available Badminton Courts Near You</p>
      </header>

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
        <p>Aggregating courts from Alpha Badminton & NBC Badminton</p>
      </footer>
    </div>
  )
}

export default App
