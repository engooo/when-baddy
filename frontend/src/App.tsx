import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import Home from './pages/Home'
import Header from './components/Header'
import type { AggregatedCourt, SportMode } from './types'
import './App.css'

const apiBaseUrl = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const COURT_CACHE_STORAGE_KEY = 'when-baddy:courts-cache:v1'

type CachedCourtEntry = {
  data: AggregatedCourt[]
  cachedAt: number
}

type ApiSport = 'badminton' | 'pickleball'

function getApiSportFromMode(mode: SportMode): ApiSport {
  return mode === 'map' ? 'pickleball' : 'badminton'
}

function getDateCacheKey(date: string, mode: SportMode): string {
  return `${date}:${getApiSportFromMode(mode)}`
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage
}

function getDateDistanceFromToday(targetDate: string): number | null {
  const targetParts = targetDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const todayParts = todayStr().match(/^(\d{4})-(\d{2})-(\d{2})$/)

  if (!targetParts || !todayParts) {
    return null
  }

  const target = new Date(Number(targetParts[1]), Number(targetParts[2]) - 1, Number(targetParts[3]))
  const today = new Date(Number(todayParts[1]), Number(todayParts[2]) - 1, Number(todayParts[3]))

  return Math.floor((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
}

function getCacheMaxAgeMs(date: string): number {
  const dayDiff = getDateDistanceFromToday(date)

  if (dayDiff === null || dayDiff <= 1) {
    return 5 * 60 * 1000
  }

  return 30 * 60 * 1000
}

function loadDateCache(): Map<string, CachedCourtEntry> {
  const storage = getStorage()

  if (!storage) {
    return new Map()
  }

  try {
    const raw = storage.getItem(COURT_CACHE_STORAGE_KEY)
    if (!raw) {
      return new Map()
    }

    const parsed = JSON.parse(raw) as Record<string, CachedCourtEntry>
    const entries = Object.entries(parsed).filter(([, value]) => (
      value && Array.isArray(value.data) && typeof value.cachedAt === 'number'
    ))

    return new Map(entries)
  } catch (error) {
    console.warn('Failed to load cached court data from local storage', error)
    return new Map()
  }
}

function persistDateCache(cache: Map<string, CachedCourtEntry>): void {
  const storage = getStorage()

  if (!storage) {
    return
  }

  try {
    storage.setItem(COURT_CACHE_STORAGE_KEY, JSON.stringify(Object.fromEntries(cache)))
  } catch (error) {
    console.warn('Failed to persist court data cache to local storage', error)
  }
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
  const [sportMode, setSportMode] = useState<SportMode>('grid')
  const dateCache = useRef<Map<string, CachedCourtEntry>>(loadDateCache())
  const latestRequestRef = useRef(0)

  const fetchCourts = async (date: string, forceRefresh = false, mode: SportMode = sportMode) => {
    const requestId = ++latestRequestRef.current
    const dateCacheKey = getDateCacheKey(date, mode)
    const apiSport = getApiSportFromMode(mode)
    const cachedEntry = dateCache.current.get(dateCacheKey)
    const hasCachedData = Boolean(cachedEntry && cachedEntry.data.length > 0)
    const isFreshCache = Boolean(
      cachedEntry && Date.now() - cachedEntry.cachedAt < getCacheMaxAgeMs(date)
    )

    if (!forceRefresh && cachedEntry && isFreshCache) {
      setError(null)
      setCourts(cachedEntry.data)
      setLoading(false)
      return
    }

    if (cachedEntry) {
      setCourts(cachedEntry.data)
    } else {
      setCourts([])
    }

    // Keep cached data visible and refresh in the background.
    // Only show blocking loading state when there is no cache to render.
    setLoading(!cachedEntry)
    setError(null)

    try {
      const apiUrl = `${apiBaseUrl}/api/courts?date=${date}&sport=${apiSport}`
      const response = await axios.get(apiUrl)
      if (requestId !== latestRequestRef.current) return
      const data: AggregatedCourt[] = response.data.data
      if (data.length > 0) {
        dateCache.current.set(dateCacheKey, { data, cachedAt: Date.now() })
        persistDateCache(dateCache.current)
      } else {
        dateCache.current.delete(dateCacheKey)
        persistDateCache(dateCache.current)
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

      if (hasCachedData && cachedEntry) {
        setCourts(cachedEntry.data)
        message = `${message}. Showing cached results.`
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
    fetchCourts(date, false, sportMode)
  }

  const handleRefresh = () => {
    // Keep existing cached data visible while forcing a background refresh.
    // This avoids blank/loading states during manual refresh.
    fetchCourts(selectedDate, true, sportMode)
  }

  const handleSportModeChange = (mode: SportMode) => {
    setSportMode(mode)
    fetchCourts(selectedDate, false, mode)
  }

  useEffect(() => {
    fetchCourts(todayStr())
  }, [])

  return (
    <div className="app-container">
      <Header sportMode={sportMode} />

      <main className="app-main">
        {error && <div className="error-banner">{error}</div>}

        <Home
          courts={courts}
          loading={loading}
          onRefresh={handleRefresh}
          selectedDate={selectedDate}
          onDateChange={handleDateChange}
          sportMode={sportMode}
          onSportModeChange={handleSportModeChange}
        />
      </main>

      <footer className="app-footer">
        <p>
          {sportMode === 'grid'
            ? 'Built by a bad baddy player'
            : 'Find a court to tickle your pickle!'}
        </p>
      </footer>
    </div>
  )
}

export default App
