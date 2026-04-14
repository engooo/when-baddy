import * as cheerio from 'cheerio';

const NBC_LOCATIONS = [
  { id: 1, name: 'Silverwater', address: '2b/172 Silverwater Rd', suburb: 'Silverwater' },
  { id: 2, name: 'Seven Hills', address: '3/17 Stanton Rd', suburb: 'Seven Hills' },
  { id: 4, name: 'Granville', address: '3F/62 Ferndell St', suburb: 'Granville' },
  { id: 5, name: 'Castle Hill', address: '3/16 Anella Ave', suburb: 'Castle Hill' },
  { id: 6, name: 'Alexandria', address: '8/190 Bourke Road', suburb: 'Alexandria' },
  { id: 7, name: 'MQ Park', address: '396 Lane Cove Rd', suburb: 'Lane Cove' },
];

const BASE_URL = 'https://nbc.yepbooking.com.au';

async function fetchLocationHtml(locationId: number, date: { day: number; month: number; year: number }): Promise<string> {
  const params = new URLSearchParams({
    day:          date.day.toString(),
    month:        date.month.toString(),
    year:         date.year.toString(),
    id_sport:     locationId.toString(),
    event:        'pageLoad',
    tab_type:     'normal',
    timetableWidth: '778',
  });

  const res = await fetch(`${BASE_URL}/ajax/ajax.schema.php?${params}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Referer':    BASE_URL,
      'Accept':     'text/html,application/xhtml+xml',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} for location ${locationId}`);
  return res.text();
}

function parseHtml(html: string, locationId: number) {
  const $ = cheerio.load(html);
  const courtData: { courtId: string; courtName: string; availability: any[] }[] = [];

  // YepBooking has TWO tables:
  // 1. table.schemaLaneTable - contains court/lane names in row labels
  // 2. table.schemaIndividual - contains time headers and availability cells

  // --- Extract court names from first table (lane labels) ---
  const courtNames: string[] = [];
  const laneRows = $('table.schemaLaneTable tbody tr');
  
  console.log(`[DEBUG] Found ${laneRows.length} rows in schemaLaneTable`);
  
  // Debug: log first few rows to see structure
  laneRows.slice(0, 3).each((idx, elem) => {
    console.log(`  Row ${idx}: class="${$(elem).attr('class')}", text starts with: "${$(elem).text().slice(0, 30)}"`);
  });
  
  laneRows.each((index, element) => {
    const $row = $(element);
    // Skip special rows (hidden, times, prices)
    const rowClass = ($row.attr('class') || '').toLowerCase();
    if (rowClass.includes('hidden') || rowClass.includes('times') || rowClass.includes('prices')) {
      return;
    }
    
    const courtName = $row.find('td.lineNumber span').text().trim();
    if (courtName) {
      courtNames.push(courtName);
      courtData.push({ 
        courtId: `${locationId}-${courtNames.length - 1}`, 
        courtName, 
        availability: [] 
      });
    }
  });
  
  console.log(`[DEBUG] Extracted ${courtNames.length} court names:`, courtNames.slice(0, 10));

  // --- Extract time slots from second table header ---
  const timeSlots: string[] = [];
  const timeRow = $('table.schemaIndividual thead tr.times');
  timeRow.find('td').each((index, element) => {
    const time = $(element).text().trim();
    if (time) {
      timeSlots.push(time);
    }
  });
  
  console.log(`[DEBUG] Extracted ${timeSlots.length} time slots:`, timeSlots);

  // --- Extract availability from second table body ---
  const bodyRows = $('table.schemaIndividual tbody tr');
  const prices: { [key: number]: number } = {};
  
  // Extract prices from the prices row first
  const pricesRow = $('table.schemaIndividual tbody tr.prices');
  pricesRow.find('td').each((index, element) => {
    const priceText = $(element).text().trim();
    const priceMatch = priceText.match(/\$(\d+)/);
    if (priceMatch) {
      prices[index] = parseInt(priceMatch[1]);
    }
  });

  let courtIndex = 0;
  bodyRows.each((_rowIndex, rowElement) => {
    const $row = $(rowElement);
    
    // Skip special rows
    const rowClass = ($row.attr('class') || '').toLowerCase();
    if (rowClass.includes('hidden') || rowClass.includes('times') || rowClass.includes('prices')) {
      return;
    }

    if (courtIndex >= courtNames.length) {
      console.log(`[DEBUG] Skipping body row ${_rowIndex}: courtIndex ${courtIndex} >= courtNames.length ${courtNames.length}`);
      return;
    }

    const cells = $row.find('td');
    let availableCount = 0;
    let totalCellsChecked = 0;

    cells.each((cellIndex, cellElement) => {
      const $cell = $(cellElement);
      const cellClass = ($cell.attr('class') || '').toLowerCase();
      
      // Skip if cell index exceeds time slots
      if (cellIndex >= timeSlots.length) return;

      const timeSlot = timeSlots[cellIndex];
      const cellTitle = $cell.attr('title') || '';

      // Determine availability status
      let status: 'available' | 'booked' | 'past' = 'booked';
      if (cellClass.includes('empty') || $cell.find('a').length > 0) {
        status = 'available';
      } else if (cellClass.includes('old')) {
        status = 'past';
      } else if (cellClass.includes('booked')) {
        status = 'booked';
      }

      // Skip past times
      if (status === 'past') return;

      // Extract price from title attribute or prices row
      let price = prices[cellIndex] || 0;
      const priceMatch = cellTitle.match(/\$(\d+)/);
      if (priceMatch) {
        price = parseInt(priceMatch[1]);
      }

        // Only include available slots
      if (status === 'available') {
        availableCount++;
          courtData[courtIndex].availability.push({ timeSlot, status, price });
      }
    });
    
      console.log(`[DEBUG] Court ${courtIndex} (${courtNames[courtIndex] || 'UNKNOWN'}): found ${availableCount} available slots`);
    courtIndex++;
  });

    console.log(`[DEBUG] Final result: ${courtData.length} courts, ${courtData.reduce((sum, c) => sum + c.availability.length, 0)} available slots`);
  return courtData;
}

async function scrapeNBCLocation(locationId: number, locationName: string, address: string, suburb: string, date: { day: number; month: number; year: number }) {
  try {
    const html = await fetchLocationHtml(locationId, date);

    // --- Debug: log raw HTML first time you run so you can verify structure ---
    if (process.env.DEBUG_SCRAPER) {
      console.log(`\n--- Raw HTML for ${locationName} (first 2000 chars) ---`);
      console.log(html.slice(0, 2000));
    }

    const courts = parseHtml(html, locationId);

    if (courts.length === 0) {
      console.warn(`⚠️  No courts parsed for ${locationName} — HTML structure may have changed`);
    }

    return { locationId: `${locationId}`, locationName, address, suburb, courts };
  } catch (error) {
    console.error(`Error scraping ${locationName}:`, error);
    return null;
  }
}

export async function scrapeNBCBadminton(date?: { day: number; month: number; year: number }) {
  const d = date ?? {
    day:   new Date().getDate(),
    month: new Date().getMonth() + 1,
    year:  new Date().getFullYear(),
  };

  // Fetch all 6 locations in parallel — safe since we use fetch() not a shared browser page
  const locations = await Promise.all(
    NBC_LOCATIONS.map((loc) => scrapeNBCLocation(loc.id, loc.name, loc.address, loc.suburb, d))
  );

  return {
    club: 'nbc',
    date: `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`,
    locations: locations.filter((l) => l !== null),
    scrapedAt: new Date().toISOString(),
  };
}
