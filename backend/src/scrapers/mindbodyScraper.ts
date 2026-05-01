import type { Court, CourtData, TimeSlot } from '../types.js';

const MINDBODY_BASE_URL = 'https://go.mindbodyonline.com/book';
const WIDGET_ID = '7b9803fef1';
const LOCATION_ID = 1;
const PICKLEBALL_30_SERVICE_ID = 120;
const PREMIUM_PICKLEBALL_30_SERVICE_ID = 132;

// Mindbody uses staffId as the schedule resource key.
// For this venue, those staff IDs correspond to individual courts.

const VENUE_INFO = {
  id: 'mindbody-ryde',
  name: 'Ryde Multisport & Racquet Centre',
  address: '16-18 Epping Rd, North Ryde NSW 2113',
  suburb: 'North Ryde',
};

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

function formatSlot(startMinutes: number, durationMinutes: number): string {
  const endMinutes = startMinutes + durationMinutes;
  return `${toDisplayTime(startMinutes)}–${toDisplayTime(endMinutes)}`;
}

function getRydeHourlyRate(date: string, startMinutes: number): number {
  const [yearStr, monthStr, dayStr] = date.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const dt = new Date(year, month - 1, day);
  const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;

  // Off-peak: weekdays 7:00am–5:00pm => $21/hr
  const isWeekdayOffPeak = !isWeekend && startMinutes >= 7 * 60 && startMinutes < 17 * 60;
  return isWeekdayOffPeak ? 21 : 24;
}

function getRydeSlotPrice(date: string, startMinutes: number, durationMinutes: number): number {
  const hourlyRate = getRydeHourlyRate(date, startMinutes);
  const prorated = hourlyRate * (durationMinutes / 60);
  return Math.round(prorated * 100) / 100;
}

function getRydePremiumSlotPrice(date: string, startMinutes: number, durationMinutes: number): number {
  const [yearStr, monthStr, dayStr] = date.split('-');
  const dt = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
  const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
  // Peak: weekdays 5pm–10pm => $30/hr. All other times (off-peak + weekends) => $25/hr.
  const isWeekdayPeak = !isWeekend && startMinutes >= 17 * 60 && startMinutes < 22 * 60;
  const hourlyRate = isWeekdayPeak ? 30 : 25;
  return Math.round(hourlyRate * (durationMinutes / 60) * 100) / 100;
}

