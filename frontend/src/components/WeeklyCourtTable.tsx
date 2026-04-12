import React, { useEffect, useMemo, useState } from 'react';
import '../styles/WeeklyCourtTable.css';

interface AggregatedCourt {
  club: 'alpha' | 'nbc';
  location: string;
  locationId: string;
  courtName: string;
  courtId: string;
  timeSlot: string; // e.g., "9:00am–10:00am"
  status: 'available' | 'booked' | 'past';
  price: number;
  date: string;
}

interface WeeklyCourtTableProps {
  courts: AggregatedCourt[];
  selectedDate: string;
  onDateChange: (date: string) => void;
  loading: boolean;
  onRefresh: () => void;
}

function formatDateDMY(dateStr: string): string {
  const [year, month, day] = dateStr.split('-');
  if (!year || !month || !day) return dateStr;
  return `${day}/${month}/${year}`;
}

function getSydneyTodayDate(): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);

  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

export const WeeklyCourtTable: React.FC<WeeklyCourtTableProps> = ({ courts, selectedDate, onDateChange, loading, onRefresh }) => {
  const [pendingBookingUrl, setPendingBookingUrl] = useState<string | null>(null);
  const [pendingLocation, setPendingLocation] = useState<string>('');
  const [timeTick, setTimeTick] = useState<number>(Date.now());

  const ALPHA_LOCATION_IDS: Record<string, number> = {
    'Alpha Slough': 1,
    'Alpha Egerton': 2,
    'Alpha Auburn': 3,
  };

  const NBC_LOCATION_IDS: Record<string, number> = {
    Silverwater: 1,
    'Seven Hills': 2,
    Granville: 4,
    'Castle Hill': 5,
    Alexandria: 6,
    'MQ Park': 7,
  };

  const getBookingUrl = (locationKey: string): string | null => {
    const [yearStr, monthStr, dayStr] = selectedDate.split('-');
    const year = parseInt(yearStr);
    const month = parseInt(monthStr);
    const day = parseInt(dayStr);

    if (!year || !month || !day) return null;

    if (locationKey.startsWith('Alpha - ')) {
      const name = locationKey.replace('Alpha - ', '');
      const id = ALPHA_LOCATION_IDS[name];
      if (!id) return null;

      const params = new URLSearchParams({
        day: day.toString(),
        month: month.toString(),
        year: year.toString(),
        id_sport: id.toString(),
        event: 'pageLoad',
        tab_type: 'normal',
        timetableWidth: '780',
      });

      return `https://alphabadminton.yepbooking.com.au/?${params.toString()}`;
    }

    if (locationKey.startsWith('NBC - ')) {
      const name = locationKey.replace('NBC - ', '');
      const id = NBC_LOCATION_IDS[name];
      if (!id) return null;

      const params = new URLSearchParams({
        day: day.toString(),
        month: month.toString(),
        year: year.toString(),
        id_sport: id.toString(),
        event: 'pageLoad',
        tab_type: 'normal',
        timetableWidth: '778',
      });

      return `https://nbc.yepbooking.com.au/?${params.toString()}`;
    }

    return null;
  };

  const handleCellClick = (bookingUrl: string | null, location: string) => {
    if (!bookingUrl) return;
    setPendingBookingUrl(bookingUrl);
    setPendingLocation(location);
  };

  const closeBookingModal = () => {
    setPendingBookingUrl(null);
    setPendingLocation('');
  };

  const confirmBooking = () => {
    if (!pendingBookingUrl) return;
    window.open(pendingBookingUrl, '_blank', 'noopener,noreferrer');
    closeBookingModal();
  };

  // All available time slots from 10am to 11pm (13 slots: 10-22)
  const ALL_TIME_HOURS = Array.from({ length: 13 }, (_, i) => 10 + i);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setTimeTick(Date.now());
    }, 30_000);

    return () => window.clearInterval(intervalId);
  }, []);

  const getSydneyCurrentHour = (): number => {
    const parts = new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Sydney',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(new Date(timeTick));

    const hourPart = parts.find((p) => p.type === 'hour')?.value;
    const hour = hourPart ? Number(hourPart) : NaN;
    return Number.isFinite(hour) ? hour : new Date(timeTick).getHours();
  };

  const currentHour = getSydneyCurrentHour();
  const sydneyToday = getSydneyTodayDate();
  const sydneyTodayStr = `${sydneyToday.getFullYear()}-${String(sydneyToday.getMonth() + 1).padStart(2, '0')}-${String(sydneyToday.getDate()).padStart(2, '0')}`;
  const shouldHighlightCurrentHour = selectedDate === sydneyTodayStr;

  const getDateFromOffset = (offset: number): Date => {
    const date = getSydneyTodayDate();
    date.setDate(date.getDate() + offset);
    date.setHours(0, 0, 0, 0);
    return date;
  };

  const formatDate = (date: Date): string => {
    return date.toLocaleDateString('en-AU', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatDateFull = (date: Date): string => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `${days[date.getDay()]}, ${formatDate(date)}`;
  };

  const getDateStr = (offset: number): string => {
    const date = getDateFromOffset(offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  // Get 7 days starting from today
  const weekDays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const date = getDateFromOffset(i);
        return {
          offset: i,
          date,
          display: formatDateFull(date),
        };
      }),
    []
  );

  const toggleDateSelection = (offset: number) => {
    onDateChange(getDateStr(offset));
  };

  // Group courts by location and time slot (data is already filtered for the selected date)
  const courtsByLocationAndTime = useMemo(() => {
    const grouped: { [key: string]: { [time: string]: AggregatedCourt[] } } = {};
    
    courts.forEach((court) => {
      const locationKey = `${court.club === 'alpha' ? 'Alpha' : 'NBC'} - ${court.location}`;
      if (!grouped[locationKey]) {
        grouped[locationKey] = {};
      }
      if (!grouped[locationKey][court.timeSlot]) {
        grouped[locationKey][court.timeSlot] = [];
      }
      grouped[locationKey][court.timeSlot].push(court);
    });
    
    return grouped;
  }, [courts]);

  // Get all unique locations
  const allLocations = useMemo(() => {
    return Object.keys(courtsByLocationAndTime).sort();
  }, [courtsByLocationAndTime]);

  const getCountForTimeSlot = (location: string, hour: number): number => {
    // Find the time slot that starts at this hour
    const timeSlots = courtsByLocationAndTime[location] || {};
    
    for (const timeSlot in timeSlots) {
      // First try matching range format: "10:00am–11:00am"
      let match = timeSlot.match(/(\d+):(\d+)(am|pm)–(\d+):(\d+)(am|pm)/);
      if (match) {
        let startHour = parseInt(match[1]);
        const startPeriod = match[3];
        if (startPeriod === 'pm' && startHour !== 12) startHour += 12;
        if (startPeriod === 'am' && startHour === 12) startHour = 0;
        
        if (startHour === hour) {
          return timeSlots[timeSlot].length;
        }
      } else {
        // Try single time format: "10:00am" or "10:00pm"
        match = timeSlot.match(/(\d+):(\d+)(am|pm)/);
        if (match) {
          let timeHour = parseInt(match[1]);
          const timePeriod = match[3];
          if (timePeriod === 'pm' && timeHour !== 12) timeHour += 12;
          if (timePeriod === 'am' && timeHour === 12) timeHour = 0;
          
          if (timeHour === hour) {
            return timeSlots[timeSlot].length;
          }
        }
      }
    }
    
    return 0;
  };

  const getPriceForTimeSlot = (location: string, hour: number): number | null => {
    const timeSlots = courtsByLocationAndTime[location] || {};
    for (const timeSlot in timeSlots) {
      let match = timeSlot.match(/(\d+):(\d+)(am|pm)–(\d+):(\d+)(am|pm)/);
      if (match) {
        let startHour = parseInt(match[1]);
        const startPeriod = match[3];
        if (startPeriod === 'pm' && startHour !== 12) startHour += 12;
        if (startPeriod === 'am' && startHour === 12) startHour = 0;
        if (startHour === hour && timeSlots[timeSlot].length > 0) {
          return timeSlots[timeSlot][0].price;
        }
      } else {
        match = timeSlot.match(/(\d+):(\d+)(am|pm)/);
        if (match) {
          let timeHour = parseInt(match[1]);
          const timePeriod = match[3];
          if (timePeriod === 'pm' && timeHour !== 12) timeHour += 12;
          if (timePeriod === 'am' && timeHour === 12) timeHour = 0;
          if (timeHour === hour && timeSlots[timeSlot].length > 0) {
            return timeSlots[timeSlot][0].price;
          }
        }
      }
    }
    return null;
  };

  const getAvailabilityClass = (location: string, hour: number): string => {
    const count = getCountForTimeSlot(location, hour);
    if (count === 0) return 'none-available';
    if (count === 1) return 'low-available';
    if (count === 2) return 'medium-available';
    if (count === 3) return 'high-available';
    return 'very-high-available';
  };

  const formatHourDisplay = (hour: number): string => {
    if (hour < 12) {
      return `${hour}:00 AM`;
    } else if (hour === 12) {
      return `12:00 PM`;
    } else {
      return `${hour - 12}:00 PM`;
    }
  };

  return (
    <div className="weekly-table-container">
      {/* Day Selector */}
      <div className="day-selector">
        {weekDays.map((day) => (
          <button
            key={day.offset}
            className={`day-chip ${getDateStr(day.offset) === selectedDate ? 'selected' : ''}`}
            onClick={() => toggleDateSelection(day.offset)}
          >
            {day.display}
          </button>
        ))}
        <button
          className="day-refresh-btn"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? 'Loading...' : '↻ Refresh Data'}
        </button>
      </div>

      {/* Table */}
      <div className="weekly-table-wrapper">
        <table className="weekly-court-table">
          <thead>
            <tr>
              <th className="location-column">Location</th>
              {ALL_TIME_HOURS.map((hour) => (
                <th key={hour} className={`time-header ${shouldHighlightCurrentHour && hour === currentHour ? 'current-hour' : ''}`}>
                  {formatHourDisplay(hour)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={ALL_TIME_HOURS.length + 1} className="table-loading-row">
                  <div className="table-loading-content">
                    <span className="table-loading-spinner" aria-hidden="true"></span>
                    <span>Loading court availability for {formatDateDMY(selectedDate)}...</span>
                  </div>
                </td>
              </tr>
            ) : allLocations.length > 0 ? (
              allLocations.map((location) => (
                <tr key={location}>
                  <td className="location-cell">
                    <span className="location-name">{location}</span>
                  </td>
                  {ALL_TIME_HOURS.map((hour) => {
                    const count = getCountForTimeSlot(location, hour);
                    const availClass = getAvailabilityClass(location, hour);
                    const bookingUrl = count > 0 ? getBookingUrl(location) : null;
                    const price = getPriceForTimeSlot(location, hour);
                    return (
                      <td
                        key={hour}
                        className={`availability-cell ${availClass} ${bookingUrl ? 'bookable' : ''} ${shouldHighlightCurrentHour && hour === currentHour ? 'current-hour' : ''}`}
                        title={bookingUrl ? 'Click to open booking page for this day' : ''}
                        onClick={() => handleCellClick(bookingUrl, location)}
                      >
                        {count > 0 && <span className="availability-number">{count}</span>}
                        {count > 0 && price !== null && price > 0 && (
                          <span className="availability-price">${price}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={ALL_TIME_HOURS.length + 1} className="empty-row">
                  No courts available for the selected date(s)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pendingBookingUrl && (
        <div className="booking-modal-overlay" onClick={closeBookingModal}>
          <div className="booking-modal" onClick={(event) => event.stopPropagation()}>
            <h3>Go To Booking Site?</h3>
            <p>
              Open the booking page for <strong>{pendingLocation}</strong> on <strong>{formatDateDMY(selectedDate)}</strong>?
            </p>
            <div className="booking-modal-actions">
              <button className="modal-btn modal-btn-cancel" onClick={closeBookingModal}>
                Cancel
              </button>
              <button className="modal-btn modal-btn-confirm" onClick={confirmBooking}>
                Go To Website
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
};
