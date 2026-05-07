import axios, { type AxiosInstance } from 'axios';
import { load } from 'cheerio';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import type { Court, CourtData, TimeSlot } from '../types.js';

const PICKLEPOINT_LOCATION = {
  id: 'picklepoint-milperra',
  name: 'Pickle Point',
  address: '101 Raleigh Rd, Milperra NSW 2214',
  suburb: 'Milperra',
};

// Resource groups
const CASUAL_COURTS_GROUP_ID = 'c4cd3f8c-b1ac-2463-fcd8-b9a1c62d2564';
const SHOW_COURTS_GROUP_ID = '6d473444-1704-4cb8-9136-1c448fafe778';

const BASE_URL = 'https://clubspark.net';
const VENUE_PATH = 'Picklepoint';
const BOOKING_PATH = `${VENUE_PATH.toLowerCase()}/Booking/BookByDate`;
const PICKLEPOINT_EMAIL = process.env.PICKLEPOINT_EMAIL;
const PICKLEPOINT_PASSWORD = process.env.PICKLEPOINT_PASSWORD;
const SESSION_CACHE_MS = 25 * 60 * 1000;

let authenticatedClientPromise: Promise<AxiosInstance> | null = null;
let authenticatedClientCreatedAt = 0;

interface PicklepointSession {
  ID: string;
  Category: number;
  Name: string;
  StartTime: number;
  EndTime: number;
  Capacity: number;
  Cost?: number;
  CostFrom?: number;
  CourtCost?: number;
}

interface PicklepointDay {
  Date: string;
  Sessions: PicklepointSession[];
}

interface PicklepointResource {
  ID: string;
  ResourceGroupID: string;
  Name: string;
  Days: PicklepointDay[];
}

type CourtType = 'casual' | 'show';

const RESOURCE_GROUP_MAP: Record<string, CourtType> = {
  'c4cd3f8c-b1ac-2463-fcd8-b9a1c62d2564': 'casual',
  '6d473444-1704-4cb8-9136-1c448fafe778': 'show',
};

interface PicklepointResponse {
  Resources: PicklepointResource[];
}

function isSignInPage(html: string): boolean {
  return /Account\/SignIn|name="EmailAddress"|name="Password"/i.test(html);
}

function getResponseUrl(response: { request?: { res?: { responseUrl?: string } } }): string | undefined {
  return response.request?.res?.responseUrl;
}

async function completeWsFedHandshake(
  client: AxiosInstance,
  html: string,
  currentUrl: string
): Promise<{ html: string; url: string }> {
  if (!/\/issue\/wsfed/i.test(currentUrl) && !/name="wresult"|name="wctx"/i.test(html)) {
    return { html, url: currentUrl };
  }

  const $ = load(html);
  const hiddenForm = $('form[name="hiddenform"][method="POST"], form[method="post"]').first();
  if (!hiddenForm.length) {
    throw new Error('Picklepoint WS-Fed handoff form not found after login.');
  }

  const handoffFields: Record<string, string> = {};
  hiddenForm.find('input[name]').each((_, elem) => {
    const name = $(elem).attr('name');
    if (!name) return;
    handoffFields[name] = $(elem).attr('value') ?? '';
  });

  const handoffAction = hiddenForm.attr('action')
    ? new URL(hiddenForm.attr('action')!, currentUrl).toString()
    : BASE_URL;

  const handoffPayload = new URLSearchParams(handoffFields);
  const handoffResponse = await client.post<string>(handoffAction, handoffPayload.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: BASE_URL,
      Referer: currentUrl,
    },
  });

  const finalHtml = typeof handoffResponse.data === 'string' ? handoffResponse.data : '';
  const finalUrl = getResponseUrl(handoffResponse) ?? handoffAction;
  return { html: finalHtml, url: finalUrl };
}

