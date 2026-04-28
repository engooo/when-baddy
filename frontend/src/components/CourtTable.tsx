import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MapPin,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Moon,
  Sunrise,
  Zap,
} from 'lucide-react';
import type { SportMode } from '../types';
import {
  getBucketWindowFromHour,
  parseTimeSlotRangeMinutes,
  rangesOverlap,
} from '../utils/timeBuckets';
import '../styles/CourtTable.css';

interface AggregatedCourt {
  club: 'alpha' | 'nbc' | 'pro1' | 'roketto' | 'picklepoint' | 'mindbody';
  location: string;
  locationId: string;
  address: string;
  suburb: string;
  courtName: string;
  courtId: string;
  courtType?: 'casual' | 'show';
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
  sportMode: SportMode;
  onSportModeChange: (mode: SportMode) => void;
}

const DEFAULT_START_HOUR = 10;
const DEFAULT_END_HOUR = 22;
const GRID_TIME_COLUMNS = Array.from({ length: 13 }, (_, i) => 10 + i);
const PICKLEBALL_TIME_COLUMNS = Array.from({ length: 25 }, (_, i) => 10 + i * 0.5);

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

  // Range format, e.g. "4:30pm–5:00pm"
  let match = normalized.match(/^(\d{1,2}):(\d{2})(am|pm)\s*[–-]\s*(\d{1,2}):(\d{2})(am|pm)$/);
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const period = match[3];
    if (period === 'pm' && hour !== 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;
    return hour + (minute >= 30 ? 0.5 : 0);
  }

  // Single time format, e.g. "4:30pm"
  match = normalized.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const period = match[3];
    if (period === 'pm' && hour !== 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;
    return hour + (minute >= 30 ? 0.5 : 0);
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

function formatISODate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function diffCalendarDays(start: Date, end: Date): number {
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endUtc - startUtc) / 86_400_000);
}

