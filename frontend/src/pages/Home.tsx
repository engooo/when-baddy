import { CourtTable } from '../components/CourtTable'
import type { AggregatedCourt, SportMode } from '../types'
import '../styles/Home.css'

interface HomeProps {
  courts: AggregatedCourt[]
  loading: boolean
  onRefresh: () => void
  selectedDate: string
  onDateChange: (date: string) => void
  sportMode: SportMode
  onSportModeChange: (mode: SportMode) => void
}

export default function Home({ courts, loading, onRefresh, selectedDate, onDateChange, sportMode, onSportModeChange }: HomeProps) {
  return (
    <div className="home-container">
      <CourtTable
        courts={courts}
        selectedDate={selectedDate}
        onDateChange={onDateChange}
        loading={loading}
        onRefresh={onRefresh}
        sportMode={sportMode}
        onSportModeChange={onSportModeChange}
      />
    </div>
  )
}
