import * as cheerio from 'cheerio';
import axios from 'axios';

const PRO1_LOCATIONS = [
  {
    id: 'bankstown',
    name: 'Bankstown',
    address: '1/361 Milperra Rd, Bankstown Aerodrome NSW 2200',
    suburb: 'Bankstown',
  },
];

const BASE_URL = 'https://booking.pro1badminton.com.au';
const VENUES_PATH = '/secure/customer/booking/v1/public/venues';

function formatDateYYYYMMDD(date: { day: number; month: number; year: number }): string {
  return `${date.year}${String(date.month).padStart(2, '0')}${String(date.day).padStart(2, '0')}`;
}

function toDisplayTime(hour24: number): string {
  const period = hour24 >= 12 ? 'pm' : 'am';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:00${period}`;
}

function estimatePrice(date: { day: number; month: number; year: number }, startHour24: number): number {
  const jsDate = new Date(date.year, date.month - 1, date.day);
  const dayOfWeek = jsDate.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  if (isWeekend) return 34;
  return startHour24 >= 5 && startHour24 < 16 ? 29 : 34;
}

async function fetchCalendarWidgetHtml(date: { day: number; month: number; year: number }): Promise<string> {
  const venuesRes = await axios.get(`${BASE_URL}${VENUES_PATH}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  const responseUrl = (venuesRes.request as { res?: { responseUrl?: string } } | undefined)?.res?.responseUrl || '';
  const sessionMatch = responseUrl.match(/;jsessionid=([A-Za-z0-9]+)/i);
  const sessionId = sessionMatch?.[1];

  const yyyymmdd = formatDateYYYYMMDD(date);
  const widgetUrl = sessionId
    ? `${BASE_URL}/secure/customer/booking/v1/public/calendar-widget;jsessionid=${sessionId}?date=${yyyymmdd}`
    : `${BASE_URL}/secure/customer/booking/v1/public/calendar-widget?date=${yyyymmdd}`;

  const widgetRes = await axios.get(widgetUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      Referer: `${BASE_URL}${VENUES_PATH}`,
      Accept: 'text/html,application/xhtml+xml',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

  return widgetRes.data as string;
}

function parseHtml(html: string, date: { day: number; month: number; year: number }, locationId: string) {
  const $ = cheerio.load(html);
  const courtData: { courtId: string; courtName: string; availability: any[] }[] = [];

  const hourHeaders: string[] = [];
  $('#calendar_view_table thead tr th').each((index, element) => {
    if (index === 0) return;
    hourHeaders.push($(element).text().trim());
  });

  $('#calendar_view_table tbody tr').each((rowIndex, rowElement) => {
    const $row = $(rowElement);
    const courtName = $row.find('td.calendar-resource-label').first().text().trim();
    if (!courtName || !/court/i.test(courtName)) {
      return;
    }

    const availability: { timeSlot: string; status: 'available'; price: number }[] = [];

    $row.find('td').each((cellIndex, cellElement) => {
      if (cellIndex === 0) return;

      const $cell = $(cellElement);
      const classTokens = new Set(
        ($cell.attr('class') || '')
          .toLowerCase()
          .split(/\s+/)
          .filter(Boolean)
      );

      // Important: do exact token matching so "unavailable" is not treated as "available".
      if (!classTokens.has('available')) return;

      const timeLabel = hourHeaders[cellIndex - 1] || '';
      const match = timeLabel.match(/^(\d{1,2})(am|pm)$/i);
      if (!match) return;

      let startHour24 = Number(match[1]);
      const period = match[2].toLowerCase();
      if (period === 'pm' && startHour24 !== 12) startHour24 += 12;
      if (period === 'am' && startHour24 === 12) startHour24 = 0;

      const endHour24 = (startHour24 + 1) % 24;
      const timeSlot = `${toDisplayTime(startHour24)}–${toDisplayTime(endHour24)}`;
      const price = estimatePrice(date, startHour24);

      availability.push({ timeSlot, status: 'available', price });
    });

    courtData.push({
      courtId: `${locationId}-${rowIndex}`,
      courtName,
      availability,
    });
  });

  return courtData;
}

async function scrapePro1Location(locationId: string, locationName: string, address: string, suburb: string, date: { day: number; month: number; year: number }) {
  try {
    const html = await fetchCalendarWidgetHtml(date);
    const courts = parseHtml(html, date, locationId);

    if (courts.length === 0) {
      console.warn(`Pro1 ${locationName}: no courts parsed`);
    }

    return { locationId: `${locationId}`, locationName, address, suburb, courts };
  } catch (error) {
    console.error(`Error scraping Pro1 ${locationName}:`, error);
    return null;
  }
}

export async function scrapePro1Badminton(date?: { day: number; month: number; year: number }) {
  const d = date ?? {
    day: new Date().getDate(),
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
  };

  const locations = await Promise.all(
    PRO1_LOCATIONS.map((loc) => scrapePro1Location(loc.id, loc.name, loc.address, loc.suburb, d))
  );

  return {
    club: 'pro1' as const,
    date: `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`,
    locations: locations.filter((l) => l !== null),
    scrapedAt: new Date().toISOString(),
  };
}