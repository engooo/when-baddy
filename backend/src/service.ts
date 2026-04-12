import { scrapeAlphaBadminton } from './scrapers/alphaScraper.js';
import { scrapeNBCBadminton } from './scrapers/nbcScraper.js';
import type { AggregatedCourt, CourtData } from './types.js';
import { getRandomMockData } from './mockData.js';

const courtCache = new Map<string, { data: AggregatedCourt[]; timestamp: number }>();
const inflightRequests = new Map<string, Promise<AggregatedCourt[]>>();

const USE_MOCK_DATA = process.env.MOCK_DATA === 'true';

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

export async function fetchAllCourtData(date?: { day: number; month: number; year: number }): Promise<AggregatedCourt[]> {
  if (USE_MOCK_DATA) {
    console.log('Using mock data...');
    return getRandomMockData();
  }

  console.log('Fetching court data from both clubs...');

  const [alphaData, nbcData] = await Promise.all([
    scrapeAlphaBadminton(date).catch((e) => {
      console.error('Alpha scrape failed:', e);
      return null;
    }),
    scrapeNBCBadminton(date).catch((e) => {
      console.error('NBC scrape failed:', e);
      return null;
    }),
  ]);

  const aggregated: AggregatedCourt[] = [];

  if (alphaData) {
    aggregated.push(...normalizeData(alphaData as CourtData));
  }

  if (nbcData) {
    aggregated.push(...normalizeData(nbcData as CourtData));
  }

  return aggregated;
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

export function getCourtDataWithCache(date?: { day: number; month: number; year: number }, maxAgeMs: number = 5 * 60 * 1000): Promise<AggregatedCourt[]> {
  const now = Date.now();
  const today = getSydneyTodayParts();
  const d = date ?? today;
  const cacheKey = `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

  const todayDate = new Date(today.year, today.month - 1, today.day);
  const targetDate = new Date(d.year, d.month - 1, d.day);
  const dayDiff = Math.floor((targetDate.getTime() - todayDate.getTime()) / (24 * 60 * 60 * 1000));

  const isToday =
    d.year === today.year &&
    d.month === today.month &&
    d.day === today.day;
  const isTomorrow = dayDiff === 1;
  const effectiveMaxAgeMs = isToday || isTomorrow ? maxAgeMs : 30 * 60 * 1000;

  const cached = courtCache.get(cacheKey);
  if (cached && now - cached.timestamp < effectiveMaxAgeMs) {
    console.log(`Returning cached court data for ${cacheKey}`);
    return Promise.resolve(cached.data);
  }

  const inflight = inflightRequests.get(cacheKey);
  if (inflight) {
    console.log(`Joining in-flight fetch for ${cacheKey}`);
    return inflight;
  }

  const request = fetchAllCourtData(d)
    .then((data) => {
      // Do not cache empty responses; these are often transient scrape failures.
      if (data.length > 0) {
        courtCache.set(cacheKey, { data, timestamp: Date.now() });
      }
      return data;
    })
    .finally(() => {
      inflightRequests.delete(cacheKey);
    });

  inflightRequests.set(cacheKey, request);
  return request;
}

export function clearCache(): void {
  courtCache.clear();
}
