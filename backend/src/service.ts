import { scrapeAlphaBadminton } from './scrapers/alphaScraper.js';
import { scrapeNBCBadminton } from './scrapers/nbcScraper.js';
import { scrapePro1Badminton } from './scrapers/pro1Scraper.js';
import { scrapeRokettoBadminton } from './scrapers/rokettoScraper.js';
import type { AggregatedCourt, CourtData } from './types.js';
import { getRandomMockData } from './mockData.js';

type ClubKey = 'alpha' | 'nbc' | 'pro1' | 'roketto';

const sourceCache = new Map<string, { data: AggregatedCourt[]; timestamp: number }>();
const inflightSourceRequests = new Map<string, Promise<AggregatedCourt[]>>();
const inflightRequests = new Map<string, Promise<AggregatedCourt[]>>();

const USE_MOCK_DATA = process.env.MOCK_DATA === 'true';

const CLUBS: ClubKey[] = ['alpha', 'nbc', 'pro1', 'roketto'];

function getSydneyTodayParts(): { day: number; month: number; year: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Sydney',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);

  if (!year || !month || !day) {
    const fallback = new Date();
    return { day: fallback.getDate(), month: fallback.getMonth() + 1, year: fallback.getFullYear() };
  }

  return { day, month, year };
}

function getCacheKey(date: { day: number; month: number; year: number }): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

function getDateMaxAgeMs(date: { day: number; month: number; year: number }, maxAgeMs: number): number {
  const today = getSydneyTodayParts();
  const todayDate = new Date(today.year, today.month - 1, today.day);
  const targetDate = new Date(date.year, date.month - 1, date.day);
  const dayDiff = Math.floor((targetDate.getTime() - todayDate.getTime()) / (24 * 60 * 60 * 1000));
  const isToday = date.year === today.year && date.month === today.month && date.day === today.day;
  const isTomorrow = dayDiff === 1;
  return isToday || isTomorrow ? maxAgeMs : 30 * 60 * 1000;
}

async function fetchClubData(club: ClubKey, date: { day: number; month: number; year: number }): Promise<CourtData | null> {
  if (club === 'alpha') {
    return scrapeAlphaBadminton(date).catch((e) => {
      console.error('Alpha scrape failed:', e);
      return null;
    }) as Promise<CourtData | null>;
  }

  if (club === 'nbc') {
    return scrapeNBCBadminton(date).catch((e) => {
      console.error('NBC scrape failed:', e);
      return null;
    }) as Promise<CourtData | null>;
  }

  if (club === 'pro1') {
    return scrapePro1Badminton(date).catch((e) => {
      console.error('Pro1 scrape failed:', e);
      return null;
    });
  }

  return scrapeRokettoBadminton(date).catch((e) => {
    console.error('Roketto scrape failed:', e);
    return null;
  });
}

function getClubCacheKey(club: ClubKey, date: { day: number; month: number; year: number }): string {
  return `${club}:${getCacheKey(date)}`;
}

async function getClubDataWithCache(
  club: ClubKey,
  date: { day: number; month: number; year: number },
  maxAgeMs: number
): Promise<AggregatedCourt[]> {
  const now = Date.now();
  const sourceKey = getClubCacheKey(club, date);
  const cached = sourceCache.get(sourceKey);

  if (cached && now - cached.timestamp < maxAgeMs) {
    return cached.data;
  }

  const inflight = inflightSourceRequests.get(sourceKey);
  if (inflight) {
    return inflight;
  }

  const request = fetchClubData(club, date)
    .then((rawData) => {
      if (!rawData) {
        if (cached) {
          console.warn(`Using stale ${club} cache for ${getCacheKey(date)} after scrape failure`);
          return cached.data;
        }
        return [];
      }

      const normalized = normalizeData(rawData);
      if (normalized.length > 0) {
        sourceCache.set(sourceKey, { data: normalized, timestamp: Date.now() });
        return normalized;
      }

      if (cached) {
        console.warn(`Using stale ${club} cache for ${getCacheKey(date)} after empty scrape response`);
        return cached.data;
      }

      return [];
    })
    .finally(() => {
      inflightSourceRequests.delete(sourceKey);
    });

  inflightSourceRequests.set(sourceKey, request);
  return request;
}

export async function fetchAllCourtData(
  date?: { day: number; month: number; year: number },
  maxAgeMs: number = 5 * 60 * 1000,
  suburbs?: string[]
): Promise<AggregatedCourt[]> {
  if (USE_MOCK_DATA) {
    console.log('Using mock data...');
    return getRandomMockData();
  }

  const today = getSydneyTodayParts();
  const d = date ?? today;
  const effectiveMaxAgeMs = getDateMaxAgeMs(d, maxAgeMs);

  console.log('Fetching court data from all clubs...');

  const clubRows = await Promise.all(
    CLUBS.map((club) => getClubDataWithCache(club, d, effectiveMaxAgeMs))
  );

  const allRows = clubRows.flat();

  if (suburbs && suburbs.length > 0) {
    const suburbSet = new Set(suburbs.map((s) => s.toLowerCase()));
    return allRows.filter((row) => suburbSet.has(row.suburb.toLowerCase()));
  }

  return allRows;
}

function normalizeData(data: CourtData): AggregatedCourt[] {
  const result: AggregatedCourt[] = [];

  for (const location of data.locations) {
    for (const court of location.courts) {
      for (const slot of court.availability) {
        result.push({
          club: data.club,
          location: location.locationName,
          locationId: location.locationId,
          address: location.address,
          suburb: location.suburb,
          courtName: court.courtName,
          courtId: court.courtId,
          timeSlot: slot.timeSlot,
          status: slot.status,
          price: slot.price,
          date: data.date,
        });
      }
    }
  }

  return result;
}

export function getCourtDataWithCache(date?: { day: number; month: number; year: number }, maxAgeMs: number = 5 * 60 * 1000, suburbs?: string[]): Promise<AggregatedCourt[]> {
  const today = getSydneyTodayParts();
  const d = date ?? today;
  const cacheKey = getCacheKey(d);

  const inflight = inflightRequests.get(cacheKey);
  if (inflight) {
    console.log(`Joining in-flight fetch for ${cacheKey}`);
    return inflight.then((data) => {
      if (suburbs && suburbs.length > 0) {
        const suburbSet = new Set(suburbs.map((s) => s.toLowerCase()));
        return data.filter((row) => suburbSet.has(row.suburb.toLowerCase()));
      }
      return data;
    });
  }

  const request = fetchAllCourtData(d, maxAgeMs, suburbs)
    .finally(() => {
      inflightRequests.delete(cacheKey);
    });

  inflightRequests.set(cacheKey, request);
  return request;
}

export function clearCache(): void {
  sourceCache.clear();
  inflightSourceRequests.clear();
  inflightRequests.clear();
}
