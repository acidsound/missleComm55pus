// Headless smoke test: loads the built game, captures errors + screenshots.
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://localhost:4173/';
const out = process.argv[3] || '.';
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 4000));
await page.screenshot({ path: `${out}/shot-menu.png` });

await page.click('#btn-play');
await new Promise((r) => setTimeout(r, 6000));
// fire a few shots at incoming threats
for (let i = 0; i < 8; i++) {
  await page.mouse.move(500 + i * 90, 300 + (i % 3) * 40);
  await page.mouse.down(); await page.mouse.up();
  await new Promise((r) => setTimeout(r, 250));
}
// auto-gunner: lead incoming missiles so we can see intercepts + chains
for (let k = 0; k < 6; k++) {
  await page.evaluate(() => {
    const g = window.__game;
    for (const e of g.enemies.slice(0, 2)) {
      const p = e.pos.clone().addScaledVector(e.vel, 1.6);
      g.handleFire({ point: p }, -1);
    }
  });
  await new Promise((r) => setTimeout(r, 700));
}
await page.mouse.move(800, 380);
await page.screenshot({ path: `${out}/shot-play.png` });
// force a city strike for the destruction look
await page.evaluate(() => {
  const g = window.__game;
  const c = g.cities[2];
  for (let i = 0; i < 3; i++) g.spawnMissile(3);
  g.onEnemyImpact({ target: { point: c.pos.clone(), ref: c }, remove() {}, pos: c.pos.clone() });
});
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: `${out}/shot-impact.png` });
const info = await page.evaluate(() => ({ state: window.__game.state, enemies: window.__game.enemies.length, score: window.__game.score, explosions: window.__game.fx.explosions.length }));
console.log(JSON.stringify(info));
console.log(errors.slice(0, 30).join('\n') || 'NO ERRORS');
await browser.close();
