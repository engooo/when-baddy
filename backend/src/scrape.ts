import { fetchAllCourtData } from './service.js';

async function main() {
  try {
    console.log('Starting scrape...');
    const data = await fetchAllCourtData();
    console.log(`Total court records: ${data.length}`);
    console.log(JSON.stringify(data.slice(0, 5), null, 2)); // Show first 5 records
  } catch (error) {
    console.error('Scrape failed:', error);
    process.exit(1);
  }
}

main();
