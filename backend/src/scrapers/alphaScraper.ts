import * as cheerio from 'cheerio';

const ALPHA_LOCATIONS = [
  { id: 2, name: 'Egerton', address: '46 Egerton Street, Silverwater NSW 2128', suburb: 'Silverwater', courts: 28 },
  { id: 3, name: 'Auburn',  address: '161 Manchester Rd, Auburn NSW 2144',       suburb: 'Auburn',       courts: 22 },
  { id: 1, name: 'Slough',  address: '2 Slough Avenue, Silverwater NSW 2128',    suburb: 'Silverwater',  courts: 13 },
];

const FOCUS_ALPHA_LOCATION: string | null = null;

const BASE_URL = 'https://alphabadminton.yepbooking.com.au';

async function fetchLocationHtml(locationId: number, date: { day: number; month: number; year: number }): Promise<string> {
  const params = new URLSearchParams({
    id_sport: locationId.toString(),
    day: date.day.toString(),
    month: date.month.toString(),
    year: date.year.toString(),
    event: 'init',
    timetableWidth: '778',
  });

  const res = await fetch(`${BASE_URL}/ajax/ajax.schema.php`, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Referer': BASE_URL,
      'Accept': 'text/html,application/xhtml+xml',
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} for location ${locationId}`);
  return res.text();
}

function parseHtml(html: string, locationId: number) {
  const $ = cheerio.load(html);
  const courtData: { courtId: string; courtName: string; availability: any[] }[] = [];

  // Find the booking table
  const table = $('table.schema.schemaIndividual').first();
  if (table.length === 0) {
    console.log('[DEBUG] No schemaIndividual table found');
    return courtData;
  }

  // Extract all unique court names from the page
  const courtSet = new Set<string>();
  $('*').each((i, el) => {
    const text = $(el).text();
    const matches = text.match(/Court\s+(\d+)/g);
    if (matches) {
      matches.forEach(match => courtSet.add(match));
    }
  });

  // Sort courts by number
  const allCourts = Array.from(courtSet).sort((a, b) => {
    const aNum = parseInt(a.match(/\d+/)![0]);
    const bNum = parseInt(b.match(/\d+/)![0]);
    return aNum - bNum;
  });

  console.log(`[DEBUG] Extracted ${allCourts.length} unique courts:`, allCourts.slice(0, 5));

  // Extract time slots from thead (second row, starting at cell index 1)
  const theadRows = table.find('thead tr');
  const timeSlots: string[] = [];
  
  if (theadRows.length >= 2) {
    const timeHeaderRow = theadRows.eq(1);
    timeHeaderRow.find('td, th').each((index, element) => {
      if (index > 0) {  // Skip first cell (court name column)
        const time = $(element).text().trim();
        if (time && time.match(/\d+:\d+[ap]m/i)) {
          timeSlots.push(time);
        }
      }
    });
  }

  console.log(`[DEBUG] Extracted ${timeSlots.length} time slots:`, timeSlots.slice(0, 5));

  // Process court data from tbody
  const rows = table.find('tbody tr');
  console.log(`[DEBUG] Found ${rows.length} court rows in tbody`);

  // Price row typically has class "prices" and one value per booking column.
  const priceBySlotIndex: number[] = [];
  const priceRow = rows.filter((_, row) => (($(row).attr('class') || '').toLowerCase().includes('prices'))).first();
  if (priceRow.length > 0) {
    priceRow.find('td').each((idx, cell) => {
      const text = $(cell).text().trim();
      const m = text.match(/\$(\d+(?:\.\d+)?)/);
      if (m) {
        priceBySlotIndex[idx] = Number(m[1]);
      }
    });
    console.log(`[DEBUG] Extracted ${priceBySlotIndex.filter((p) => typeof p === 'number').length} price cells`);
  }

  // Some Alpha layouts include a leading non-time cell in the price row, some don't.
  const priceIndexOffset = priceBySlotIndex.length === timeSlots.length + 1 ? 1 : 0;

  const extractTimeFromLabel = (raw: string): string | null => {
    const text = (raw || '').replace(/[–—]/g, '-').toLowerCase();
    const m = text.match(/(\d{1,2}:\d{2}[ap]m)\s*-\s*\d{1,2}:\d{2}[ap]m/i);
    return m ? m[1] : null;
  };

  const normalizeTime = (raw: string): string => raw.trim().toLowerCase();

  rows.each((rowIdx, row) => {
    const $row = $(row);
    const cells = $row.find('td');

    if (cells.length === 0) return;

    // Skip if this row has no booking cells (e.g., price row or footer)
    const hasBookingOrOld = cells.toArray().some(cell => {
      const cls = $(cell).attr('class') || '';
      return cls.includes('booked') || cls.includes('old') || cls.includes('empty');
    });
    
    if (!hasBookingOrOld) {
      console.log(`[DEBUG] Skipping row ${rowIdx} (no booking cells)`);
      return;
    }

    // Get court name from the extracted courts list
    if (rowIdx >= allCourts.length) {
      return;  // More rows than courts - skip
    }

    const courtName = allCourts[rowIdx];
    console.log(`[DEBUG] Processing row ${rowIdx}: ${courtName}`);

    // Initialize court data
    const court = {
      courtId: `${locationId}-${rowIdx}`,
      courtName: courtName,
      availability: [] as any[]
    };

    // Process availability for each time slot (cells 1 onwards)
    cells.slice(1).each((cellIdx, cell) => {
      const $cell = $(cell);
      const cellClass = ($cell.attr('class') || '').toLowerCase();
      const anchorClass = ($cell.find('a').attr('class') || '').toLowerCase();
      const rawLabel = ($cell.find('a').attr('aria-label') || $cell.attr('data-tooltip') || '') as string;

      const hasAvailableSignal = cellClass.includes('empty') || anchorClass.includes('empty');
      const hasBlockedSignal = cellClass.includes('booked') || cellClass.includes('old') || anchorClass.includes('booked');
      const isAvailable = hasAvailableSignal && !hasBlockedSignal && cellIdx < timeSlots.length;

      if (isAvailable) {
        const labelTime = extractTimeFromLabel(rawLabel);
        const finalTimeSlot = labelTime || timeSlots[cellIdx];

        // In some Alpha responses, aria-label time can drift from visual cell index.
        // Prefer time-label based price lookup when available to keep price/time aligned.
        let priceSlotIndex = cellIdx;
        if (labelTime) {
          const byLabelIndex = timeSlots.findIndex((slot) => normalizeTime(slot) === normalizeTime(labelTime));
          if (byLabelIndex >= 0) {
            priceSlotIndex = byLabelIndex;
          }
        }

        const slotPrice = priceBySlotIndex[priceSlotIndex + priceIndexOffset] ?? 0;
        court.availability.push({
          timeSlot: finalTimeSlot,
          status: 'available',
          price: slotPrice,
        });
      }
    });

    courtData.push(court);
  });

  console.log(`[DEBUG] Extracted ${courtData.length} courts with availability`);

  return courtData;
}

async function scrapeAlphaLocation(locationId: number, locationName: string, address: string, suburb: string, date: { day: number; month: number; year: number }) {
  try {
    const html = await fetchLocationHtml(locationId, date);

    const courts = parseHtml(html, locationId);

    if (courts.length === 0) {
      console.warn(`⚠️  No courts parsed for ${locationName} — could not extract court information`);
    } else {
      const totalAvailable = courts.reduce((sum, c) => sum + c.availability.length, 0);
      console.log(`✅ ${locationName}: ${courts.length} courts, ${totalAvailable} available slots`);
    }

    return { locationId: `${locationId}`, locationName, address, suburb, courts };
  } catch (error) {
    console.error(`Error scraping ${locationName}:`, error);
    return null;
  }
}

export async function scrapeAlphaBadminton(date?: { day: number; month: number; year: number }) {
  const d = date ?? {
    day:   new Date().getDate(),
    month: new Date().getMonth() + 1,
    year:  new Date().getFullYear(),
  };

  console.log(`\n[DEBUG] Starting scrape for ${d.day}/${d.month}/${d.year}`);

  const targetLocations = FOCUS_ALPHA_LOCATION
    ? ALPHA_LOCATIONS.filter((loc) => loc.name === FOCUS_ALPHA_LOCATION)
    : ALPHA_LOCATIONS;

  const locations = (await Promise.all(
    targetLocations.map((loc) => scrapeAlphaLocation(loc.id, loc.name, loc.address, loc.suburb, d))
  )).filter(Boolean);

  return {
    club: 'alpha',
    date: `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`,
    locations: locations.filter((l) => l !== null),
    scrapedAt: new Date().toISOString(),
  };
}