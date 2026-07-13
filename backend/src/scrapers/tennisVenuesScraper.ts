import { load } from 'cheerio';
import type { Court, CourtData, TimeSlot } from '../types.js';

const SOUTHEND_LOCATION = {
  id: 'tennisvenues-southend',
  name: 'Southend Tennis Centre',
  address: '22 Chiswick St, Strathfield South NSW 2136',
  suburb: 'Strathfield South',
};

const BASE_URL = 'https://www.tennisvenues.com.au';
const CLIENT_ID = 'southend-tc';
const VENUE_ID = '1';

function formatDateYYYYMMDD(date: { day: number; month: number; year: number }): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

function formatDateCompact(date: { day: number; month: number; year: number }): string {
  return `${date.year}${String(date.month).padStart(2, '0')}${String(date.day).padStart(2, '0')}`;
}

function toDisplayTime(totalMinutes: number): string {
  const hour24 = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const period = hour24 >= 12 ? 'pm' : 'am';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, '0')}${period}`;
}

function formatHalfHourSlot(startMinutes: number): string {
  return `${toDisplayTime(startMinutes)}–${toDisplayTime(startMinutes + 30)}`;
}

function parseTParamToMinutes(raw: string): number | null {
  const match = raw.match(/^(\d{2})(\d{2})$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

async function fetchBookingHtml(date: { day: number; month: number; year: number }): Promise<string> {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    venue_id: VENUE_ID,
    resource_id: '',
    date: formatDateCompact(date),
    view: 'v3',
    _: Date.now().toString(),
  });

  const response = await fetch(`${BASE_URL}/booking/${CLIENT_ID}/fetch-booking-data?${params.toString()}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`Southend booking request failed with HTTP ${response.status}`);
  }

  return response.text();
}

function parsePickleballCourts(html: string): Court[] {
  const $ = load(html);
  const courts: Court[] = [];

  $('#v3_courts .v3-court-btn').each((_, button) => {
    const courtName = $(button).text().trim().replace(/\s+/g, ' ');
    if (!/pickleball/i.test(courtName)) {
      return;
    }

    const onclick = $(button).attr('onclick') ?? '';
    const idMatch = onclick.match(/v3SelectCourt\('([^']+)'\)/);
    const courtId = idMatch?.[1];
    if (!courtId) {
      return;
    }

    const slotContainer = $(`#v3_slots_${courtId}`);
    const emitted = new Set<string>();
    const availability: TimeSlot[] = [];

    slotContainer.find('a.v3-slot-btn[href*="/booking/request"]').each((_, link) => {
      const href = $(link).attr('href') ?? '';
      const timeMatch = href.match(/[?&]t=(\d{4})/);
      const startMinutes = timeMatch ? parseTParamToMinutes(timeMatch[1]) : null;
      if (startMinutes === null) {
        return;
      }

      const timeSlot = formatHalfHourSlot(startMinutes);
      if (emitted.has(timeSlot)) {
        return;
      }
      emitted.add(timeSlot);

      availability.push({
        timeSlot,
        status: 'available',
        price: 11.5,
      });
    });

    courts.push({
      courtId,
      courtName,
      availability,
    });
  });

  return courts;
}

export async function scrapeTennisVenues(date?: { day: number; month: number; year: number }): Promise<CourtData> {
  const fallback = new Date();
  const d = date ?? {
    day: fallback.getDate(),
    month: fallback.getMonth() + 1,
    year: fallback.getFullYear(),
  };

  try {
    const html = await fetchBookingHtml(d);
    const courts = parsePickleballCourts(html);
    const availableSlots = courts.reduce((sum, court) => sum + court.availability.length, 0);
    console.log(`Tennis Venues (Southend): ${courts.length} courts, ${availableSlots} available sessions on ${formatDateYYYYMMDD(d)}`);

    return {
      club: 'tennisvenues',
      date: formatDateYYYYMMDD(d),
      locations: [
        {
          locationId: SOUTHEND_LOCATION.id,
          locationName: SOUTHEND_LOCATION.name,
          address: SOUTHEND_LOCATION.address,
          suburb: SOUTHEND_LOCATION.suburb,
          courts,
        },
      ],
      scrapedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Error scraping Southend Tennis Centre:', error);

    return {
      club: 'tennisvenues',
      date: formatDateYYYYMMDD(d),
      locations: [],
      scrapedAt: new Date().toISOString(),
    };
  }
}