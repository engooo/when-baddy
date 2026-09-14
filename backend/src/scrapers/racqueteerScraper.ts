import axios, { type AxiosInstance } from 'axios';
import { load } from 'cheerio';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import type { Court, CourtData, TimeSlot } from '../types.js';

const RACQUETEER_LOCATION = {
  id: 'racqueteer-lidcombe',
  name: 'Racqueteer',
  address: '10 Carter St, Lidcombe NSW 2141',
  suburb: 'Lidcombe',
};

const BASE_URL = 'https://racqueteer.playbypoint.com';
const FACILITY_ID = '1757';
const RACQUETEER_EMAIL = process.env.RACQUETEER_EMAIL;
const RACQUETEER_PASSWORD = process.env.RACQUETEER_PASSWORD;
const SESSION_CACHE_MS = 25 * 60 * 1000;
const PRICE_PER_HOUR = 50;
const SLOT_SECONDS = 3600;

const SURFACES = [
  { surface: 'indoor_pickleball', courtId: 'racqueteer-indoor', courtName: 'Indoor Pickleball' },
  { surface: 'outdoor_pickleball', courtId: 'racqueteer-outdoor', courtName: 'Outdoor Pickleball' },
] as const;

interface AvailableHour {
  facility_schedule_id: number;
  schedule: string;
  shift: string;
  available: boolean;
  seconds_from_midnight: number;
  in_waitlist: boolean;
  group: number;
}

interface AvailableHoursResponse {
  available_hours: AvailableHour[];
}

let authenticatedClientPromise: Promise<AxiosInstance> | null = null;
let authenticatedClientCreatedAt = 0;

function isSignInPage(html: string): boolean {
  return /id="new_user"|sso-password-input/i.test(html);
}

// Sydney has no fixed UTC offset (AEST/AEDT), so it must be resolved per-date.
function getSydneyMidnightEpochSeconds(date: { day: number; month: number; year: number }): number {
  const probe = new Date(Date.UTC(date.year, date.month - 1, date.day, 12, 0, 0));
  const offsetLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Sydney',
    timeZoneName: 'longOffset',
  })
    .formatToParts(probe)
    .find((p) => p.type === 'timeZoneName')?.value;

  const match = offsetLabel?.match(/GMT([+-]\d+)(?::(\d+))?/);
  const offsetHours = match ? Number(match[1]) : 10;
  const offsetMinutes = match?.[2] ? Number(match[2]) : 0;
  const offsetSeconds = offsetHours * 3600 + Math.sign(offsetHours || 1) * offsetMinutes * 60;

  return Math.floor(Date.UTC(date.year, date.month - 1, date.day, 0, 0, 0) / 1000) - offsetSeconds;
}

function formatDateYYYYMMDD(date: { day: number; month: number; year: number }): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

