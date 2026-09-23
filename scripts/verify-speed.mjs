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
    console.log('Loading app...');
    await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 25000 });
    await new Promise(r => setTimeout(r, 4000));

    // Dismiss first launch modal
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 500));

    // Open botnet panel
    await page.click('#botnet-panel-header');
    await page.waitForSelector('.btn-briefing', { timeout: 10000 });
    console.log('Botnet feed ready with cards.');

    // Measure click to initial SITREP display
    const t0 = Date.now();
    await page.evaluate(() => {
      const btn = document.querySelector('.btn-briefing');
      if (btn) btn.click();
    });

    // Check content at 50ms
    await new Promise(r => setTimeout(r, 50));
    const immediateText = await page.evaluate(() => document.getElementById('botnet-briefing-content')?.innerText);
    const dtImmediate = Date.now() - t0;
    console.log(`[Instant SITREP in ${dtImmediate}ms]:\n`, immediateText?.slice(0, 240));

    // Wait for verified deep AI upgrade
    await page.waitForFunction(() => {
      const el = document.getElementById('botnet-briefing-content');
      return el && (el.innerText.includes('ANALYSE VERIFIZIERT') || el.innerText.includes('ABACUS TACTICAL SITREP'));
    }, { timeout: 12000 });

    const totalDt = Date.now() - t0;
    console.log(`[Deep AI analysis completed in ${totalDt}ms total!]`);

    const finalText = await page.evaluate(() => document.getElementById('botnet-briefing-content')?.innerText);
    console.log('Final Briefing Preview:\n', finalText?.slice(0, 300));

    await page.screenshot({ path: 'scripts/final-fast-briefing.png' });
    console.log('Saved scripts/final-fast-briefing.png');
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
