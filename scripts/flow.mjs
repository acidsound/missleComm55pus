// Verifies wave-clear → tally → next wave, and game over → menu.
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errors.push(m.text()));
await page.goto(process.argv[2] || 'http://localhost:4173/', { waitUntil: 'networkidle0' });
await page.click('#btn-play');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = () => page.evaluate(() => ({ s: window.__game.state, w: window.__game.wave, score: window.__game.score }));
await sleep(4000);
await page.evaluate(() => {
  const g = window.__game;
  g.toSpawn = 0; g.smartLeft = 0; g.flyersLeft = 0;
  for (const e of [...g.enemies]) g.destroyEnemy(e, 1);
});
const log = [];
for (let i = 0; i < 12; i++) { await sleep(1000); log.push(await st()); }
await page.evaluate(() => { const g = window.__game; g.cfg.smart = 1; g.spawnSmart(); g.spawnFlyer(); g.spawnMissile(); });
await sleep(1500);
await page.evaluate(() => {
  const g = window.__game;
  for (const c of g.cities) g.onEnemyImpact({ target: { point: c.pos.clone(), ref: c }, pos: c.pos.clone(), remove() {} });
});
for (let i = 0; i < 11; i++) { await sleep(1000); log.push(await st()); }
console.log(log.map((l) => `${l.s}:${l.w}:${l.score}`).join(' '));
console.log(errors.join('\n') || 'NO ERRORS');
await browser.close();
