import type { Court, CourtData, TimeSlot } from '../types.js';

const PICKLEPOINT_LOCATION = {
  id: 'picklepoint-milperra',
  name: 'Pickle Point',
  address: '101 Raleigh Rd, Milperra NSW 2214',
  suburb: 'Milperra',
  resourceGroupId: 'c4cd3f8c-b1ac-2463-fcd8-b9a1c62d2564',
};

const BASE_URL = 'https://clubspark.net';
const VENUE_PATH = 'Picklepoint';

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

interface PicklepointResponse {
  Resources: PicklepointResource[];
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

async function fetchVenueSessions(date: { day: number; month: number; year: number }): Promise<PicklepointResponse> {
  const formattedDate = formatDateYYYYMMDD(date);
  const params = new URLSearchParams({
    resourceID: '',
    startDate: formattedDate,
    endDate: formattedDate,
    roleId: '',
    _: Date.now().toString(),
  });

  const response = await fetch(`${BASE_URL}/v0/VenueBooking/${VENUE_PATH}/GetVenueSessions?${params.toString()}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      Accept: 'application/json, text/plain, */*',
      Referer: `${BASE_URL.toLowerCase()}/${VENUE_PATH.toLowerCase()}/Booking/BookByDate`,
    },
  });

  if (!response.ok) {
    throw new Error(`Picklepoint sessions request failed with HTTP ${response.status}`);
  }

  return response.json() as Promise<PicklepointResponse>;
}

function mapResourceToCourt(resource: PicklepointResource): Court {
  const availability: TimeSlot[] = (resource.Days[0]?.Sessions ?? [])
    .filter(isAvailableSession)
    .map((session) => ({
      timeSlot: `${toDisplayTime(session.StartTime)}–${toDisplayTime(session.EndTime)}`,
      status: 'available' as const,
      price: getSessionPrice(session),
    }));

  return {
    courtId: resource.ID,
    courtName: resource.Name,
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

    const courts = data.Resources
      .filter((resource) => resource.ResourceGroupID === PICKLEPOINT_LOCATION.resourceGroupId)
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