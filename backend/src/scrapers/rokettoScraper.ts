import * as cheerio from 'cheerio';
import axios from 'axios';

const ROKETTO_LOCATION = {
  id: 'lidcombe',
  name: 'Lidcombe',
  address: '22 Carter St, Lidcombe NSW 2141',
  suburb: 'Lidcombe',
};

const BASE_URL = 'https://roketto.sportlogic.net.au';
const BOOKING_SHOW_URL =
  `${BASE_URL}/secure/customer/booking/v1/public/show?readOnly=false&popupMsgDisabled=false&hideTopSiteBar=false`;

function formatDateYYYYMMDD(date: { day: number; month: number; year: number }): string {
  return `${date.year}${String(date.month).padStart(2, '0')}${String(date.day).padStart(2, '0')}`;
}

function toDisplayTime(hour24: number): string {
  const period = hour24 >= 12 ? 'pm' : 'am';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:00${period}`;
}

function getPrice(date: { day: number; month: number; year: number }, startHour24: number): number {
  const jsDate = new Date(date.year, date.month - 1, date.day);
  const dayOfWeek = jsDate.getDay(); // 0 = Sunday, 1-6 = Mon-Sat
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  // 10pm - 11pm is $15 (any day)
  if (startHour24 === 22) {
    return 15;
  }

  if (isWeekend) {
    // Sat - Sun: 7am - 10pm = $34
    return 34;
  }

  // Mon - Fri pricing
  if (startHour24 >= 9 && startHour24 < 15) {
    // 9am - 3pm = $23
    return 23;
  } else if (startHour24 >= 15 && startHour24 < 17) {
    // 3pm - 5pm = $32
    return 32;
  } else if (startHour24 >= 17 && startHour24 < 22) {
    // 5pm - 10pm = $34
    return 34;
  }

  return 34; // Default
}

function parseHourLabel(label: string): number | null {
  const match = label.trim().toLowerCase().match(/^(\d{1,2})(am|pm)$/);
  if (!match) return null;

  let hour = Number(match[1]);
  const period = match[2];

  if (period === 'pm' && hour !== 12) hour += 12;
  if (period === 'am' && hour === 12) hour = 0;

  return hour;
}

function getCookieHeader(setCookie: string[] | undefined): string | null {
  if (!setCookie || setCookie.length === 0) return null;
  const cookiePairs = setCookie.map((item) => item.split(';')[0]).filter(Boolean);
  return cookiePairs.length > 0 ? cookiePairs.join('; ') : null;
}

async function fetchCalendarWidgetHtml(date: { day: number; month: number; year: number }): Promise<string> {
  const showResponse = await axios.get(BOOKING_SHOW_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  });

  const cookieHeader = getCookieHeader(showResponse.headers['set-cookie'] as string[] | undefined);
  const responseUrl =
    (showResponse.request as { res?: { responseUrl?: string } } | undefined)?.res?.responseUrl || '';
  const sessionMatch = responseUrl.match(/;jsessionid=([A-Za-z0-9]+)/i);
  const sessionId = sessionMatch?.[1];

  if (!cookieHeader && !sessionId) {
    throw new Error('Roketto session token was not returned from booking show page');
  }

  const yyyymmdd = formatDateYYYYMMDD(date);
  const widgetPath = sessionId
    ? `/secure/customer/booking/v1/public/calendar-widget;jsessionid=${sessionId}?date=${yyyymmdd}`
    : `/secure/customer/booking/v1/public/calendar-widget?date=${yyyymmdd}`;
  const widgetUrl = `${BASE_URL}${widgetPath}`;

  const widgetResponse = await axios.get(widgetUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      Accept: '*/*',
      Referer: BOOKING_SHOW_URL,
      'X-Requested-With': 'XMLHttpRequest',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
  });

  return widgetResponse.data as string;
}

function parseHtml(html: string, locationId: string, date: { day: number; month: number; year: number }) {
  const $ = cheerio.load(html);
  const table = $('table#calendar_view_table');

  if (table.length === 0) {
    throw new Error('Roketto calendar table not found in widget response');
  }

  const timeHeaders: number[] = [];
  table.find('thead tr th').each((index, element) => {
    if (index === 0) return;
    const hour24 = parseHourLabel($(element).text());
    if (hour24 !== null) {
      timeHeaders.push(hour24);
    }
  });

  const courts: { courtId: string; courtName: string; availability: Array<{ timeSlot: string; status: 'available'; price: number }> }[] = [];

  table.find('tbody tr').each((rowIndex, rowElement) => {
    const $row = $(rowElement);
    const courtName = $row.find('td.calendar-resource-label').first().text().trim();

    if (!courtName || !/court/i.test(courtName)) {
      return;
    }

    const availability: Array<{ timeSlot: string; status: 'available'; price: number }> = [];

    $row.find('td').each((cellIndex, cellElement) => {
      if (cellIndex === 0) return;
      const startHour24 = timeHeaders[cellIndex - 1];
      if (startHour24 === undefined) return;

      const classTokens = new Set(
        (($(cellElement).attr('class') || '').toLowerCase().split(/\s+/).filter(Boolean))
      );

      if (!classTokens.has('available')) return;

      const endHour24 = (startHour24 + 1) % 24;
      availability.push({
        timeSlot: `${toDisplayTime(startHour24)}–${toDisplayTime(endHour24)}`,
        status: 'available',
        price: getPrice(date, startHour24),
      });
    });

    courts.push({
      courtId: `${locationId}-${rowIndex}`,
      courtName,
      availability,
    });
  });

  return courts;
}

export async function scrapeRokettoBadminton(date?: { day: number; month: number; year: number }) {
  const d = date ?? {
    day: new Date().getDate(),
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
  };

  try {
    const html = await fetchCalendarWidgetHtml(d);
    const courts = parseHtml(html, ROKETTO_LOCATION.id, d);

    return {
      club: 'roketto' as const,
      date: `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`,
      locations: [
        {
          locationId: ROKETTO_LOCATION.id,
          locationName: ROKETTO_LOCATION.name,
          address: ROKETTO_LOCATION.address,
          suburb: ROKETTO_LOCATION.suburb,
          courts,
        },
      ],
      scrapedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Error scraping Roketto:', error);

    return {
      club: 'roketto' as const,
      date: `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`,
      locations: [],
      scrapedAt: new Date().toISOString(),
    };
  }
}
