import * as fs from 'fs';
import * as cheerio from 'cheerio';

// Load the saved HTML
const html = fs.readFileSync('/Users/emilngo/repos/projects/when-baddy/alpha-ajax-response.html', 'utf-8');

const $ = cheerio.load(html);

// Test 1: Can we find the lane table?
const laneTable = $('table.schemaLaneTable');
console.log('❓ Found schemaLaneTable:', laneTable.length > 0);

// Test 2: Can we extract court names?
const courtNames: string[] = [];
const laneRows = $('table.schemaLaneTable tbody tr');
console.log('❓ Total rows in schemaLaneTable:', laneRows.length);

laneRows.each((index, element) => {
  const $row = $(element);
  const rowClass = ($row.attr('class') || '').toLowerCase();
  const courtName = $row.find('td.lineNumber span').text().trim();
  
  if (!rowClass.includes('hidden') && !rowClass.includes('times') && !rowClass.includes('prices')) {
    console.log(`  Row ${index}: class="${$row.attr('class')}", courtName="${courtName}"`);
    if (courtName) {
      courtNames.push(courtName);
    }
  }
});

console.log(`✅ Extracted ${courtNames.length} courts:`, courtNames);

// Test 3: Can we find the individual table?
const indTable = $('table.schemaIndividual');
console.log('❓ Found schemaIndividual:', indTable.length > 0);

// Test 4: Can we extract time slots?
const timeSlots: string[] = [];
const timeRow = $('table.schemaIndividual thead tr.times');
console.log('❓ Found times row:', timeRow.length > 0);

timeRow.find('td').each((index, element) => {
  const time = $(element).text().trim();
  if (time) {
    timeSlots.push(time);
  }
});

console.log(`✅ Extracted ${timeSlots.length} time slots:`, timeSlots);

// Test 5: Sample availability cells
const bodyRows = $('table.schemaIndividual tbody tr');
console.log('❓ Total body rows:', bodyRows.length);

// Check first real data row (skip special rows)
bodyRows.each((rowIdx, rowElement) => {
  const $row = $(rowElement);
  const rowClass = ($row.attr('class') || '').toLowerCase();
  
  if (rowClass.includes('hidden') || rowClass.includes('times') || rowClass.includes('prices')) {
    return;
  }
  
  // This is a court row
  const cells = $row.find('td');
  console.log(`\n📍 Court row ${rowIdx} (${$row.attr('class')}): ${cells.length} cells`);
  
  // Show first 3 cells
  let availableCount = 0;
  cells.slice(0, 3).each((cellIdx, cellElement) => {
    const $cell = $(cellElement);
    const cellClass = ($cell.attr('class') || '').toLowerCase();
    const hasLink = $cell.find('a').length > 0;
    const title = $cell.attr('title') || '';
    
    if (cellClass.includes('empty') || hasLink) {
      availableCount++;
      console.log(`    Cell ${cellIdx}: AVAILABLE (class: "${cellClass}", has link: ${hasLink})`);
    } else if (cellClass.includes('old')) {
      console.log(`    Cell ${cellIdx}: PAST`);
    } else {
      console.log(`    Cell ${cellIdx}: BOOKED (class: "${cellClass}")`);
    }
  });
  
  console.log(`   Summary: ${availableCount} available in first 3 slots`);
  
  // Only show first court row for brevity
  if (rowIdx === 0) {
    console.log('   (showing only first court row for brevity)');
  }
  return false; // Break after first non-special row
});
