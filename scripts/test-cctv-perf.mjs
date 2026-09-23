import puppeteer from 'puppeteer-core';

async function testCctvPerformance() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warn') {
      console.log(`[CONSOLE ${msg.type()}]`, msg.text());
    }
  });

  const url = 'http://localhost:4173/#v=2&lat=47.3851&lon=9.6493&alt=965&heading=110&pitch=-22&roll=360&style=normal&bloom=0&sharpen=1&bi=0&bv=2&si=49';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await new Promise(r => setTimeout(r, 4000));

  console.log('Enabling CCTV...');
  await page.evaluate(() => {
    const cctv = window.gevViewer?.cctvLayer;
    if (cctv) {
      cctv.setEnabled(true);
      cctv.selectNearestCamera();
    }
  });

  await new Promise(r => setTimeout(r, 3000));

  const fps = await page.evaluate(() => {
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

  console.log('FPS with CCTV active:', fps);

  const sceneInfo = await page.evaluate(() => {
    const scene = window.viewer?.scene;
    return {
      requestRenderMode: scene?.requestRenderMode,
      primitivesCount: scene?.primitives?.length,
      globeVisible: scene?.globe?.show,
    };
  });
  console.log('Scene info:', sceneInfo);

  await browser.close();
}

testCctvPerformance().catch(console.error);