function toDisplayTime(totalMinutes: number): string {
  const hour24 = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const period = hour24 >= 12 ? 'pm' : 'am';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, '0')}${period}`;
}

function getAuthenticatedClient(): Promise<AxiosInstance> {
  if (!RACQUETEER_EMAIL || !RACQUETEER_PASSWORD) {
    throw new Error('Missing Racqueteer credentials. Set RACQUETEER_EMAIL and RACQUETEER_PASSWORD.');
  }

  if (authenticatedClientPromise && Date.now() - authenticatedClientCreatedAt < SESSION_CACHE_MS) {
    return authenticatedClientPromise;
  }

  authenticatedClientPromise = (async () => {
    try {
      const cookieJar = new CookieJar();
      const client: AxiosInstance = wrapper(
        axios.create({
          jar: cookieJar,
          withCredentials: true,
          validateStatus: () => true,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        })
      );

      const signInUrl = `${BASE_URL}/users/sign_in`;
      const signInPageResponse = await client.get<string>(signInUrl);
      if (signInPageResponse.status >= 400 || typeof signInPageResponse.data !== 'string') {
        throw new Error(`Racqueteer sign-in page request failed with HTTP ${signInPageResponse.status}`);
      }

      const $ = load(signInPageResponse.data);
      const form = $('form#new_user');
      const token = form.find('input[name="authenticity_token"]').attr('value');
      if (!token) {
        throw new Error('Racqueteer sign-in form authenticity token was not found.');
      }

      const loginPayload = new URLSearchParams({
        authenticity_token: token,
        'user[email]': RACQUETEER_EMAIL,
        'user[password]': RACQUETEER_PASSWORD,
        'user[remember_me]': '0',
      });

      const loginResponse = await client.post<string>(`${BASE_URL}/users/sign_in.html`, loginPayload.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: BASE_URL,
          Referer: signInUrl,
        },
      });

      if (loginResponse.status >= 400) {
        throw new Error(`Racqueteer login request failed with HTTP ${loginResponse.status}`);
      }

      if (typeof loginResponse.data === 'string' && isSignInPage(loginResponse.data)) {
        throw new Error('Racqueteer login did not establish an authenticated session (check credentials).');
      }

      authenticatedClientCreatedAt = Date.now();
      return client;
    } catch (error) {
      authenticatedClientPromise = null;
      throw error;
    }
  })();

  return authenticatedClientPromise;
}

async function fetchAvailableHours(
  client: AxiosInstance,
  timestamp: number,
  surface: string
): Promise<AvailableHoursResponse> {
  const url = `${BASE_URL}/api/facilities/${FACILITY_ID}/available_hours?timestamp=${timestamp}&surface=${surface}&kind=reservation&courts_for_pros=false`;
  const response = await client.get<AvailableHoursResponse>(url, {
    headers: { Accept: 'application/json', Referer: `${BASE_URL}/book/Racqueteer` },
  });

  if (response.status < 200 || response.status >= 300 || !response.data) {
    throw new Error(`Racqueteer available_hours request failed with HTTP ${response.status}`);
  }

  return response.data;
}

function mapToCourt(courtId: string, courtName: string, data: AvailableHoursResponse): Court {
  const availability: TimeSlot[] = (data.available_hours ?? [])
    .filter((hour) => hour.available && !hour.in_waitlist)
    .map((hour) => {
      const startMinutes = hour.seconds_from_midnight / 60;
      const endMinutes = startMinutes + SLOT_SECONDS / 60;
      return {
        timeSlot: `${toDisplayTime(startMinutes)}–${toDisplayTime(endMinutes)}`,
        status: 'available' as const,
        price: PRICE_PER_HOUR,
      };
    });

  return { courtId, courtName, availability };
}

export async function scrapeRacqueteer(date?: { day: number; month: number; year: number }): Promise<CourtData> {
  const d = date ?? {
    day: new Date().getDate(),
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
  };

  try {
    const client = await getAuthenticatedClient();
    const timestamp = getSydneyMidnightEpochSeconds(d);

    const courts = await Promise.all(
      SURFACES.map(async ({ surface, courtId, courtName }) => {
        const data = await fetchAvailableHours(client, timestamp, surface);
        return mapToCourt(courtId, courtName, data);
      })
    );

    const availableSlots = courts.reduce((sum, court) => sum + court.availability.length, 0);
    console.log(`Racqueteer: ${courts.length} court groups, ${availableSlots} available sessions on ${formatDateYYYYMMDD(d)}`);

    return {
      club: 'racqueteer',
      date: formatDateYYYYMMDD(d),
      locations: [
        {
          locationId: RACQUETEER_LOCATION.id,
          locationName: RACQUETEER_LOCATION.name,
          address: RACQUETEER_LOCATION.address,
          suburb: RACQUETEER_LOCATION.suburb,
          courts,
        },
      ],
      scrapedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Error scraping Racqueteer:', error);

    return {
      club: 'racqueteer',
      date: formatDateYYYYMMDD(d),
      locations: [],
      scrapedAt: new Date().toISOString(),
    };
  }
}