function getAuthenticatedClient(): Promise<AxiosInstance> {
  if (!PICKLEPOINT_EMAIL || !PICKLEPOINT_PASSWORD) {
    throw new Error('Missing Picklepoint credentials. Set PICKLEPOINT_EMAIL and PICKLEPOINT_PASSWORD.');
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

      const signInUrl = `${BASE_URL}/${VENUE_PATH}/Account/SignIn?returnUrl=${encodeURIComponent(`https://${new URL(BASE_URL).host}/${BOOKING_PATH}`)}`;
      const signInPageResponse = await client.get<string>(signInUrl);

      if (signInPageResponse.status >= 400 || typeof signInPageResponse.data !== 'string') {
        throw new Error(`Picklepoint sign-in page request failed with HTTP ${signInPageResponse.status}`);
      }

      const signInPageFinalUrl = getResponseUrl(signInPageResponse) ?? signInUrl;

      const $ = load(signInPageResponse.data);
      const form = $('form[action][method="post"]').has('input[name="EmailAddress"]').first();
      if (!form.length) {
        throw new Error('Picklepoint sign-in form was not found on the login page.');
      }

      const hiddenFields: Record<string, string> = {};
      form.find('input[type="hidden"][name]').each((_, elem) => {
        const name = $(elem).attr('name');
        if (!name) return;
        hiddenFields[name] = $(elem).attr('value') ?? '';
      });

      const formAction = form.attr('action')
        ? new URL(form.attr('action')!, signInPageFinalUrl).toString()
        : `${BASE_URL}/account/signin`;

      const loginPayload = new URLSearchParams({
        ...hiddenFields,
        EmailAddress: PICKLEPOINT_EMAIL,
        Password: PICKLEPOINT_PASSWORD,
        RememberMe: 'true',
      });

      const loginResponse = await client.post<string>(formAction, loginPayload.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: BASE_URL,
          Referer: signInUrl,
        },
      });

      if (loginResponse.status >= 400) {
        throw new Error(`Picklepoint login request failed with HTTP ${loginResponse.status}`);
      }

      const bookingPageResponse = await client.get<string>(`${BASE_URL}/${BOOKING_PATH}`);
      if (bookingPageResponse.status >= 400 || typeof bookingPageResponse.data !== 'string') {
        throw new Error('Picklepoint booking page request failed after login.');
      }

      const postHandshake = await completeWsFedHandshake(
        client,
        bookingPageResponse.data,
        getResponseUrl(bookingPageResponse) ?? `${BASE_URL}/${BOOKING_PATH}`
      );

      if (isSignInPage(postHandshake.html)) {
        throw new Error('Picklepoint login did not establish an authenticated booking session.');
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

function getSessionPrice(session: PicklepointSession): number {
  return session.Cost ?? session.CostFrom ?? session.CourtCost ?? 0;
}

function isAvailableSession(session: PicklepointSession): boolean {
  return session.Category === 0 && session.Capacity > 0 && session.EndTime > session.StartTime;
}

async function fetchVenueSessionsUnauthenticated(
  date: { day: number; month: number; year: number }
): Promise<PicklepointResponse | null> {
  const formattedDate = formatDateYYYYMMDD(date);
  const params = new URLSearchParams({
    resourceID: '',
    startDate: formattedDate,
    endDate: formattedDate,
    roleId: '',
    _: Date.now().toString(),
  });

  try {
    const cookieJar = new CookieJar();
    const client: AxiosInstance = wrapper(
      axios.create({
        jar: cookieJar,
        withCredentials: false,
        validateStatus: () => true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          Accept: 'application/json, text/plain, */*',
        },
      })
    );

    const endpoint = `${BASE_URL}/v0/VenueBooking/${VENUE_PATH}/GetVenueSessions?${params.toString()}`;

    const response = await client.get<PicklepointResponse>(endpoint, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        Referer: `${BASE_URL}/${BOOKING_PATH}`,
      },
    });

    if (response.status >= 200 && response.status < 300 && response.data) {
      return response.data;
    }
    return null;
  } catch (error) {
    return null;
  }
}