function parseIsoStartMinutes(iso: string): number | null {
  const match = iso.match(/T(\d{2}):(\d{2}):\d{2}$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

async function fetchHtml(path: string): Promise<string> {
  const response = await fetch(`${MINDBODY_BASE_URL}${path}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`Mindbody request failed with HTTP ${response.status} for ${path}`);
  }

  return response.text();
}

function extractIncludedStaffIds(servicesHtml: string): string[] {
  // The services payload contains the allowed resource pool for this widget.
  // We bootstrap scraping from this list before calling /staff and /schedule.
  const tokenIndex = servicesHtml.indexOf('includedStaffIds');
  if (tokenIndex < 0) return [];

  const listStart = servicesHtml.indexOf('[', tokenIndex);
  if (listStart < 0) return [];

  const listEnd = servicesHtml.indexOf(']', listStart);
  if (listEnd < 0) return [];

  const listChunk = servicesHtml.slice(listStart, listEnd + 1);
  const ids = Array.from(listChunk.matchAll(/\d{8,9}/g)).map((m) => m[0]);
  return Array.from(new Set(ids));
}

function extractStaffMembers(staffHtml: string): Array<{ id: string; name: string }> {
  const members: Array<{ id: string; name: string }> = [];
  const seen = new Set<string>();

  for (const match of staffHtml.matchAll(/\\\"id\\\":\\\"(\d+)\\\",\\\"displayLabel\\\":\\\"([^\\\"]+)\\\"/g)) {
    const id = match[1];
    const name = match[2];
    if (!seen.has(id)) {
      seen.add(id);
      members.push({ id, name });
    }
  }

  return members;
}

function extractDateBlock(availabilityHtml: string, date: string): string | null {
  const startToken = `\\\"${date}\\\":{`;
  const startIndex = availabilityHtml.indexOf(startToken);
  if (startIndex < 0) return null;

  const braceStart = availabilityHtml.indexOf('{', startIndex);
  if (braceStart < 0) return null;

  let depth = 0;
  for (let i = braceStart; i < availabilityHtml.length; i++) {
    const ch = availabilityHtml[i];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return availabilityHtml.slice(braceStart, i + 1);
      }
    }
  }

  return null;
}

function extractBaseStartTimes(scheduleHtml: string, date: string): number[] {
  const dateBlock = extractDateBlock(scheduleHtml, date);
  if (!dateBlock) return [];

  const starts: number[] = [];
  for (const match of dateBlock.matchAll(/\\\"time\\\":\\\"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\\\"/g)) {
    const minutes = parseIsoStartMinutes(match[1]);
    if (minutes !== null) starts.push(minutes);
  }

  return Array.from(new Set(starts)).sort((a, b) => a - b);
}

type PriceFn = (date: string, startMinutes: number, durationMinutes: number) => number;

function buildDerivedSlots(baseStarts: number[], date: string, priceFn: PriceFn = getRydeSlotPrice): TimeSlot[] {
  const availableSet = new Set(baseStarts);
  const emitted = new Set<string>();
  const slots: TimeSlot[] = [];

  // Build 30/60/90/120 minute windows from consecutive 30-minute starts.
  const durations = [30, 60, 90, 120];
  for (const start of baseStarts) {
    for (const duration of durations) {
      const segments = duration / 30;
      let contiguous = true;

      for (let i = 0; i < segments; i++) {
        if (!availableSet.has(start + i * 30)) {
          contiguous = false;
          break;
        }
      }

      if (!contiguous) continue;

      const timeSlot = formatSlot(start, duration);
      if (emitted.has(timeSlot)) continue;
      emitted.add(timeSlot);

      slots.push({
        timeSlot,
        status: 'available',
        price: priceFn(date, start, duration),
      });
    }
  }

  return slots;
}

export async function scrapeMindbody(date?: { day: number; month: number; year: number }): Promise<CourtData> {
  const d = date ?? getSydneyTodayParts();
  const targetDate = formatDateYYYYMMDD(d);

  try {
    const servicesHtml = await fetchHtml(`/widgets/appointments/view/${WIDGET_ID}/services`);
    const includedStaffIds = extractIncludedStaffIds(servicesHtml);

    if (includedStaffIds.length === 0) {
      throw new Error('No included staff IDs were found in Mindbody services payload');
    }

    // The /staff endpoint requires a staffId query parameter.
    // Any valid ID from includedStaffIds works as a seed for fetching the full list.
    const seedStaffId = includedStaffIds[0];
    const staffHtml = await fetchHtml(
      `/widgets/appointments/view/${WIDGET_ID}/staff?locationId=${LOCATION_ID}&serviceId=${PICKLEBALL_30_SERVICE_ID}&staffId=${seedStaffId}`
    );

    const parsedMembers = extractStaffMembers(staffHtml);
    const staffMembers = parsedMembers.length > 0
      ? parsedMembers
      : includedStaffIds.map((id) => ({ id, name: `Court ${id}` }));

    const courts: Court[] = [];

    for (const member of staffMembers) {
      // Each court/resource is queried by its staffId to get availability for that court.
      const scheduleHtml = await fetchHtml(
        `/widgets/appointments/view/${WIDGET_ID}/schedule?locationId=${LOCATION_ID}&serviceId=${PICKLEBALL_30_SERVICE_ID}&staffId=${member.id}`
      );

      const baseStarts = extractBaseStartTimes(scheduleHtml, targetDate);
      const availability = buildDerivedSlots(baseStarts, targetDate, getRydeSlotPrice);

      courts.push({
        courtId: member.id,
        courtName: member.name,
        availability,
      });
    }

    // Scrape Premium Pickleball courts (service 132, Courts 1–4, $25/$30/hr)
    const premiumStaffHtml = await fetchHtml(
      `/widgets/appointments/view/${WIDGET_ID}/staff?locationId=${LOCATION_ID}&serviceId=${PREMIUM_PICKLEBALL_30_SERVICE_ID}&staffId=${seedStaffId}`
    );
    const premiumMembers = extractStaffMembers(premiumStaffHtml);
    const premiumMemberList = premiumMembers.length > 0
      ? premiumMembers
      : [];

    for (const member of premiumMemberList) {
      // Skip if this court was already added by the standard pass
      if (courts.some((c) => c.courtId === member.id)) continue;

      const scheduleHtml = await fetchHtml(
        `/widgets/appointments/view/${WIDGET_ID}/schedule?locationId=${LOCATION_ID}&serviceId=${PREMIUM_PICKLEBALL_30_SERVICE_ID}&staffId=${member.id}`
      );

      const baseStarts = extractBaseStartTimes(scheduleHtml, targetDate);
      const availability = buildDerivedSlots(baseStarts, targetDate, getRydePremiumSlotPrice);

      courts.push({
        courtId: member.id,
        courtName: member.name,
        availability,
      });
    }

    const availableSlots = courts.reduce((sum, court) => sum + court.availability.length, 0);
    console.log(`Mindbody (Ryde): ${courts.length} courts (${staffMembers.length} standard + ${premiumMemberList.length} premium), ${availableSlots} derived sessions on ${targetDate}`);

    return {
      club: 'mindbody',
      date: targetDate,
      locations: [
        {
          locationId: VENUE_INFO.id,
          locationName: VENUE_INFO.name,
          address: VENUE_INFO.address,
          suburb: VENUE_INFO.suburb,
          courts,
        },
      ],
      scrapedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Error scraping Mindbody venue:', error);

    return {
      club: 'mindbody',
      date: targetDate,
      locations: [],
      scrapedAt: new Date().toISOString(),
    };
  }
}