function parseISODate(raw: string): Date | null {
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function parseLocationKey(locationKey: string): {
  venueKey: string;
  venueName: string;
  locationName: string;
  logoSrc: string | null;
  badgeText: string;
  badgeClass: string;
} {
  if (locationKey.startsWith('Alpha ')) {
    return {
      venueKey: 'alpha',
      venueName: 'Alpha Badminton',
      locationName: locationKey,
      logoSrc: '/assets/venue-logos/alpha_logo.png',
      badgeText: 'A',
      badgeClass: 'venue-logo-alpha',
    };
  }

  if (locationKey.startsWith('NBC ')) {
    return {
      venueKey: 'nbc',
      venueName: 'NBC',
      locationName: locationKey,
      logoSrc: '/assets/venue-logos/nbc_logo.png',
      badgeText: 'N',
      badgeClass: 'venue-logo-nbc',
    };
  }

  if (locationKey.startsWith('Pro1 ')) {
    return {
      venueKey: 'pro1',
      venueName: 'Pro1 Badminton',
      locationName: locationKey,
      logoSrc: '/assets/venue-logos/pro1_logo.png',
      badgeText: 'P',
      badgeClass: 'venue-logo-pro1',
    };
  }

  if (locationKey.startsWith('Roketto ')) {
    return {
      venueKey: 'roketto',
      venueName: 'Roketto',
      locationName: locationKey,
      logoSrc: '/assets/venue-logos/roketto_logo.png',
      badgeText: 'R',
      badgeClass: 'venue-logo-roketto',
    };
  }

  if (locationKey.startsWith('Picklepoint ')) {
    return {
      venueKey: 'picklepoint',
      venueName: 'Pickle Point',
      locationName: 'Pickle Point',
      logoSrc: '/assets/venue-logos/picklepoint_logo.png',
      badgeText: 'PP',
      badgeClass: 'venue-logo-picklepoint',
    };
  }

  if (locationKey.startsWith('Mindbody ')) {
    return {
      venueKey: 'mindbody',
      venueName: 'Ryde Multisport & Racquet Centre',
      locationName: locationKey.replace(/^Mindbody\s+/, ''),
      logoSrc: '/assets/venue-logos/ryde_logo.png',
      badgeText: 'MB',
      badgeClass: 'venue-logo-mindbody',
    };
  }

  return {
    venueKey: 'default',
    venueName: 'Venue',
    locationName: locationKey,
    logoSrc: null,
    badgeText: 'B',
    badgeClass: 'venue-logo-default',
  };
}

export const CourtTable: React.FC<WeeklyCourtTableProps> = ({
  courts,
  selectedDate,
  onDateChange,
  loading,
  onRefresh,
  sportMode,
  onSportModeChange,
}) => {
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
  const [pendingHour, setPendingHour] = useState<number | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [pendingPrice, setPendingPrice] = useState<number | null>(null);
  const [pendingSource, setPendingSource] = useState<'table' | 'matrix'>('table');
  const [timeTick, setTimeTick] = useState<number>(Date.now());
  const [selectedSuburbs, setSelectedSuburbs] = useState<string[]>(initialFilters.selectedSuburbs);
  const [startHour, setStartHour] = useState<number>(initialFilters.fromHour);
  const [endHour, setEndHour] = useState<number>(initialFilters.toHour);
  const [hideEmptyLocations, setHideEmptyLocations] = useState<boolean>(initialFilters.hideEmpty);
  const [isFiltersModalOpen, setIsFiltersModalOpen] = useState<boolean>(false);
  const [mapsModalInfo, setMapsModalInfo] = useState<{ location: string; address: string } | null>(null);
  const [expandedLocations, setExpandedLocations] = useState<string[]>([]);
  const [failedVenueLogos, setFailedVenueLogos] = useState<Record<string, boolean>>({});
  const [isCalendarOpen, setIsCalendarOpen] = useState<boolean>(false);
  const [lastUpdateTime, setLastUpdateTime] = useState<Date>(new Date());
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => {
    const initialDate = parseISODate(selectedDate) ?? getSydneyTodayDate();
    return new Date(initialDate.getFullYear(), initialDate.getMonth(), 1);
  });
  const calendarPopoverRef = useRef<HTMLDivElement | null>(null);

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

    if (court.club === 'picklepoint') {
      return 'https://clubspark.net/Picklepoint/Booking/BookByDate';
    }

    if (court.club === 'mindbody') {
      return 'https://go.mindbodyonline.com/book/widgets/appointments/view/7b9803fef1/services';
    }

    return null;
  };

  const handleCellClick = (
    bookingUrl: string | null,
    location: string,
    hour?: number,
    count?: number,
    price?: number | null,
    source: 'table' | 'matrix' = 'table'
  ) => {
    if (!bookingUrl) return;
    setPendingBookingUrl(bookingUrl);
    setPendingLocation(location);
    setPendingHour(hour ?? null);
    setPendingCount(count ?? 0);
    setPendingPrice(price ?? null);
    setPendingSource(source);
  };

  const closeBookingModal = () => {
    setPendingBookingUrl(null);
    setPendingLocation('');
    setPendingHour(null);
    setPendingCount(0);
    setPendingPrice(null);
    setPendingSource('table');
  };

  const confirmBooking = () => {
    if (!pendingBookingUrl) return;
    window.open(pendingBookingUrl, '_blank', 'noopener,noreferrer');
    closeBookingModal();
  };

  const activeTimeColumns = sportMode === 'map' ? PICKLEBALL_TIME_COLUMNS : GRID_TIME_COLUMNS;

  const visibleHours = useMemo(
    () => activeTimeColumns.filter((hour) => hour >= startHour && hour <= endHour),
    [activeTimeColumns, startHour, endHour]
  );

  useEffect(() => {
    if (sportMode !== 'grid') return;

    // Keep badminton on whole-hour filters when switching back from pickleball mode.
    setStartHour((prev) => Math.floor(prev));
    setEndHour((prev) => Math.ceil(prev));
  }, [sportMode]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setTimeTick(Date.now());
    }, 30_000);

    return () => window.clearInterval(intervalId);
  }, []);

  const getSydneyCurrentTimeColumn = (): number => {
    const parts = new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Sydney',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(timeTick));

    const hourPart = parts.find((p) => p.type === 'hour')?.value;
    const minutePart = parts.find((p) => p.type === 'minute')?.value;
    const hour = hourPart ? Number(hourPart) : NaN;
    const minute = minutePart ? Number(minutePart) : NaN;

    const fallbackDate = new Date(timeTick);
    const resolvedHour = Number.isFinite(hour) ? hour : fallbackDate.getHours();
    const resolvedMinute = Number.isFinite(minute) ? minute : fallbackDate.getMinutes();

    if (sportMode === 'map') {
      return resolvedHour + (resolvedMinute >= 30 ? 0.5 : 0);
    }

    return resolvedHour;
  };

  const currentTimeColumn = getSydneyCurrentTimeColumn();
  const sydneyToday = getSydneyTodayDate();
  const sydneyTodayStr = `${sydneyToday.getFullYear()}-${String(sydneyToday.getMonth() + 1).padStart(2, '0')}-${String(sydneyToday.getDate()).padStart(2, '0')}`;
  const shouldHighlightCurrentHour = selectedDate === sydneyTodayStr;
  const selectedDateValue = parseISODate(selectedDate) ?? sydneyToday;
  const daysFromToday = Math.max(0, diffCalendarDays(sydneyToday, selectedDateValue));
  const displayedWeekOffset = Math.floor(daysFromToday / 7);
  const displayedWeekStart = new Date(sydneyToday);
  displayedWeekStart.setDate(displayedWeekStart.getDate() + (displayedWeekOffset * 7));
  displayedWeekStart.setHours(0, 0, 0, 0);
  const canShiftToPreviousWeek = displayedWeekOffset > 0;

  const getDateFromOffset = (offset: number): Date => {
    const date = new Date(displayedWeekStart);
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
        const dateStr = formatISODate(date);
        return {
          offset: i,
          date,
          dateStr,
          title: dateStr === sydneyTodayStr ? 'Today' : date.toLocaleDateString('en-AU', { weekday: 'short' }),
          subtitle: formatDayMonth(date),
        };
      }),
    [displayedWeekStart, sydneyTodayStr]
  );

  const toggleDateSelection = (dateStr: string) => {
    onDateChange(dateStr);
  };

  const shiftSelectedDate = (deltaDays: number) => {
    const baseDate = parseISODate(selectedDate) ?? getSydneyTodayDate();
    const nextDate = new Date(baseDate);
    nextDate.setDate(nextDate.getDate() + deltaDays);
    onDateChange(formatISODate(nextDate));
  };

  const handleCalendarDateChange = (date: Date) => {
    if (date < sydneyToday) return;
    onDateChange(formatISODate(date));
    setIsCalendarOpen(false);
  };

  const shiftCalendarMonth = (delta: number) => {
    setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  useEffect(() => {
    const selected = parseISODate(selectedDate);
    if (!selected) return;
    setCalendarMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
  }, [selectedDate]);

  useEffect(() => {
    if (!isCalendarOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!calendarPopoverRef.current) return;
      if (!calendarPopoverRef.current.contains(event.target as Node)) {
        setIsCalendarOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsCalendarOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isCalendarOpen]);

  useEffect(() => {
    if (!isFiltersModalOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFiltersModalOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isFiltersModalOpen]);

  const calendarCells = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const startWeekday = firstOfMonth.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    const selected = parseISODate(selectedDate);

    return Array.from({ length: 42 }, (_, index) => {
      const offset = index - startWeekday;
      let cellDate: Date;
      let isCurrentMonth = true;

      if (offset < 0) {
        cellDate = new Date(year, month - 1, daysInPrevMonth + offset + 1);
        isCurrentMonth = false;
      } else if (offset >= daysInMonth) {
        cellDate = new Date(year, month + 1, offset - daysInMonth + 1);
        isCurrentMonth = false;
      } else {
        cellDate = new Date(year, month, offset + 1);
      }

      cellDate.setHours(0, 0, 0, 0);
      const isPast = cellDate < sydneyToday;
      const isSelected = selected !== null && formatISODate(cellDate) === formatISODate(selected);
      const isToday = formatISODate(cellDate) === sydneyTodayStr;

      return {
        date: cellDate,
        dayNumber: cellDate.getDate(),
        isCurrentMonth,
        isPast,
        isSelected,
        isToday,
      };
    });
  }, [calendarMonth, selectedDate, sydneyToday, sydneyTodayStr]);

  const calendarMonthLabel = useMemo(
    () =>
      calendarMonth.toLocaleDateString('en-AU', {
        month: 'long',
        year: 'numeric',
      }),
    [calendarMonth]
  );

  const filteredCourts = useMemo(() => {
    return courts.filter((court) => {
      // Sport mode filter
      const isPickleballClub = court.club === 'picklepoint' || court.club === 'mindbody';
      if (sportMode === 'grid' && isPickleballClub) return false;
      if (sportMode === 'map' && !isPickleballClub) return false;

      if (selectedSuburbs.length > 0 && !selectedSuburbs.includes(court.suburb)) {
        return false;
      }

      if (sportMode === 'map') {
        // For pickleball, slots are large windows (e.g. "6:00am–6:00pm").
        // Include the court if its window overlaps the visible [startHour, endHour] range.
        const range = parseTimeSlotRangeMinutes(court.timeSlot);
        if (!range) return false;
        const visibleStart = startHour * 60;
        const visibleEnd = endHour * 60 + 30; // +30 to include the last half-hour bucket
        return range.start < visibleEnd && range.end > visibleStart;
      }

      const slotStartHour = parseTimeSlotStartHour(court.timeSlot);
      if (slotStartHour === null) {
        return false;
      }

      if (slotStartHour < startHour || slotStartHour > endHour) {
        return false;
      }

      return true;
    });
  }, [courts, selectedSuburbs, startHour, endHour, sportMode]);

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
              : court.club === 'picklepoint'
                ? 'Picklepoint'
                : court.club === 'mindbody'
                  ? 'Mindbody'
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
        : court.club === 'picklepoint' ? 'Picklepoint'
        : court.club === 'mindbody' ? 'Mindbody'
        : 'Roketto';
      const locationKey = `${clubLabel} ${court.location}`;
      if (!map[locationKey] && court.address) {
        map[locationKey] = court.address;
      }
    });
    return map;
  }, [filteredCourts]);

  const courtMatrixByLocation = useMemo(() => {
    const grouped: Record<string, Record<string, AggregatedCourt[]>> = {};

    filteredCourts.forEach((court) => {
      const clubLabel =
        court.club === 'alpha' ? 'Alpha'
        : court.club === 'nbc' ? 'NBC'
        : court.club === 'pro1' ? 'Pro1'
        : court.club === 'picklepoint' ? 'Picklepoint'
        : court.club === 'mindbody' ? 'Mindbody'
        : 'Roketto';
      const locationKey = `${clubLabel} ${court.location}`;

      if (!grouped[locationKey]) {
        grouped[locationKey] = {};
      }

      if (!grouped[locationKey][court.courtName]) {
        grouped[locationKey][court.courtName] = [];
      }

      grouped[locationKey][court.courtName].push(court);
    });

    const matrixByLocation: Record<string, {
      courts: string[];
      courtTypes: Record<string, 'casual' | 'show' | undefined>;
      timeRows: Array<{
        hour: number;
        cells: Array<{ available: boolean; price: number | null }>;
      }>;
    }> = {};

    const bucketMinutes = sportMode === 'map' ? 30 : 60;

    for (const [locationKey, courtMap] of Object.entries(grouped)) {
      const courts = Object.keys(courtMap)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

      // Build a mapping of court name to court type
      const courtTypes: Record<string, 'casual' | 'show' | undefined> = {};
      for (const courtName of courts) {
        const courtEntries = courtMap[courtName] ?? [];
        if (courtEntries.length > 0) {
          courtTypes[courtName] = courtEntries[0].courtType;
        }
      }

      const timeRows = visibleHours.map((hour) => {
        const bucket = getBucketWindowFromHour(hour, bucketMinutes);

        const cells = courts.map((courtName) => {
          const courtEntries = courtMap[courtName] ?? [];
          let available = false;
          let minPrice: number | null = null;

          for (const entry of courtEntries) {
            const range = parseTimeSlotRangeMinutes(entry.timeSlot);
            const overlaps = range
              ? rangesOverlap(range, bucket)
              : parseTimeSlotStartHour(entry.timeSlot) === hour;

            if (!overlaps) continue;

            available = true;
            if (entry.price > 0 && (minPrice === null || entry.price < minPrice)) {
              minPrice = entry.price;
            }
          }

          return { available, price: minPrice };
        });

        return { hour, cells };
      });

      matrixByLocation[locationKey] = {
        courts,
        courtTypes,
        timeRows,
      };
    }

    return matrixByLocation;
  }, [filteredCourts, visibleHours, sportMode]);

  const pickleballBucketStats = useMemo(() => {
    const stats: Record<string, Record<string, { count: number; minPrice: number | null }>> = {};
    if (sportMode !== 'map') return stats;

    for (const [location, timeSlots] of Object.entries(courtsByLocationAndTime)) {
      const byBucket: Record<string, { count: number; minPrice: number | null }> = {};

      for (const hour of visibleHours) {
        const bucket = getBucketWindowFromHour(hour, 30);
        const uniqueCourtIds = new Set<string>();
        const priceByCourtId = new Map<string, number>();

        for (const timeSlot in timeSlots) {
          const sourceRange = parseTimeSlotRangeMinutes(timeSlot);
          if (!sourceRange || !rangesOverlap(sourceRange, bucket)) continue;

          const overlappingCourts = timeSlots[timeSlot];
          for (const court of overlappingCourts) {
            uniqueCourtIds.add(court.courtId);

            const currentMin = priceByCourtId.get(court.courtId);
            if (currentMin === undefined || court.price < currentMin) {
              priceByCourtId.set(court.courtId, court.price);
            }
          }
        }

        const normalizedPrices = Array.from(priceByCourtId.values());

        byBucket[String(hour)] = {
          count: uniqueCourtIds.size,
          minPrice: normalizedPrices.length > 0 ? Math.round(Math.min(...normalizedPrices) * 100) / 100 : null,
        };
      }

      stats[location] = byBucket;
    }

    return stats;
  }, [sportMode, courtsByLocationAndTime, visibleHours]);

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
  }, [courtsByLocationAndTime, hideEmptyLocations, visibleHours, pickleballBucketStats]);

  useEffect(() => {
    setExpandedLocations((prev) => prev.filter((location) => allLocations.includes(location)));
  }, [allLocations]);

  const toggleLocationExpand = (location: string) => {
    setExpandedLocations((prev) => (
      prev.includes(location)
        ? prev.filter((item) => item !== location)
        : [...prev, location]
    ));
  };

  function getCountForTimeSlot(location: string, hour: number): number {
    if (sportMode === 'map') {
      return pickleballBucketStats[location]?.[String(hour)]?.count ?? 0;
    }

    const timeSlots = courtsByLocationAndTime[location] || {};

    const targetWholeHour = Math.floor(hour);
    const targetMinute = hour % 1 >= 0.5 ? 30 : 0;

    for (const timeSlot in timeSlots) {
      let match = timeSlot.match(/(\d+):(\d+)(am|pm)–(\d+):(\d+)(am|pm)/);
      if (match) {
        let startHour = parseInt(match[1]);
        const startMinute = parseInt(match[2]);
        const startPeriod = match[3];
        if (startPeriod === 'pm' && startHour !== 12) startHour += 12;
        if (startPeriod === 'am' && startHour === 12) startHour = 0;
        if (startHour === targetWholeHour && startMinute === targetMinute) {
          return timeSlots[timeSlot].length;
        }
      } else {
        match = timeSlot.match(/(\d+):(\d+)(am|pm)/);
        if (match) {
          let timeHour = parseInt(match[1]);
          const timeMinute = parseInt(match[2]);
          const timePeriod = match[3];
          if (timePeriod === 'pm' && timeHour !== 12) timeHour += 12;
          if (timePeriod === 'am' && timeHour === 12) timeHour = 0;
          if (timeHour === targetWholeHour && timeMinute === targetMinute) {
            return timeSlots[timeSlot].length;
          }
        }
      }
    }
    return 0;
  }

  const getPriceForTimeSlot = (location: string, hour: number): number | null => {
    if (sportMode === 'map') {
      return pickleballBucketStats[location]?.[String(hour)]?.minPrice ?? null;
    }

    const timeSlots = courtsByLocationAndTime[location] || {};

    const targetWholeHour = Math.floor(hour);
    const targetMinute = hour % 1 >= 0.5 ? 30 : 0;
    for (const timeSlot in timeSlots) {
      let match = timeSlot.match(/(\d+):(\d+)(am|pm)–(\d+):(\d+)(am|pm)/);
      if (match) {
        let startHour = parseInt(match[1]);
        const startMinute = parseInt(match[2]);
        const startPeriod = match[3];
        if (startPeriod === 'pm' && startHour !== 12) startHour += 12;
        if (startPeriod === 'am' && startHour === 12) startHour = 0;
        if (startHour === targetWholeHour && startMinute === targetMinute && timeSlots[timeSlot].length > 0) {
          return timeSlots[timeSlot][0].price;
        }
      } else {
        match = timeSlot.match(/(\d+):(\d+)(am|pm)/);
        if (match) {
          let timeHour = parseInt(match[1]);
          const timeMinute = parseInt(match[2]);
          const timePeriod = match[3];
          if (timePeriod === 'pm' && timeHour !== 12) timeHour += 12;
          if (timePeriod === 'am' && timeHour === 12) timeHour = 0;
          if (timeHour === targetWholeHour && timeMinute === targetMinute && timeSlots[timeSlot].length > 0) {
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
    if (count <= 9) return 'medium-available';
    return 'high-available';
  };

  const formatHourDisplay = (hour: number): string => {
    const wholeHour = Math.floor(hour);
    const mins = hour % 1 >= 0.5 ? '30' : '00';
    if (wholeHour < 12) {
      return `${wholeHour}:${mins} AM`;
    } else if (wholeHour === 12) {
      return `12:${mins} PM`;
    } else {
      return `${wholeHour - 12}:${mins} PM`;
    }
  };

  const formatHourCompact = (hour: number): string => {
    const wholeHour = Math.floor(hour);
    const mins = hour % 1 >= 0.5 ? ':30' : '';
    if (wholeHour === 12) return `12${mins} PM`;
    if (wholeHour > 12) return `${wholeHour - 12}${mins} PM`;
    return `${wholeHour}${mins} AM`;
  };

  const resetFilters = () => {
    setSelectedSuburbs([]);
    setStartHour(DEFAULT_START_HOUR);
    setEndHour(DEFAULT_END_HOUR);
    setHideEmptyLocations(true);
  };

  const hasActiveFilters =
    selectedSuburbs.length > 0 ||
    startHour !== DEFAULT_START_HOUR ||
    endHour !== DEFAULT_END_HOUR ||
    !hideEmptyLocations;

  const isMorningActive = startHour === 10 && endHour === 12;
  const isAfternoonActive = startHour === 12 && endHour === 17;
  const isNightActive = startHour === 18 && endHour === 22;

  return (
    <div className={`weekly-table-container ${sportMode === 'map' ? 'pickleball-theme' : ''}`}>
      {isFiltersModalOpen && (
        <>
          <div className="filters-modal-backdrop" onClick={() => setIsFiltersModalOpen(false)} />
          <div className="filters-modal-shell" role="dialog" aria-modal="true" aria-label="Filters">
            <section className="filter-section filter-section-modal" aria-label="Filters section">
              <div className="filter-section-inner">
                <div className="filters-modal-header">
                  <h3>Filters</h3>
                  <button
                    type="button"
                    className="filters-modal-close"
                    onClick={() => setIsFiltersModalOpen(false)}
                    aria-label="Close filters"
                  >
                    ×
                  </button>
                </div>

                <div className="table-filters filters-modal-content" role="group" aria-label="Filters">
                  <div className="filter-field filter-toggle-field">
                    <span>Suburbs</span>
                    <div className="suburb-pill-list" role="group" aria-label="Suburb filters">
                      {allSuburbsInCourts.map((suburb) => {
                        const isActive = selectedSuburbs.includes(suburb);
                        return (
                          <button
                            key={suburb}
                            type="button"
                            className={`suburb-pill-btn ${isActive ? 'active' : ''}`}
                            onClick={() => toggleSuburb(suburb)}
                            aria-pressed={isActive}
                          >
                            {suburb}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="time-controls-row">
                    <div className="filter-field filter-time-quick-field">
                      <span>Quick time</span>
                      <div className="quick-filters-row" role="group" aria-label="Quick time filters">
                        <button
                          type="button"
                          className={`quick-filter-chip ${isMorningActive ? 'active' : ''}`}
                          onClick={() => {
                            setStartHour(10);
                            setEndHour(12);
                          }}
                        >
                          <Sunrise className="quick-filter-icon" aria-hidden="true" />
                          Morning
                        </button>
                        <button
                          type="button"
                          className={`quick-filter-chip ${isAfternoonActive ? 'active' : ''}`}
                          onClick={() => {
                            setStartHour(12);
                            setEndHour(17);
                          }}
                        >
                          <Zap className="quick-filter-icon" aria-hidden="true" />
                          Afternoon
                        </button>
                        <button
                          type="button"
                          className={`quick-filter-chip ${isNightActive ? 'active' : ''}`}
                          onClick={() => {
                            setStartHour(18);
                            setEndHour(22);
                          }}
                        >
                          <Moon className="quick-filter-icon" aria-hidden="true" />
                          Night
                        </button>
                      </div>
                    </div>

                    <div className="time-select-row" role="group" aria-label="Time range">
                      <label className="filter-field filter-field-small stylized-time-field">
                        <span>From</span>
                        <select
                          value={startHour}
                          onChange={(event) => {
                            const nextStart = Number(event.target.value);
                            setStartHour(nextStart);
                            if (nextStart > endHour) setEndHour(nextStart);
                          }}
                        >
                          {activeTimeColumns.map((hour) => (
                            <option key={`start-${hour}`} value={hour}>{formatHourDisplay(hour)}</option>
                          ))}
                        </select>
                      </label>

                      <label className="filter-field filter-field-small stylized-time-field">
                        <span>To</span>
                        <select
                          value={endHour}
                          onChange={(event) => {
                            const nextEnd = Number(event.target.value);
                            setEndHour(nextEnd);
                            if (nextEnd < startHour) setStartHour(nextEnd);
                          }}
                        >
                          {activeTimeColumns.map((hour) => (
                            <option key={`end-${hour}`} value={hour}>{formatHourDisplay(hour)}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>

                  <div className="filters-modal-actions">
                    <button type="button" className="filters-reset-btn" onClick={resetFilters}>
                      Reset
                    </button>
                    <button
                      type="button"
                      className="filters-apply-btn"
                      onClick={() => setIsFiltersModalOpen(false)}
                    >
                      Done
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </>
      )}

      <section className="filter-section" aria-label="Sport toggle section">
        <div className="filter-section-inner">

          <div className="sport-toggle-row">
            <div className="view-toggle" role="group" aria-label="View mode">
              <button
                type="button"
                className={`view-toggle-btn ${sportMode === 'grid' ? 'active' : ''}`}
                onClick={() => onSportModeChange('grid')}
              >
                <svg className="view-icon" viewBox="0 0 122.88 122.76" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" clipRule="evenodd" d="M10.99,81.78l30.24,30.24l-5.69,5.69c-17.18,14.97-47.9-5.82-30.24-30.24L10.99,81.78L10.99,81.78z M22.02,74.87l7.22,7.22l42.75-54.35c0.04-0.07,0.09-0.13,0.14-0.19l0.07-0.08c0.41-0.56,0.83-1.08,1.27-1.56 c3.81-5.19,3.87-10.62,1.87-14.93c-0.96-2.07-2.39-3.88-4.1-5.29c-1.7-1.4-3.68-2.39-5.75-2.82c-4.21-0.88-8.85,0.59-12.36,5.7 L22.02,74.87L22.02,74.87z M31.19,84.04l7.65,7.65l54.59-43.25c0.05-0.04,0.1-0.07,0.15-0.1c4.81-5.55,5.04-11.53,2.85-16.21 c-0.97-2.08-2.42-3.9-4.16-5.33c-1.72-1.41-3.72-2.41-5.81-2.86c-3.68-0.78-7.67,0.2-10.95,3.8c-0.36,0.48-0.75,0.95-1.16,1.43 c-0.13,0.18-0.26,0.36-0.38,0.54c-0.08,0.11-0.17,0.2-0.27,0.28L31.19,84.04L31.19,84.04z M40.8,93.65l7.35,7.35l66.2-30.33 c5.17-3.55,6.59-8.36,5.63-12.76c-0.47-2.15-1.51-4.22-2.95-6c-1.45-1.79-3.31-3.28-5.41-4.29c-4.75-2.27-10.82-2.02-16.39,3.02 l-0.01,0c-0.05,0.04-0.09,0.08-0.14,0.11l-0.01,0l-0.02,0.01l-0.01,0.01l-0.02,0.01l-0.01,0l-0.02,0.01l-0.01,0.01l-0.01,0.01 l-0.02,0.01l-0.01,0l-0.02,0.01l-0.01,0l-0.02,0.01l-0.01,0l-0.02,0.01l-0.01,0c-0.03,0.01-0.05,0.02-0.08,0.03L40.8,93.65 L40.8,93.65z M48.62,103.76l-4.11,5.07L13.99,78.32l5.65-4.78L50.69,7.34c0.03-0.09,0.07-0.18,0.13-0.26 c0.04-0.07,0.08-0.13,0.12-0.18c4.13-5.98,9.71-7.66,14.84-6.59c2.53,0.53,4.94,1.73,7,3.42c2.05,1.68,3.77,3.86,4.91,6.33 c1.68,3.61,2.16,7.86,0.75,12.16c2.71-1.21,5.58-1.41,8.33-0.83c2.54,0.54,4.97,1.75,7.05,3.46c2.07,1.69,3.79,3.88,4.96,6.36 c1.9,4.06,2.3,8.91,0.2,13.73c4.75-2.03,9.53-1.59,13.56,0.33c2.51,1.2,4.72,2.98,6.44,5.1c1.73,2.13,2.97,4.61,3.54,7.21 c1.15,5.23-0.41,10.88-6.19,15.04c-0.11,0.13-0.24,0.24-0.41,0.32l-0.13,0.06c-0.08,0.05-0.17,0.09-0.26,0.12L48.62,103.76 L48.62,103.76z"/>
                </svg>
                Badminton
              </button>
              <button
                type="button"
                className={`view-toggle-btn ${sportMode === 'map' ? 'active' : ''}`}
                onClick={() => onSportModeChange('map')}
              >
                <svg className="view-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {/* Pickleball — circle with hole pattern */}
                  <circle cx="12" cy="12" r="9" />
                  <circle cx="9" cy="9" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="15" cy="9" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="9" cy="15" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="15" cy="15" r="1.2" fill="currentColor" stroke="none" />
                  <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
                </svg>
                Pickleball
              </button>
            </div>
          </div>
        </div>
      </section>

      <div className="date-picker-row" ref={calendarPopoverRef}>
        <button
          type="button"
          className={`open-filters-btn ${hasActiveFilters ? 'active' : ''}`}
          onClick={() => setIsFiltersModalOpen(true)}
          aria-label="Open filters"
        >
          <SlidersHorizontal aria-hidden="true" />
          Filters
        </button>
        <button
          type="button"
          className="pick-date-btn"
          aria-label="Open calendar"
          aria-expanded={isCalendarOpen}
          onClick={() => setIsCalendarOpen((prev) => !prev)}
        >
          Pick Date
        </button>

        {isCalendarOpen && (
          <>
            <div className="calendar-modal-backdrop" onClick={() => setIsCalendarOpen(false)} />
            <div className="calendar-popover" role="dialog" aria-label="Choose date">
              <div className="calendar-popover-header">
                <button
                  type="button"
                  className="calendar-month-nav"
                  onClick={() => shiftCalendarMonth(-1)}
                  aria-label="Previous month"
                >
                  <ChevronLeft aria-hidden="true" />
                </button>
                <span className="calendar-month-label">{calendarMonthLabel}</span>
                <button
                  type="button"
                  className="calendar-month-nav"
                  onClick={() => shiftCalendarMonth(1)}
                  aria-label="Next month"
                >
                  <ChevronRight aria-hidden="true" />
                </button>
              </div>
              <div className="calendar-weekdays" aria-hidden="true">
                <span>Sun</span>
                <span>Mon</span>
                <span>Tue</span>
                <span>Wed</span>
                <span>Thu</span>
                <span>Fri</span>
                <span>Sat</span>
              </div>
              <div className="calendar-grid">
                {calendarCells.map((cell) => (
                  <button
                    key={formatISODate(cell.date)}
                    type="button"
                    className={[
                      'calendar-day-cell',
                      cell.isCurrentMonth ? '' : 'is-outside-month',
                      cell.isPast ? 'is-disabled' : '',
                      cell.isSelected ? 'is-selected' : '',
                      cell.isToday ? 'is-today' : '',
                    ].join(' ').trim()}
                    disabled={cell.isPast}
                    onClick={() => handleCalendarDateChange(cell.date)}
                    aria-label={cell.date.toLocaleDateString('en-AU', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  >
                    {cell.dayNumber}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Day Selector */}
      <div className="day-selector-wrapper">
        <button
          type="button"
          className="day-nav-btn"
          onClick={() => shiftSelectedDate(-7)}
          aria-label="Previous week"
          disabled={!canShiftToPreviousWeek}
        >
          <ChevronLeft aria-hidden="true" />
        </button>

        <div className="day-selector">
          {weekDays.map((day) => (
            <button
              key={day.dateStr}
              className={`day-chip ${day.dateStr === selectedDate ? 'selected' : ''}`}
              onClick={() => toggleDateSelection(day.dateStr)}
            >
              <span className="day-chip-title">{day.title}</span>
              <span className="day-chip-date">{day.subtitle}</span>
            </button>
          ))}
        </div>

        <div className="day-selector-right-nav">
          <button
            type="button"
            className="day-nav-btn"
            onClick={() => shiftSelectedDate(7)}
            aria-label="Next week"
          >
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </div>

      <>
          <div className="table-meta-row">
            <span className="last-updated">Last updated: {lastUpdateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <button
              className="table-refresh-btn"
              onClick={() => { onRefresh(); setLastUpdateTime(new Date()); }}
              disabled={loading}
              aria-label="Refresh available courts"
            >
              {loading ? '⟳ Refreshing...' : '↻ Refresh'}
            </button>
          </div>

          <div className="weekly-table-wrapper">
            <table className="weekly-court-table">
              <thead>
                <tr>
                  <th className="location-column">VENUE</th>
                  {visibleHours.map((hour) => {
                    const isHalfHour = hour % 1 !== 0;
                    const isCurrentHourBlock = shouldHighlightCurrentHour && hour === currentTimeColumn;

                    return (
                    <th
                      key={hour}
                      className={`time-header ${isCurrentHourBlock ? 'current-hour' : ''} ${isHalfHour ? 'is-half-hour' : ''}`}
                      aria-label={formatHourDisplay(hour)}
                    >
                      {isCurrentHourBlock && !isHalfHour ? (
                        <span className="time-header-now-wrap">
                          <span className="time-header-now">NOW</span>
                          <span className="time-header-hour">{formatHourCompact(hour)}</span>
                        </span>
                      ) : (
                        <span className={`time-header-hour ${isHalfHour ? 'time-header-hour-muted' : ''}`}>
                          {isHalfHour ? ':30' : formatHourCompact(hour)}
                        </span>
                      )}
                    </th>
                    );
                  })}
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
                  allLocations.map((location) => {
                    const venue = parseLocationKey(location);
                    const showVenueLogoImage = Boolean(venue.logoSrc) && !failedVenueLogos[venue.venueKey];
                    const countsByHour = visibleHours.map((hour) => getCountForTimeSlot(location, hour));
                    const isExpanded = expandedLocations.includes(location);
                    const detailId = `venue-details-${location.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
                    const venueMatrix = courtMatrixByLocation[location];
                    return (
                    <React.Fragment key={location}>
                      <tr>
                        <td className="location-cell">
                          <span className="location-content">
                            <span className={`venue-logo ${venue.badgeClass}`} aria-hidden="true">
                              {showVenueLogoImage ? (
                                <img
                                  className="venue-logo-image"
                                  src={venue.logoSrc ?? undefined}
                                  alt=""
                                  onError={() => {
                                    setFailedVenueLogos((prev) => {
                                      if (prev[venue.venueKey]) return prev;
                                      return { ...prev, [venue.venueKey]: true };
                                    });
                                  }}
                                />
                              ) : (
                                venue.badgeText
                              )}
                            </span>
                            <span className="location-details">
                              <span className="location-name">
                                <span className="location-name-text">{venue.locationName}</span>
                              </span>
                              {locationAddresses[location] && (
                                <span
                                  className="location-address"
                                  onClick={() => setMapsModalInfo({ location, address: locationAddresses[location] })}
                                >
                                  <MapPin size={12} className="location-icon" aria-hidden="true" />
                                  {locationAddresses[location]}
                                </span>
                              )}
                            </span>
                            <button
                              type="button"
                              className={`location-expand-btn ${isExpanded ? 'is-expanded' : ''}`}
                              aria-expanded={isExpanded}
                              aria-controls={detailId}
                              aria-label={isExpanded ? `Hide courts for ${venue.locationName}` : `Show courts for ${venue.locationName}`}
                              onClick={() => toggleLocationExpand(location)}
                            >
                              <ChevronRight size={18} />
                              <span className="sr-only">{isExpanded ? 'Hide courts' : 'Show courts'}</span>
                            </button>
                          </span>
                        </td>
                        {visibleHours.map((hour, index) => {
                          const count = countsByHour[index];
                          const availClass = getAvailabilityClass(location, hour);
                          const bookingUrl = count > 0 ? getBookingUrl(location) : null;
                          const price = getPriceForTimeSlot(location, hour);
                          const isPickleballCell = sportMode === 'map';
                          const prevCount = index > 0 ? countsByHour[index - 1] : 0;
                          const nextCount = index < countsByHour.length - 1 ? countsByHour[index + 1] : 0;
                          let runClass = '';

                          if (isPickleballCell && count > 0) {
                            const hasPrev = prevCount > 0;
                            const hasNext = nextCount > 0;
                            runClass = hasPrev && hasNext
                              ? 'run-middle'
                              : hasPrev
                                ? 'run-end'
                                : hasNext
                                  ? 'run-start'
                                  : 'run-single';
                          }

                          const showPrice = count > 0 && price !== null && price > 0;

                          const bookingHint =
                            isPickleballCell && bookingUrl
                              ? `Book from ${formatHourDisplay(hour)} to ${formatHourDisplay(hour + 0.5)}`
                              : null;

                          return (
                            <td
                              key={hour}
                              className={`availability-cell ${availClass} ${bookingUrl ? 'bookable' : ''} ${shouldHighlightCurrentHour && hour === currentTimeColumn ? 'current-hour' : ''} ${isPickleballCell ? 'connected-mode' : ''} ${runClass}`}
                              title={bookingUrl ? 'Click to open booking page for this day' : ''}
                              onClick={() => handleCellClick(bookingUrl, location, hour, count, price)}
                            >
                              <div className="availability-card">
                                {count > 0 && <span className="availability-number">{count}</span>}
                                {showPrice && (
                                  <span className="availability-price">${price}</span>
                                )}
                                {bookingHint && (
                                  <span className="availability-hover-hint">{bookingHint}</span>
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>

                      {isExpanded && (
                        <tr className="venue-details-row">
                          <td colSpan={visibleHours.length + 1} className="venue-details-cell">
                            <div id={detailId} className="venue-details-panel">
                              <div className="venue-details-title-section">
                                <div className="venue-details-title">Available Courts</div>
                              </div>
                              {venueMatrix && venueMatrix.courts.length > 0 ? (
                                <div className="venue-court-matrix-wrap">
                                  <table className="venue-court-matrix">
                                    <thead>
                                      <tr>
                                        <th className="venue-court-time-head">Time</th>
                                        {venueMatrix.courts.map((courtName) => (
                                          <th key={`${location}-${courtName}`} className="venue-court-column-head">
                                            <span className="court-name">
                                              {courtName}
                                            </span>
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {venueMatrix.timeRows.filter((timeRow) => timeRow.cells.some((c) => c.available)).map((timeRow) => (
                                        <tr key={`${location}-time-${timeRow.hour}`}>
                                          <th className="venue-court-time-cell">{formatHourCompact(timeRow.hour)}</th>
                                          {timeRow.cells.map((cell, courtIndex) => {
                                            const bookingUrl = cell.available ? getBookingUrl(location) : null;
                                            const courtName = venueMatrix.courts[courtIndex];
                                            const cellHint = cell.available ? `${courtName} · ${formatHourDisplay(timeRow.hour)}` : null;

                                            return (
                                              <td
                                                key={`${location}-${timeRow.hour}-${courtName}`}
                                                className={`venue-court-slot-cell ${cell.available ? 'available' : 'unavailable'} ${bookingUrl ? 'bookable' : ''}`}
                                                onClick={() => handleCellClick(bookingUrl, location, timeRow.hour, cell.available ? 1 : 0, cell.price, 'matrix')}
                                              >
                                                {cell.available ? (
                                                  <>
                                                    {cell.price !== null && <span className="venue-court-slot-price">${cell.price}</span>}
                                                    {cell.price === null && <span className="venue-court-slot-open">Open</span>}
                                                    {cellHint && <span className="venue-court-slot-hint">{cellHint}</span>}
                                                  </>
                                                ) : (
                                                  <span className="venue-court-slot-empty">-</span>
                                                )}
                                              </td>
                                            );
                                          })}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <p className="venue-details-empty">No available courts for current filters.</p>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
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

          {/* Availability Legend */}
          <div className="availability-legend">
            <span className="legend-label">Availability:</span>
            <div className="legend-items">
              <div className="legend-item">
                <div className="legend-swatch one-available"></div>
                <span>Last spot</span>
              </div>
              <div className="legend-item">
                <div className="legend-swatch low-available"></div>
                <span>Limited (2–4)</span>
              </div>
              <div className="legend-item">
                <div className="legend-swatch medium-available"></div>
                <span>Good (5–9)</span>
              </div>
              <div className="legend-item">
                <div className="legend-swatch high-available"></div>
                <span>Plenty (10+)</span>
              </div>
            </div>
          </div>
        </>

      {pendingBookingUrl && (() => {
        const locInfo = parseLocationKey(pendingLocation);
        const address = locationAddresses[pendingLocation];
        const todayStr = getSydneyTodayDate().toISOString().split('T')[0];
        const isToday = selectedDate === todayStr;
        const dayLabel = isToday ? 'Today' : new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long' });
        const dateLabel = new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
        const timeLabel = pendingHour !== null ? formatHourCompact(pendingHour) : '—';
        const availLabel =
          pendingSource === 'matrix' && pendingCount === 1
            ? 'AVAILABLE'
            : pendingCount === 1
              ? 'LAST SPOT'
              : pendingCount <= 4
                ? 'LIMITED'
                : pendingCount <= 9
                  ? 'GOOD'
                  : 'PLENTY AVAILABLE';
        const headerClass =
          pendingSource === 'matrix' && pendingCount === 1
            ? 'booking-modal-header-medium'
            : pendingCount === 1
            ? 'booking-modal-header-one'
            : pendingCount <= 4
              ? 'booking-modal-header-low'
              : pendingCount <= 9
                ? 'booking-modal-header-medium'
                : 'booking-modal-header-high';
        return (
          <div className="booking-modal-overlay" onClick={closeBookingModal}>
            <div className="booking-modal-v2" onClick={(event) => event.stopPropagation()}>
              <div className={`booking-modal-header ${headerClass}`}>
                <div className="booking-modal-header-top">
                  <span className="booking-modal-club-badge">{locInfo.venueName.split(' ')[0].toUpperCase()}</span>
                  <button className="booking-modal-close" onClick={closeBookingModal} aria-label="Close">
                    {availLabel} ×
                  </button>
                </div>
                <div className="booking-modal-count">
                  <span className="booking-modal-count-number">{pendingCount}</span>
                  <span className="booking-modal-count-label"> courts available</span>
                </div>
              </div>
              <div className="booking-modal-body">
                <h3 className="booking-modal-venue-name">{locInfo.locationName}</h3>
                {address && (
                  <p className="booking-modal-address">
                    <MapPin size={14} strokeWidth={2} />
                    {address}
                  </p>
                )}
                <div className="booking-modal-info-cards">
                  <div className="booking-modal-info-card">
                    <span className="info-card-label">DAY</span>
                    <span className="info-card-primary">{dayLabel}</span>
                    <span className="info-card-secondary">{dateLabel}</span>
                  </div>
                  <div className="booking-modal-info-card">
                    <span className="info-card-label">TIME</span>
                    <span className="info-card-primary">{timeLabel}</span>
                    <span className="info-card-secondary">{sportMode === 'map' ? '30 mins' : '1 hour'}</span>
                  </div>
                  <div className="booking-modal-info-card">
                    <span className="info-card-label">PRICE</span>
                    <span className="info-card-primary">{pendingPrice !== null ? `$${pendingPrice}` : '—'}</span>
                    <span className="info-card-secondary">{pendingPrice !== null ? (sportMode === 'map' ? 'per 30 mins' : 'per hour') : 'see site'}</span>
                  </div>
                </div>
                <div className="booking-modal-actions-v2">
                  <button className="modal-btn-browse" onClick={closeBookingModal}>
                    Keep browsing
                  </button>
                  <button className="modal-btn-book" onClick={confirmBooking}>
                    Book on {locInfo.venueName.split(' ')[0]} ↗
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

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