async function fetchVenueSessions(date: { day: number; month: number; year: number }): Promise<PicklepointResponse> {
  const formattedDate = formatDateYYYYMMDD(date);

  // First, try fetching without authentication
  console.log(`[Picklepoint] Attempting unauthenticated access for ${formattedDate}`);
  const unauthedData = await fetchVenueSessionsUnauthenticated(date);
  if (unauthedData) {
    console.log('[Picklepoint] ✓ Public access successful');
    return unauthedData;
  }

  console.log('[Picklepoint] ✗ Public access unavailable, attempting authenticated access...');

  // Check if credentials are available
  if (!PICKLEPOINT_EMAIL || !PICKLEPOINT_PASSWORD) {
    throw new Error(
      'Picklepoint requires sign-in but PICKLEPOINT_EMAIL and/or PICKLEPOINT_PASSWORD are not set. ' +
      'Provide credentials in environment variables.'
    );
  }

  // Fall back to authenticated session
  const params = new URLSearchParams({
    resourceID: '',
    startDate: formattedDate,
    endDate: formattedDate,
    roleId: '',
    _: Date.now().toString(),
  });

  const client = await getAuthenticatedClient();
  const endpoint = `${BASE_URL}/v0/VenueBooking/${VENUE_PATH}/GetVenueSessions?${params.toString()}`;

  const response = await client.get<PicklepointResponse>(endpoint, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      Referer: `${BASE_URL}/${BOOKING_PATH}`,
    },
  });

  if (response.status < 200 || response.status >= 300 || !response.data) {
    console.error(`[Picklepoint] Failed to fetch for ${formattedDate}: HTTP ${response.status}`);
    console.error(`[Picklepoint] URL: ${endpoint}`);
    throw new Error(`Picklepoint sessions request failed with HTTP ${response.status}`);
  }

  console.log('[Picklepoint] ✓ Authenticated access successful');
  return response.data;
}

function mapResourceToCourt(resource: PicklepointResource): Court {
  const availability: TimeSlot[] = (resource.Days[0]?.Sessions ?? [])
    .filter(isAvailableSession)
    .map((session) => ({
      timeSlot: `${toDisplayTime(session.StartTime)}–${toDisplayTime(session.EndTime)}`,
      status: 'available' as const,
      price: getSessionPrice(session),
    }));

  const courtType = RESOURCE_GROUP_MAP[resource.ResourceGroupID];

  return {
    courtId: resource.ID,
    courtName: resource.Name,
    courtType,
    availability,
  };
}

export async function scrapePicklePoint(date?: { day: number; month: number; year: number }): Promise<CourtData> {
  const d = date ?? {
    day: new Date().getDate(),
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
  };

  try {
    const data = await fetchVenueSessions(d);

    // Fetch from BOTH casual and show courts resource groups
    const courts = data.Resources
      .filter((resource) => 
        resource.ResourceGroupID === CASUAL_COURTS_GROUP_ID || 
        resource.ResourceGroupID === SHOW_COURTS_GROUP_ID
      )
      .filter((resource) => /court/i.test(resource.Name))
      .map(mapResourceToCourt);

    const availableSlots = courts.reduce((sum, court) => sum + court.availability.length, 0);
    console.log(`Pickle Point: ${courts.length} courts, ${availableSlots} available sessions`);

    return {
      club: 'picklepoint',
      date: formatDateYYYYMMDD(d),
      locations: [
        {
          locationId: PICKLEPOINT_LOCATION.id,
          locationName: PICKLEPOINT_LOCATION.name,
          address: PICKLEPOINT_LOCATION.address,
          suburb: PICKLEPOINT_LOCATION.suburb,
          courts,
        },
      ],
      scrapedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Error scraping Pickle Point:', error);

    return {
      club: 'picklepoint',
      date: formatDateYYYYMMDD(d),
      locations: [],
      scrapedAt: new Date().toISOString(),
    };
  }
}