import { scrapeAlphaBadminton } from './scrapers/alphaScraper.js';
import { scrapeNBCBadminton } from './scrapers/nbcScraper.js';
import { scrapePro1Badminton } from './scrapers/pro1Scraper.js';
import { scrapeRokettoBadminton } from './scrapers/rokettoScraper.js';
import { scrapePicklePoint } from './scrapers/picklepointScraper.js';
import { scrapeMindbody } from './scrapers/mindbodyScraper.js';
import type { AggregatedCourt, CourtData } from './types.js';
import { getRandomMockData } from './mockData.js';

type ClubKey = 'alpha' | 'nbc' | 'pro1' | 'roketto' | 'picklepoint' | 'mindbody';
type SportFilter = 'badminton' | 'pickleball';

const sourceCache = new Map<string, { data: AggregatedCourt[]; timestamp: number }>();
const inflightSourceRequests = new Map<string, Promise<AggregatedCourt[]>>();
const inflightRequests = new Map<string, Promise<AggregatedCourt[]>>();

const USE_MOCK_DATA = process.env.MOCK_DATA === 'true';

const CLUBS: ClubKey[] = ['alpha', 'nbc', 'pro1', 'roketto', 'picklepoint', 'mindbody'];

function inferSport(club: ClubKey, locationName: string): 'badminton' | 'pickleball' {
  if (club === 'picklepoint' || club === 'mindbody') {
    return 'pickleball';
  }

  if (club === 'nbc' && /pickleball/i.test(locationName)) {
    return 'pickleball';
  }

  return 'badminton';
}

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

  if (club === 'roketto') {
    return scrapeRokettoBadminton(date).catch((e) => {
      console.error('Roketto scrape failed:', e);
      return null;
    });
  }

  if (club === 'mindbody') {
    return scrapeMindbody(date).catch((e) => {
      console.error('Mindbody scrape failed:', e);
      return null;
    });
  }

  return scrapePicklePoint(date).catch((e) => {
    console.error('Picklepoint scrape failed:', e);
    return null;
  });
}

function getClubCacheKey(club: ClubKey, date: { day: number; month: number; year: number }): string {
  return `${club}:${getCacheKey(date)}`;
}

function getClubsForSport(sport?: SportFilter): ClubKey[] {
  if (sport === 'badminton') {
    return ['alpha', 'nbc', 'pro1', 'roketto'];
  }

  if (sport === 'pickleball') {
    return ['nbc', 'picklepoint', 'mindbody'];
  }

  return CLUBS;
}

function triggerBackgroundRefresh(
  club: ClubKey,
  date: { day: number; month: number; year: number },
  sourceKey: string
): void {
  if (inflightSourceRequests.has(sourceKey)) {
    return;
  }

  const request = fetchClubData(club, date)
    .then((rawData) => {
      if (!rawData) {
        return sourceCache.get(sourceKey)?.data ?? [];
      }

      const normalized = normalizeData(rawData);
      if (normalized.length > 0) {
        sourceCache.set(sourceKey, { data: normalized, timestamp: Date.now() });
        return normalized;
      }

      return sourceCache.get(sourceKey)?.data ?? [];
    })
    .catch((e) => {
      console.error(`[swr] Background refresh failed for ${club}/${getCacheKey(date)}:`, e);
      return sourceCache.get(sourceKey)?.data ?? [];
    })
    .finally(() => {
      inflightSourceRequests.delete(sourceKey);
    });

  inflightSourceRequests.set(sourceKey, request);
}

