// Render every state's NFT image the way a wallet shows it: <img src="data:image/svg+xml;base64,..."> in Chrome
// (headless, one short session, a local file:// page only), from the token-<state>.svg files that
// script/anvil-e2e.mjs wrote. Writes <state>.png (each image at 640 x 640, device scale 2) and states-sheet.png.
//   node contracts/script/render-states.mjs <outDir of anvil-e2e.mjs>
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
const DIR = process.argv[2] || assert.fail('usage: node contracts/script/render-states.mjs <outDir>');
const ORDER = ['waiting', 'caught-common', 'caught-uncommon', 'caught-rare', 'caught-epic', 'caught-legendary', 'away-in-reach',
  'away-out-of-reach', 'away-out-of-reach-6', 'away-out-of-reach-13', 'slept', 'waiting-6-nov', 'no-chip-result'];
const states = ORDER.filter((s) => fs.existsSync(path.join(DIR, `token-${s}.svg`)));
assert.ok(states.length >= 10, `token-*.svg files in ${DIR}`);
const cell = (s) => {
  const b64 = fs.readFileSync(path.join(DIR, `token-${s}.svg`)).toString('base64');
  return `<figure id="f-${s}"><img id="i-${s}" width="320" height="320" alt="${s}" src="data:image/svg+xml;base64,${b64}"><figcaption>${s}</figcaption></figure>`;
};
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:12px;background:#fff;font:12px Verdana,sans-serif;display:flex;flex-wrap:wrap;gap:12px;width:1700px}
figure{margin:0}img{display:block;border:1px solid #ccc}figcaption{text-align:center;padding-top:4px}</style>
${states.map(cell).join('\n')}`;
const page_ = path.join(DIR, 'states.html');
fs.writeFileSync(page_, html);

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
const killer = setTimeout(() => { browser.process()?.kill('SIGKILL'); process.exit(2); }, 90_000); // short session
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1724, height: 1200, deviceScaleFactor: 2 });
  await page.goto('file://' + page_, { waitUntil: 'load' });
  const sizes = await page.evaluate(async () => {
    await Promise.all([...document.images].map((i) => i.decode()));
    return [...document.images].map((i) => [i.alt, i.naturalWidth, i.naturalHeight, i.complete]);
  });
  for (const [s, w, h, ok] of sizes) assert.ok(ok && w > 0 && h > 0, `${s}: the image decoded (${w} x ${h})`);
  const out = [];
  for (const s of states) {
    const el = await page.$(`#i-${s}`);
    const p = path.join(DIR, `${s}.png`);
    await el.screenshot({ path: p });
    out.push(p);
  }
  const sheet = path.join(DIR, 'states-sheet.png');
  await page.screenshot({ path: sheet, fullPage: true });
  console.log(out.join('\n'));
  console.log(sheet);
} finally {
  clearTimeout(killer);
  await browser.close();
}
