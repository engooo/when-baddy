import * as cheerio from 'cheerio';

const NBC_LOCATIONS = [
  { id: 1, name: 'Silverwater', address: '2b/172 Silverwater Rd, Silverwater NSW 2128', suburb: 'Silverwater' },
  { id: 2, name: 'Seven Hills', address: '3/17 Stanton Rd, Seven Hills NSW 2147', suburb: 'Seven Hills' },
  { id: 4, name: 'Granville', address: '3F/62 Ferndell St, South Granville NSW 2142', suburb: 'Granville' },
  { id: 5, name: 'Castle Hill', address: '3/16 Anella Ave, Castle Hill NSW 2154', suburb: 'Castle Hill' },
  { id: 6, name: 'Alexandria', address: '8/190 Bourke Road, Alexandria NSW 2015', suburb: 'Alexandria' },
  { id: 7, name: 'MQ Park', address: '396 Lane Cove Rd, Macquarie Park NSW 2113', suburb: 'Macquarie Park' },
  { id: 8, name: 'Olympic Park', address: 'Olympic Blvd, Sydney Olympic Park NSW 2127', suburb: 'Sydney Olympic Park' },
  { id: 9, name: 'Olympic Park Pickleball', address: 'Olympic Blvd, Sydney Olympic Park NSW 2127', suburb: 'Sydney Olympic Park' },
];

const BASE_URL = 'https://nbc.yepbooking.com.au';

type SlotStatus = 'available' | 'booked' | 'past';

async function fetchLocationHtml(locationId: number, date: { day: number; month: number; year: number }): Promise<string> {
  const params = new URLSearchParams({
    id_sport: locationId.toString(),
    day: date.day.toString(),
    month: date.month.toString(),
    year: date.year.toString(),
    event: 'init',
    timetableWidth: '778',
  });

  const response = await fetch(`${BASE_URL}/ajax/ajax.schema.php`, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      Referer: BASE_URL,
      Accept: 'text/html,application/xhtml+xml',
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for location ${locationId}`);
  }

  return response.text();
}

function getCellStatus(cellClass: string, title: string, cellHtml: string): SlotStatus {
  const normalizedClass = cellClass.toLowerCase();
  const normalizedTitle = title.toLowerCase();

  if (normalizedClass.includes('old') || normalizedTitle.includes("can't book in the past")) {
    return 'past';
  }

  if (normalizedClass.includes('empty') || cellHtml.includes('<a')) {
    return 'available';
  }

  if (normalizedClass.includes('booked') || normalizedClass.includes('closed') || normalizedTitle.includes('closed')) {
    return 'booked';
  }

  return 'booked';
}

function parseTableData(html: string): Array<{ courtName: string; availability: Array<{ timeSlot: string; status: SlotStatus; price: number }> }> {
  const $ = cheerio.load(html);
  const table = $('table.schema.schemaIndividual').first();

  if (table.length === 0) {
    console.warn('No schemaIndividual table found in NBC response');
    return [];
  }

  const timeSlots: string[] = [];
  table.find('thead tr.times td').each((_, cell) => {
    const text = $(cell).text().trim();
    const span = Number($(cell).attr('colspan') ?? '1') || 1;
    for (let index = 0; index < span; index += 1) {
      if (text) {
        timeSlots.push(text);
      }
    }
  });

  const prices: number[] = [];
  table.find('tr.prices td').each((_, cell) => {
    const text = $(cell).text().trim();
    const span = Number($(cell).attr('colspan') ?? '1') || 1;
    const match = text.match(/\$(\d+(?:\.\d+)?)/);
    const price = match ? Number(match[1]) : 0;

    for (let index = 0; index < span; index += 1) {
      prices.push(price);
    }
  });

  const courts: Array<{ courtName: string; availability: Array<{ timeSlot: string; status: SlotStatus; price: number }> }> = [];

  table.find('tr[class*="trSchemaLane_"]').each((rowIndex, row) => {
    const courtName = $(row).find('th.lineNumber span').first().text().trim() || `Court ${rowIndex + 1}`;
    const availability: Array<{ timeSlot: string; status: SlotStatus; price: number }> = [];
    let slotIndex = 0;

    $(row).find('td').each((_, cell) => {
      const $cell = $(cell);
      const span = Number($cell.attr('colspan') ?? '1') || 1;
      const status = getCellStatus($cell.attr('class') || '', $cell.attr('title') || '', $.html(cell) || '');

      for (let index = 0; index < span && slotIndex < timeSlots.length; index += 1) {
        availability.push({
          timeSlot: timeSlots[slotIndex],
          status,
          price: prices[slotIndex] ?? 0,
        });
        slotIndex += 1;
      }
    });

    if (availability.length > 0) {
      courts.push({ courtName, availability });
    }
  });

  return courts;
}

async function scrapeNBCLocation(locationId: number, locationName: string, address: string, suburb: string, date: { day: number; month: number; year: number }) {
  try {
    const html = await fetchLocationHtml(locationId, date);
    const courts = parseTableData(html).map((court, index) => ({
      courtId: `${locationId}-${index}`,
      ...court,
    }));

    if (courts.length === 0) {
      console.warn(`NBC ${locationName}: no courts parsed`);
    } else {
      const availableSlots = courts.reduce((sum, court) => sum + court.availability.filter((slot) => slot.status === 'available').length, 0);
      console.log(`NBC ${locationName}: ${courts.length} courts, ${availableSlots} available slots`);
    }

    return { locationId: `${locationId}`, locationName, address, suburb, courts };
  } catch (error) {
    console.error(`Error scraping ${locationName}:`, error);
    return null;
  }
}

export async function scrapeNBCBadminton(date?: { day: number; month: number; year: number }) {
  const d = date ?? {
    day: new Date().getDate(),
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
  };

  const locations = [];
  for (const loc of NBC_LOCATIONS) {
    const result = await scrapeNBCLocation(loc.id, loc.name, loc.address, loc.suburb, d);
    if (result) {
      locations.push(result);
    }
  }

  return {
    club: 'nbc',
    date: `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`,
    locations,
    scrapedAt: new Date().toISOString(),
  };
}
