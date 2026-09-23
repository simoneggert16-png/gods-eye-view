import puppeteer from 'puppeteer-core';

async function testTabs() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1000']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 4000));
    await page.click('#botnet-panel-header');
    await new Promise(r => setTimeout(r, 1000));

    // Click RADAR tab
    await page.evaluate(() => {
      const tab = document.querySelector('.botnet-tab-btn[data-category="RADAR"]');
      if (tab) tab.click();
    });
    await new Promise(r => setTimeout(r, 600));
    await page.screenshot({ path: 'scripts/botnet-radar-tab.png' });
    console.log('Saved scripts/botnet-radar-tab.png');
  } finally {
    await browser.close();
  }
}

testTabs().catch(console.error);
