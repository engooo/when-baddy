import puppeteer from 'puppeteer';
import path from 'path';

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  // Set viewport for a good screenshot
  await page.setViewport({ width: 1280, height: 800 });
  
  console.log('Taking screenshot of Alpha Badminton...');
  
  try {
    // Navigate to the site
    await page.goto('https://alphabadminton.yepbooking.com.au', { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    // Take a screenshot
    const screenshotPath = path.resolve('./alpha-booking-screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    
    console.log(`✓ Screenshot saved to: ${screenshotPath}`);
    console.log('Dimensions: 1280x800+');
  } catch (error) {
    console.error('Error taking screenshot:', error.message);
  } finally {
    await browser.close();
  }
})();
