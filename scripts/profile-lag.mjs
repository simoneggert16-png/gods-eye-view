import puppeteer from 'puppeteer-core';

async function profileApp() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  let reqCount = 0;
  const reqUrls = [];
  page.on('request', req => {
    reqCount++;
    if (reqUrls.length < 30) reqUrls.push(req.url());
  });

  const url = 'http://localhost:4173/#v=2&lat=47.3851&lon=9.6493&alt=965&heading=110&pitch=-22&roll=360&style=normal&bloom=0&sharpen=1&bi=0&bv=2&si=49';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await new Promise(r => setTimeout(r, 4000)); // wait for initial load

  console.log('--- Initial Load Done ---');
  reqCount = 0;
  reqUrls.length = 0;

  // Monitor for 5 seconds
  const startFps = await page.evaluate(() => {
    return new Promise(resolve => {
      let frames = 0;
      const start = performance.now();
      function count() {
        frames++;
        if (performance.now() - start < 2000) {
          requestAnimationFrame(count);
        } else {
          resolve(frames / 2);
        }
      }
      requestAnimationFrame(count);
    });
  });

  console.log('Estimated FPS:', startFps);
  console.log('Requests during 2s idle:', reqCount);
  if (reqUrls.length) {
    console.log('Sample requests:', reqUrls.slice(0, 10));
  }

  // Check what layers or intervals are running
  const appState = await page.evaluate(() => {
    return {
      cctvActive: !!window.gevViewer?.cctvLayer?.enabled,
      trackedEntity: !!window.gevViewer?.trackedEntity,
      useDefaultRenderLoop: window.gevViewer?.useDefaultRenderLoop,
    };
  });
  console.log('App state:', appState);

  await browser.close();
}

profileApp().catch(console.error);
