import { AggregatedCourt } from '../types'
import '../styles/CourtGrid.css'

interface CourtGridProps {
  courts: AggregatedCourt[]
}

export default function CourtGrid({ courts }: CourtGridProps) {
  if (courts.length === 0) {
    return (
      <div className="empty-state">
        <p>No courts found matching your filters.</p>
      </div>
    )
  }

  // Group by club, location, and court
  const grouped = courts.reduce(
    (acc, court) => {
      const clubKey = court.club
      const locKey = court.location
      const courtKey = court.courtName

      if (!acc[clubKey]) acc[clubKey] = {}
      if (!acc[clubKey][locKey]) acc[clubKey][locKey] = {}
      if (!acc[clubKey][locKey][courtKey]) acc[clubKey][locKey][courtKey] = []

      acc[clubKey][locKey][courtKey].push(court)
      return acc
    },
    {} as Record<string, Record<string, Record<string, AggregatedCourt[]>>>
  )

  return (
    <div className="court-grid">
      {Object.entries(grouped).map(([club, locations]) => (
        <div key={club} className="club-section">
          <h2 className={`club-title ${club}`}>
            {club === 'alpha' ? '🏸 Alpha Badminton' : '🏸 NBC Badminton'}
          </h2>

          {Object.entries(locations).map(([location, courts_by_name]) => (
            <div key={location} className="location-section">
              <h3 className="location-title">{location}</h3>

              <div className="courts-container">
                {Object.entries(courts_by_name).map(([courtName, timeSlots]) => (
                  <div key={courtName} className="court-card">
                    <div className="court-header">
                      <h4>{courtName}</h4>
                      <div className="court-stats">
                        <span className="slot-count">{timeSlots.length} slots</span>
                        <span className="available-badge">
                          {timeSlots.filter((t) => t.status === 'available').length} avail
                        </span>
                      </div>
                    </div>

                    <div className="time-slots">
                      {timeSlots.map((slot, idx) => (
                        <div
                          key={idx}
                          className={`time-slot status-${slot.status}`}
                          title={`${slot.timeSlot} - $${slot.price}`}
                        >
                          <div className="slot-time">{slot.timeSlot}</div>
                          <div className="slot-price">${slot.price}</div>
                          <div className="slot-status">{slot.status}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