async function getClubDataWithCache(
  club: ClubKey,
  date: { day: number; month: number; year: number },
  maxAgeMs: number
): Promise<AggregatedCourt[]> {
  const now = Date.now();
  const sourceKey = getClubCacheKey(club, date);
  const cached = sourceCache.get(sourceKey);

  // Fresh cache — return immediately
  if (cached && now - cached.timestamp < maxAgeMs) {
    return cached.data;
  }

  // Stale cache — return immediately and refresh in background
  if (cached) {
    console.log(`[swr] Returning stale ${club} cache for ${getCacheKey(date)}, refreshing in background`);
    triggerBackgroundRefresh(club, date, sourceKey);
    return cached.data;
  }

  // No cache at all — must wait for first scrape
  const inflight = inflightSourceRequests.get(sourceKey);
  if (inflight) {
    return inflight;
  }

  const request = fetchClubData(club, date)
    .then((rawData) => {
      if (!rawData) {
        return [];
      }

      const normalized = normalizeData(rawData);
      if (normalized.length > 0) {
        sourceCache.set(sourceKey, { data: normalized, timestamp: Date.now() });
        return normalized;
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
  suburbs?: string[],
  sport?: SportFilter
): Promise<AggregatedCourt[]> {
  if (USE_MOCK_DATA) {
    console.log('Using mock data...');
    const mockRows = getRandomMockData();
    const sportScopedMockRows = sport ? mockRows.filter((row) => row.sport === sport) : mockRows;

    if (suburbs && suburbs.length > 0) {
      const suburbSet = new Set(suburbs.map((s) => s.toLowerCase()));
      return sportScopedMockRows.filter((row) => suburbSet.has(row.suburb.toLowerCase()));
    }

    return sportScopedMockRows;
  }

  const today = getSydneyTodayParts();
  const d = date ?? today;
  const effectiveMaxAgeMs = getDateMaxAgeMs(d, maxAgeMs);
  const clubsToFetch = getClubsForSport(sport);

  console.log('Fetching court data from all clubs...');

  const clubRows = await Promise.all(
    clubsToFetch.map((club) => getClubDataWithCache(club, d, effectiveMaxAgeMs))
  );

  const allRows = clubRows.flat();
  const sportScopedRows = sport ? allRows.filter((row) => row.sport === sport) : allRows;

  if (suburbs && suburbs.length > 0) {
    const suburbSet = new Set(suburbs.map((s) => s.toLowerCase()));
    return sportScopedRows.filter((row) => suburbSet.has(row.suburb.toLowerCase()));
  }

  return sportScopedRows;
}

function normalizeData(data: CourtData): AggregatedCourt[] {
  const result: AggregatedCourt[] = [];

  for (const location of data.locations) {
    for (const court of location.courts) {
      const availability = Array.isArray(court.availability) ? court.availability : [];

      if (!Array.isArray(court.availability)) {
        console.warn(
          `Skipping invalid availability for ${data.club}/${location.locationName}/${court.courtName}`,
          court.availability
        );
      }

      for (const slot of availability) {
        result.push({
          club: data.club,
          sport: inferSport(data.club, location.locationName),
          location: location.locationName,
          locationId: location.locationId,
          address: location.address,
          suburb: location.suburb,
          courtName: court.courtName,
          courtId: court.courtId,
          courtType: court.courtType,
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

export function getCourtDataWithCache(
  date?: { day: number; month: number; year: number },
  maxAgeMs: number = 5 * 60 * 1000,
  suburbs?: string[],
  sport?: SportFilter
): Promise<AggregatedCourt[]> {
  const today = getSydneyTodayParts();
  const d = date ?? today;
  const baseKey = getCacheKey(d);
  const scopeKey = `${baseKey}:${sport ?? 'all'}`;

  const inflight = inflightRequests.get(scopeKey);
  if (inflight) {
    console.log(`Joining in-flight fetch for ${scopeKey}`);
    return inflight.then((data) => {
      if (suburbs && suburbs.length > 0) {
        const suburbSet = new Set(suburbs.map((s) => s.toLowerCase()));
        return data.filter((row) => suburbSet.has(row.suburb.toLowerCase()));
      }
      return data;
    });
  }

  const request = fetchAllCourtData(d, maxAgeMs, undefined, sport)
    .then((data) => {
      if (suburbs && suburbs.length > 0) {
        const suburbSet = new Set(suburbs.map((s) => s.toLowerCase()));
        return data.filter((row) => suburbSet.has(row.suburb.toLowerCase()));
      }

      return data;
    })
    .finally(() => {
      inflightRequests.delete(scopeKey);
    });

  inflightRequests.set(scopeKey, request);
  return request;
}

export function clearCache(): void {
  sourceCache.clear();
  inflightSourceRequests.clear();
  inflightRequests.clear();
}
