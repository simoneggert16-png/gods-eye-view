import puppeteer from 'puppeteer-core';

async function testFly() {
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

    // Click first fly button
    console.log('Clicking HINFLIEGEN button on first card...');
    await page.click('.btn-fly');
    await new Promise(r => setTimeout(r, 3500)); // wait for camera flight

    const camPos = await page.evaluate(() => {
      const viewer = window.gevViewer;
      if (!viewer) return null;
      const c = viewer.camera.positionCartographic;
      const Cesium = window.Cesium;
      return {
        lat: Cesium.Math.toDegrees(c.latitude),
        lon: Cesium.Math.toDegrees(c.longitude),
        height: c.height,
      };
    });
    console.log('Camera position after flight:', camPos);
    await page.screenshot({ path: 'scripts/botnet-flight-result.png' });
    console.log('Saved scripts/botnet-flight-result.png');
  } finally {
    await browser.close();
  }
}

testFly().catch(console.error);
