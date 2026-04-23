import { CourtTable } from '../components/CourtTable'
import { AggregatedCourt } from '../types'
import '../styles/Home.css'

interface HomeProps {
  courts: AggregatedCourt[]
  loading: boolean
  onRefresh: () => void
  selectedDate: string
  onDateChange: (date: string) => void
}

export default function Home({ courts, loading, onRefresh, selectedDate, onDateChange }: HomeProps) {
  return (
    <div className="home-container">
      <CourtTable
        courts={courts}
        selectedDate={selectedDate}
        onDateChange={onDateChange}
        loading={loading}
        onRefresh={onRefresh}
      />
    </div>
  )
}
