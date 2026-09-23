import puppeteer from 'puppeteer-core';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1000']
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000 });
    await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await new Promise(r => setTimeout(r, 4000));
    await page.waitForFunction(() => Boolean(window.__godsEyeView?.viewer), { timeout: 20000 });

    // Dismiss first launch modal
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 600));

    // Open botnet panel
    await page.click('#botnet-panel-header');
    await new Promise(r => setTimeout(r, 1200));

    // Switch to UNWETTER tab
    await page.evaluate(() => {
      const tab = Array.from(document.querySelectorAll('.botnet-tab-btn')).find(b => b.dataset.category === 'UNWETTER');
      if (tab) tab.click();
    });
    await new Promise(r => setTimeout(r, 600));

    // Click first weather card
    await page.evaluate(() => {
      const card = document.querySelector('.botnet-card');
      if (card) card.click();
    });
    console.log('Clicked weather card, flying camera...');
    await new Promise(r => setTimeout(r, 4000));

    const entityInfo = await page.evaluate(() => {
      const viewer = window.__godsEyeView?.viewer;
      for (let i = 0; i < viewer.dataSources.length; i++) {
        const ds = viewer.dataSources.get(i);
        if (ds.name === 'gev-botnet-tactical') {
          return {
            count: ds.entities.values.length,
            names: ds.entities.values.map(e => e.name),
            hasPolygon: ds.entities.values.some(e => Boolean(e.polygon)),
            hasPolyline: ds.entities.values.some(e => Boolean(e.polyline)),
          };
        }
      }
      return null;
    });
    console.log('Weather entities in Cesium:', entityInfo);

    await page.screenshot({ path: 'scripts/tactical-storm-polygon.png' });
    console.log('Saved scripts/tactical-storm-polygon.png');
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
