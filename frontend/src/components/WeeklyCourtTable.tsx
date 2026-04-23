import React, { useEffect, useMemo, useState } from 'react';
import {
  MapPin,
  ChevronDown,
  SlidersHorizontal,
  LayoutGrid,
  Map as MapIcon,
  Moon,
  Sunrise,
  DollarSign,
  Navigation,
  Zap,
} from 'lucide-react';
import '../styles/WeeklyCourtTable.css';

interface AggregatedCourt {
  club: 'alpha' | 'nbc' | 'pro1' | 'roketto';
  location: string;
  locationId: string;
  address: string;
  suburb: string;
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

const DEFAULT_START_HOUR = 10;
const DEFAULT_END_HOUR = 22;

// Suburbs in order
const SUBURB_ORDER = [
  'Silverwater',
  'Auburn',
  'Granville',
  'Lidcombe',
  'Bankstown',
  'Castle Hill',
  'Seven Hills',
  'Lane Cove',
  'Alexandria',
];

function clampHour(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_START_HOUR;
  if (value < DEFAULT_START_HOUR) return DEFAULT_START_HOUR;
  if (value > DEFAULT_END_HOUR) return DEFAULT_END_HOUR;
  return value;
}
function parseOptionalHourParam(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTimeSlotStartHour(timeSlot: string): number | null {
  const normalized = timeSlot.trim().toLowerCase();

  // Range format, e.g. "4:00pm–5:00pm"
  let match = normalized.match(/^(\d{1,2}):(\d{2})(am|pm)\s*[–-]\s*(\d{1,2}):(\d{2})(am|pm)$/);
  if (match) {
    let hour = Number(match[1]);
    const period = match[3];
    if (period === 'pm' && hour !== 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;
    return hour;
  }

  // Single time format, e.g. "4:00pm"
  match = normalized.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
  if (match) {
    let hour = Number(match[1]);
    const period = match[3];
    if (period === 'pm' && hour !== 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;
    return hour;
  }

  return null;
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
  const initialFilters = useMemo(() => {
    if (typeof window === 'undefined') {
      return {
        selectedSuburbs: [] as string[],
        fromHour: DEFAULT_START_HOUR,
        toHour: DEFAULT_END_HOUR,
        hideEmpty: true,
      };
    }

    const params = new URLSearchParams(window.location.search);
    const suburbsParam = params.get('suburbs');
    const selectedSuburbs: string[] = suburbsParam
      ? suburbsParam.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
      : [];

    const fromParam = parseOptionalHourParam(params.get('from'));
    const toParam = parseOptionalHourParam(params.get('to'));
    const fromHour = fromParam === null ? DEFAULT_START_HOUR : clampHour(fromParam);
    const toHour = toParam === null ? DEFAULT_END_HOUR : clampHour(toParam);

    const hideEmptyParam = params.get('hideEmpty');
    const hideEmpty = hideEmptyParam === '0' || hideEmptyParam === 'false' ? false : true;

    return {
      selectedSuburbs,
      fromHour: Math.min(fromHour, toHour),
      toHour: Math.max(fromHour, toHour),
      hideEmpty,
    };
  }, []);

  const [pendingBookingUrl, setPendingBookingUrl] = useState<string | null>(null);
  const [pendingLocation, setPendingLocation] = useState<string>('');
  const [timeTick, setTimeTick] = useState<number>(Date.now());
  const [selectedSuburbs, setSelectedSuburbs] = useState<string[]>(initialFilters.selectedSuburbs);
  const [startHour, setStartHour] = useState<number>(initialFilters.fromHour);
  const [endHour, setEndHour] = useState<number>(initialFilters.toHour);
  const [hideEmptyLocations, setHideEmptyLocations] = useState<boolean>(initialFilters.hideEmpty);
  const [priceCap, setPriceCap] = useState<number | null>(null);
  const [isSuburbPanelOpen, setIsSuburbPanelOpen] = useState<boolean>(false);
  const [isPricePanelOpen, setIsPricePanelOpen] = useState<boolean>(false);
  const [isTimePanelOpen, setIsTimePanelOpen] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'grid' | 'map'>('grid');
  const [mapsModalInfo, setMapsModalInfo] = useState<{ location: string; address: string } | null>(null);

  const toggleSuburb = (suburb: string) => {
    setSelectedSuburbs((prev) => {
      if (prev.includes(suburb)) {
        return prev.filter((s) => s !== suburb);
      } else {
        return [...prev, suburb];
      }
    });
  };

  const allSuburbsInCourts = useMemo(() => {
    const suburbs = new Set(courts.map((court) => court.suburb));
    return Array.from(suburbs).sort((a, b) => {
      const aIndex = SUBURB_ORDER.indexOf(a);
      const bIndex = SUBURB_ORDER.indexOf(b);
      if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
  }, [courts]);

  const getBookingUrl = (locationKey: string): string | null => {
    const [yearStr, monthStr, dayStr] = selectedDate.split('-');
    const year = parseInt(yearStr);
    const month = parseInt(monthStr);
    const day = parseInt(dayStr);

    if (!year || !month || !day) return null;

    // locationKey is "Club LocationName" (e.g. "Alpha Auburn")
    // c.location is just "Auburn", so strip the "Club " prefix before matching
    const parts = locationKey.split(' ');
    if (parts.length < 2) return null;
    const locationName = parts.slice(1).join(' '); // Get everything after the first part (club name)
    const court = courts.find((c) => c.location === locationName);
    if (!court) return null;

    const locationId = court.locationId;

    if (court.club === 'alpha') {
      const ALPHA_LOCATION_IDS: Record<string, number> = {
        '1': 1,
        '2': 2,
        '3': 3,
      };
      const id = ALPHA_LOCATION_IDS[locationId];
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

    if (court.club === 'nbc') {
      const NBC_LOCATION_IDS: Record<string, number> = {
        '1': 1,
        '2': 2,
        '4': 4,
        '5': 5,
        '6': 6,
        '7': 7,
      };
      const id = NBC_LOCATION_IDS[locationId];
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

    if (court.club === 'pro1') {
      return 'https://booking.pro1badminton.com.au/secure/customer/booking/v1/public/show?readOnly=false&popupMsgDisabled=false&hideTopSiteBar=false';
    }

    if (court.club === 'roketto') {
      return 'https://roketto.sportlogic.net.au/secure/customer/booking/v1/public/show?readOnly=false&popupMsgDisabled=false&hideTopSiteBar=false';
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

  const visibleHours = useMemo(
    () => ALL_TIME_HOURS.filter((hour) => hour >= startHour && hour <= endHour),
    [startHour, endHour]
  );

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

  const getDateStr = (offset: number): string => {
    const date = getDateFromOffset(offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  const formatDayMonth = (date: Date): string => {
    return date.toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
    });
  };

  // Get 7 days starting from today
  const weekDays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const date = getDateFromOffset(i);
        return {
          offset: i,
          date,
          title: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : date.toLocaleDateString('en-AU', { weekday: 'short' }),
          subtitle: formatDayMonth(date),
        };
      }),
    []
  );

  const toggleDateSelection = (offset: number) => {
    onDateChange(getDateStr(offset));
  };

  const filteredCourts = useMemo(() => {
    return courts.filter((court) => {
      if (selectedSuburbs.length > 0 && !selectedSuburbs.includes(court.suburb)) {
        return false;
      }

      const slotStartHour = parseTimeSlotStartHour(court.timeSlot);
      if (slotStartHour === null) {
        return false;
      }

      if (slotStartHour < startHour || slotStartHour > endHour) {
        return false;
      }

      if (priceCap !== null && court.price > priceCap) {
        return false;
      }

      return true;
    });
  }, [courts, selectedSuburbs, startHour, endHour, priceCap]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);

    if (selectedSuburbs.length === 0) {
      params.delete('suburbs');
    } else {
      params.set('suburbs', selectedSuburbs.join(','));
    }

    if (startHour === DEFAULT_START_HOUR) {
      params.delete('from');
    } else {
      params.set('from', String(startHour));
    }

    if (endHour === DEFAULT_END_HOUR) {
      params.delete('to');
    } else {
      params.set('to', String(endHour));
    }

    if (hideEmptyLocations) {
      params.delete('hideEmpty');
    } else {
      params.set('hideEmpty', '0');
    }

    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', nextUrl);
  }, [selectedSuburbs, startHour, endHour, hideEmptyLocations]);

  // Group courts by location and time slot (data is already filtered for the selected date)
  const courtsByLocationAndTime = useMemo(() => {
    const grouped: { [key: string]: { [time: string]: AggregatedCourt[] } } = {};
    
    filteredCourts.forEach((court) => {
      const clubLabel =
        court.club === 'alpha'
          ? 'Alpha'
          : court.club === 'nbc'
            ? 'NBC'
            : court.club === 'pro1'
              ? 'Pro1'
              : 'Roketto';
      const locationKey = `${clubLabel} ${court.location}`;
      if (!grouped[locationKey]) {
        grouped[locationKey] = {};
      }
      if (!grouped[locationKey][court.timeSlot]) {
        grouped[locationKey][court.timeSlot] = [];
      }
      grouped[locationKey][court.timeSlot].push(court);
    });
    
    return grouped;
  }, [filteredCourts]);

  // Map locationKey -> address for display in the location column
  const locationAddresses = useMemo(() => {
    const map: { [key: string]: string } = {};
    filteredCourts.forEach((court) => {
      const clubLabel =
        court.club === 'alpha' ? 'Alpha'
        : court.club === 'nbc' ? 'NBC'
        : court.club === 'pro1' ? 'Pro1'
        : 'Roketto';
      const locationKey = `${clubLabel} ${court.location}`;
      if (!map[locationKey] && court.address) {
        map[locationKey] = court.address;
      }
    });
    return map;
  }, [filteredCourts]);

  const hasAnyAvailabilityInVisibleRange = (location: string): boolean => {
    return visibleHours.some((hour) => getCountForTimeSlot(location, hour) > 0);
  };

  // Get all unique locations
  const allLocations = useMemo(() => {
    const locations = Object.keys(courtsByLocationAndTime).sort();
    if (!hideEmptyLocations) {
      return locations;
    }
    return locations.filter((location) => hasAnyAvailabilityInVisibleRange(location));
  }, [courtsByLocationAndTime, hideEmptyLocations, visibleHours]);

  function getCountForTimeSlot(location: string, hour: number): number {
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
  }

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
    if (count === 1) return 'one-available';
    if (count <= 4) return 'low-available';
    if (count <= 8) return 'medium-available';
    if (count <= 16) return 'high-available';
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

  const formatHourCompact = (hour: number): string => {
    if (hour === 12) return '12 PM';
    if (hour > 12) return `${hour - 12} PM`;
    return `${hour} AM`;
  };

  const resetFilters = () => {
    setSelectedSuburbs([]);
    setStartHour(DEFAULT_START_HOUR);
    setEndHour(DEFAULT_END_HOUR);
    setHideEmptyLocations(true);
    setPriceCap(null);
  };

  const hasActiveFilters =
    selectedSuburbs.length > 0 ||
    startHour !== DEFAULT_START_HOUR ||
    endHour !== DEFAULT_END_HOUR ||
    priceCap !== null ||
    !hideEmptyLocations;

  const isTonightActive = startHour === 18 && endHour === 22;
  const isTomorrowMorningActive = startHour === 10 && endHour === 12;
  const isAnytimeActive = startHour === DEFAULT_START_HOUR && endHour === DEFAULT_END_HOUR;

  const suburbToggleLabel = selectedSuburbs.length === 0
    ? 'All suburbs'
    : selectedSuburbs.length === 1
      ? selectedSuburbs[0]
      : `${selectedSuburbs.length} suburbs`;

  const priceToggleLabel = priceCap === null ? 'Any price' : `Under $${priceCap}`;
  const timeToggleLabel = isAnytimeActive
    ? 'Anytime'
    : `${formatHourCompact(startHour)} - ${formatHourCompact(endHour)}`;

  const openSuburbPanel = () => {
    setIsSuburbPanelOpen((prev) => {
      const next = !prev;
      if (next) {
        setIsPricePanelOpen(false);
        setIsTimePanelOpen(false);
      }
      return next;
    });
  };

  const openPricePanel = () => {
    setIsPricePanelOpen((prev) => {
      const next = !prev;
      if (next) {
        setIsSuburbPanelOpen(false);
        setIsTimePanelOpen(false);
      }
      return next;
    });
  };

  const openTimePanel = () => {
    setIsTimePanelOpen((prev) => {
      const next = !prev;
      if (next) {
        setIsSuburbPanelOpen(false);
        setIsPricePanelOpen(false);
      }
      return next;
    });
  };

  return (
    <div className="weekly-table-container">
      <section className="filter-section" aria-label="Filters section">
        <div className="filter-section-inner">

          {/* Top row: filter toggles + view mode */}
          <div className="filter-top-row">
            <div className="filter-primary-controls" role="group" aria-label="Primary filters">
              <button
                type="button"
                className={`property-toggle ${selectedSuburbs.length > 0 ? 'active' : ''}`}
                onClick={openSuburbPanel}
                aria-expanded={isSuburbPanelOpen}
                aria-controls="suburb-toggle-panel"
              >
                <MapPin className="property-icon" aria-hidden="true" />
                {suburbToggleLabel}
                <ChevronDown className="property-chevron" aria-hidden="true" />
              </button>

              <button
                type="button"
                className={`property-toggle ${priceCap !== null || isPricePanelOpen ? 'active' : ''}`}
                onClick={openPricePanel}
                aria-expanded={isPricePanelOpen}
                aria-controls="price-toggle-panel"
              >
                <DollarSign className="property-icon" aria-hidden="true" />
                {priceToggleLabel}
                <ChevronDown className="property-chevron" aria-hidden="true" />
              </button>

              <button
                type="button"
                className={`property-toggle ${isTimePanelOpen ? 'active' : ''}`}
                onClick={openTimePanel}
                aria-expanded={isTimePanelOpen}
                aria-controls="time-toggle-panel"
              >
                <SlidersHorizontal className="property-icon" aria-hidden="true" />
                {timeToggleLabel}
                <ChevronDown className="property-chevron" aria-hidden="true" />
              </button>
            </div>

            <div className="view-toggle" role="group" aria-label="View mode">
              <button
                type="button"
                className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
                onClick={() => setViewMode('grid')}
              >
                <LayoutGrid className="view-icon" aria-hidden="true" />
                Grid
              </button>
              <button
                type="button"
                className={`view-toggle-btn ${viewMode === 'map' ? 'active' : ''}`}
                onClick={() => setViewMode('map')}
              >
                <MapIcon className="view-icon" aria-hidden="true" />
                Map
              </button>
            </div>
          </div>

          {/* Dropdown panels — rendered directly below top row */}
          {isSuburbPanelOpen && (
            <div id="suburb-toggle-panel" className="table-filters" role="group" aria-label="Suburb filters">
              <div className="filter-field filter-toggle-field">
                <span>Suburbs</span>
                <div className="suburb-toggle-sections" role="group" aria-label="Suburb filters">
                  {allSuburbsInCourts.map((suburb) => (
                    <button
                      key={suburb}
                      type="button"
                      className={`toggle-btn ${selectedSuburbs.includes(suburb) ? 'active' : ''}`}
                      onClick={() => toggleSuburb(suburb)}
                    >
                      {suburb}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" className="filters-reset-btn" onClick={resetFilters}>
                Reset filters
              </button>
            </div>
          )}

          {isPricePanelOpen && (
            <div id="price-toggle-panel" className="table-filters" role="group" aria-label="Price filters">
              <div className="filter-field filter-toggle-field">
                <span>Price range</span>
                <div className="suburb-toggle-sections" role="group" aria-label="Price options">
                  <button
                    type="button"
                    className={`toggle-btn ${priceCap === null ? 'active' : ''}`}
                    onClick={() => setPriceCap(null)}
                  >
                    Any price
                  </button>
                  <button
                    type="button"
                    className={`toggle-btn ${priceCap === 30 ? 'active' : ''}`}
                    onClick={() => setPriceCap(30)}
                  >
                    Under $30
                  </button>
                  <button
                    type="button"
                    className={`toggle-btn ${priceCap === 40 ? 'active' : ''}`}
                    onClick={() => setPriceCap(40)}
                  >
                    Under $40
                  </button>
                </div>
              </div>
              <button type="button" className="filters-reset-btn" onClick={resetFilters}>
                Reset filters
              </button>
            </div>
          )}

          {isTimePanelOpen && (
            <div id="time-toggle-panel" className="table-filters" role="group" aria-label="Time filters">
              <label className="filter-field filter-field-small">
                <span>From</span>
                <select
                  value={startHour}
                  onChange={(event) => {
                    const nextStart = Number(event.target.value);
                    setStartHour(nextStart);
                    if (nextStart > endHour) setEndHour(nextStart);
                  }}
                >
                  {ALL_TIME_HOURS.map((hour) => (
                    <option key={`start-${hour}`} value={hour}>{formatHourDisplay(hour)}</option>
                  ))}
                </select>
              </label>
              <label className="filter-field filter-field-small">
                <span>To</span>
                <select
                  value={endHour}
                  onChange={(event) => {
                    const nextEnd = Number(event.target.value);
                    setEndHour(nextEnd);
                    if (nextEnd < startHour) setStartHour(nextEnd);
                  }}
                >
                  {ALL_TIME_HOURS.map((hour) => (
                    <option key={`end-${hour}`} value={hour}>{formatHourDisplay(hour)}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="filters-reset-btn" onClick={resetFilters}>
                Reset filters
              </button>
            </div>
          )}

        </div>
      </section>

      {/* Day Selector */}
      <div className="day-selector">
        {weekDays.map((day) => (
          <button
            key={day.offset}
            className={`day-chip ${getDateStr(day.offset) === selectedDate ? 'selected' : ''}`}
            onClick={() => toggleDateSelection(day.offset)}
          >
            <span className="day-chip-title">{day.title}</span>
            <span className="day-chip-date">{day.subtitle}</span>
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

      {/* Availability Legend */}
      <div className="availability-legend">
        <span className="legend-label">Availability:</span>
        <div className="legend-items">
          <div className="legend-item">
            <div className="legend-swatch none-available"></div>
            <span>None</span>
          </div>
          <div className="legend-item">
            <div className="legend-swatch one-available"></div>
            <span>1 slot</span>
          </div>
          <div className="legend-item">
            <div className="legend-swatch low-available"></div>
            <span>2–4</span>
          </div>
          <div className="legend-item">
            <div className="legend-swatch medium-available"></div>
            <span>5–8</span>
          </div>
          <div className="legend-item">
            <div className="legend-swatch high-available"></div>
            <span>9–16</span>
          </div>
          <div className="legend-item">
            <div className="legend-swatch very-high-available"></div>
            <span>17+</span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="weekly-table-wrapper">
        <table className="weekly-court-table">
          <thead>
            <tr>
              <th className="location-column">VENUE</th>
              {visibleHours.map((hour) => (
                <th key={hour} className={`time-header ${shouldHighlightCurrentHour && hour === currentHour ? 'current-hour' : ''}`}>
                  {shouldHighlightCurrentHour && hour === currentHour ? (
                    <span className="time-header-now-wrap">
                      <span className="time-header-now">NOW</span>
                      <span className="time-header-hour">{formatHourCompact(hour)}</span>
                    </span>
                  ) : (
                    <span className="time-header-hour">{formatHourCompact(hour)}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={visibleHours.length + 1} className="table-loading-row">
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
                    {locationAddresses[location] && (
                      <span 
                        className="location-address"
                        onClick={() => setMapsModalInfo({ location, address: locationAddresses[location] })}
                      >
                        {locationAddresses[location]}
                      </span>
                    )}
                  </td>
                  {visibleHours.map((hour) => {
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
                        <div className="availability-card">
                          {count > 0 && <span className="availability-number">{count}</span>}
                          {count > 0 && price !== null && price > 0 && (
                            <span className="availability-price">${price}</span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={visibleHours.length + 1} className="empty-row">
                  <div className="empty-row-content">
                    <p>
                      {hasActiveFilters
                        ? 'No courts match your current filters.'
                        : 'No courts available for the selected date.'}
                    </p>
                    <div className="empty-row-actions">
                      {hasActiveFilters ? (
                        <button type="button" className="empty-row-btn" onClick={resetFilters}>
                          Clear filters
                        </button>
                      ) : (
                        <button type="button" className="empty-row-btn" onClick={onRefresh}>
                          Refresh data
                        </button>
                      )}
                    </div>
                  </div>
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

      {mapsModalInfo && (
        <div className="booking-modal-overlay" onClick={() => setMapsModalInfo(null)}>
          <div className="booking-modal" onClick={(event) => event.stopPropagation()}>
            <h3>Open Location in Google Maps?</h3>
            <p>
              Open <strong>{mapsModalInfo.location}</strong> in Google Maps?
            </p>
            <p className="modal-address-text">{mapsModalInfo.address}</p>
            <div className="booking-modal-actions">
              <button className="modal-btn modal-btn-cancel" onClick={() => setMapsModalInfo(null)}>
                Cancel
              </button>
              <button 
                className="modal-btn modal-btn-confirm" 
                onClick={() => {
                  window.open(
                    `https://www.google.com/maps/search/${encodeURIComponent(mapsModalInfo.address)}`,
                    '_blank'
                  );
                  setMapsModalInfo(null);
                }}
              >
                Open Maps
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
};
