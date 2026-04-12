import puppeteer from 'puppeteer';
import * as fs from 'fs';

async function debugAlphaBooking() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // Navigate to the base URL
    const url = 'https://alphabadminton.yepbooking.com.au';
    console.log(`Opening ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Take a screenshot
    await page.screenshot({ path: '/Users/emilngo/repos/projects/when-baddy/alpha-screenshot.png', fullPage: true });
    console.log('✓ Screenshot saved to alpha-screenshot.png');

    // Fetch the AJAX endpoint
    const today = new Date();
    const params = new URLSearchParams({
      day: today.getDate().toString(),
      month: (today.getMonth() + 1).toString(),
      year: today.getFullYear().toString(),
      id_sport: '2', // Alpha Egerton
      event: 'pageLoad',
      tab_type: 'normal',
      timetableWidth: '780',
    });

    const ajaxUrl = `https://alphabadminton.yepbooking.com.au/ajax/ajax.schema.php?${params}`;
    console.log(`\nFetching AJAX endpoint: ${ajaxUrl}`);
    
    const response = await page.goto(ajaxUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    const ajaxHtml = await page.content();

    // Save the HTML for inspection
    fs.writeFileSync('/Users/emilngo/repos/projects/when-baddy/alpha-ajax-response.html', ajaxHtml);
    console.log('✓ AJAX response saved to alpha-ajax-response.html');

    // Log first 3000 characters
    console.log('\n--- AJAX Response (first 3000 chars) ---');
    console.log(ajaxHtml.substring(0, 3000));
    console.log('\n--- END ---\n');

    // Take a screenshot of the AJAX response
    await page.screenshot({ path: '/Users/emilngo/repos/projects/when-baddy/alpha-ajax-screenshot.png' });
    console.log('✓ AJAX screenshot saved to alpha-ajax-screenshot.png');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}

debugAlphaBooking();
