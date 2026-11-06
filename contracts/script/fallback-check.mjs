// The WebP fallback of a caught net's image, checked in Chrome on every looks x tier 1..5 (the cards that
// script/anvil-e2e.mjs wrote to <dir>/looks/ from the deployed renderer). Each card is rasterized three ways, the way a
// wallet shows it (an SVG data URI drawn as an image, here into a 640 x 640 canvas):
//   as it is                 the painted hamster over the drawn fallback;
//   without the fallback     must be the SAME pixels: the painted hamster covers the fallback completely;
//   without the WebP layers  what a rasterizer that cannot decode WebP shows (sharp/libvips thumbnailers): the drawn
//                            fallback must be there (the hamster box is not empty).
// With SHARP_MODULE=<path to a sharp package> it also renders every card with sharp itself (its librsvg drops the WebP
// layers) and checks that the fallback hamster shows, against a control without the fallback (which shows none).
// Writes <dir>/fallback-report.json and <dir>/fallback-sheet.png (the 16 looks as a WebP-less rasterizer shows them).
//   node contracts/script/fallback-check.mjs <outDir of anvil-e2e.mjs>
// Chrome runs once, briefly, on a blank page (no network).
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
const DIR = process.argv[2] || assert.fail('usage: node contracts/script/fallback-check.mjs <outDir of anvil-e2e.mjs>');
const FALLBACK_AT = '<g id="fallback" transform="translate(84.7 89) scale(.48)">';
const PAINTED_AT = '<g id="painted" transform="translate(70.4 14.4) scale(.4)">';
const SIZE = 640; // 2 px per card unit
const BOX = [120, 80, 200, 220]; // card units: where the hamster stands (x0, y0, x1, y1)
const MIN_FALLBACK_PX = 8000; // of the box's 160 x 280 = 44,800 px at 640: the drawn fallback covers about 12,000-17,000
const cards = [];
for (let looks = 0; looks < 16; looks++) {
  for (let tier = 1; tier <= 5; tier++) {
    const f = path.join(DIR, 'looks', `caught-${looks}-${tier}.svg`);
    assert.ok(fs.existsSync(f), `${f} (run script/anvil-e2e.mjs first)`);
    const svg = fs.readFileSync(f, 'utf8');
    const fb = svg.indexOf(FALLBACK_AT), at = svg.indexOf(PAINTED_AT);
    assert.ok(fb > 0 && at > fb && svg.slice(at - 4, at) === '</g>', `looks ${looks} tier ${tier}: the fallback group right before the painted one`);
    cards.push({ looks, tier, full: svg, noFallback: svg.slice(0, fb) + svg.slice(at), noWebp: svg.replace(/<image [^>]*\/>/g, '') });
  }
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
const killer = setTimeout(() => { browser.process()?.kill('SIGKILL'); process.exit(2); }, 100_000); // short session
const report = { size: SIZE, box: BOX, cards: [] };
let sheet;
try {
  const page = await browser.newPage();
  await page.goto('about:blank');
  await page.evaluate((SIZE, BOX) => {
    const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
    window.raster = async (svg) => {
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,' + b64(svg);
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = cv.height = SIZE;
      const g = cv.getContext('2d');
      g.drawImage(img, 0, 0, SIZE, SIZE);
      return { cv, px: g.getImageData(0, 0, SIZE, SIZE).data };
    };
    // differing pixels between two rasters (any channel), the largest channel difference, and how many pixels of the
    // hamster box differ from the card's background (its top-left pixel) in a third raster
    window.compare = async (full, noFallback, noWebp) => {
      const a = (await raster(full)).px, b = (await raster(noFallback)).px, w = await raster(noWebp);
      let diff = 0, maxDiff = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]), Math.abs(a[i + 3] - b[i + 3]));
        if (d) { diff++; if (d > maxDiff) maxDiff = d; }
      }
      const s = SIZE / 320, c = w.px, bg = [c[0], c[1], c[2]];
      let shown = 0;
      for (let y = BOX[1] * s; y < BOX[3] * s; y++) {
        for (let x = BOX[0] * s; x < BOX[2] * s; x++) {
          const i = 4 * (y * SIZE + x);
          if (Math.abs(c[i] - bg[0]) + Math.abs(c[i + 1] - bg[1]) + Math.abs(c[i + 2] - bg[2]) > 30) shown++;
        }
      }
      window.lastNoWebp = w.cv;
      return { diff, maxDiff, shown };
    };
    window.sheet = document.createElement('canvas');
    window.sheet.width = 8 * 160; window.sheet.height = 2 * 160;
  }, SIZE, BOX);
  for (const c of cards) {
    const r = await page.evaluate((x, y, z) => window.compare(x, y, z), c.full, c.noFallback, c.noWebp);
    if (c.tier === 3) await page.evaluate((k) => window.sheet.getContext('2d').drawImage(window.lastNoWebp, (k % 8) * 160, Math.floor(k / 8) * 160, 160, 160), c.looks);
    report.cards.push({ looks: c.looks, tier: c.tier, ...r });
  }
  // control: the drawn hamster at FULL size under the painted one pokes out; the comparison must see it
  const big = cards.find((c) => c.looks === 15 && c.tier === 3);
  report.control = await page.evaluate((x, y, z) => window.compare(x, y, z), big.full.replace(FALLBACK_AT, '<g id="fallback">'), big.noFallback, big.noWebp);
  sheet = await page.evaluate(() => window.sheet.toDataURL('image/png'));
} finally {
  clearTimeout(killer);
  await browser.close();
}
fs.writeFileSync(path.join(DIR, 'fallback-sheet.png'), Buffer.from(sheet.split(',')[1], 'base64'));

let bad = 0;
for (const r of report.cards) {
  const ok = r.diff === 0 && r.shown >= MIN_FALLBACK_PX;
  if (!ok) { bad++; console.log(`FAIL looks ${r.looks} tier ${r.tier}: ${r.diff} pixels differ without the fallback (max ${r.maxDiff}); without WebP ${r.shown} px of the hamster box show`); }
}
if (!(report.control.diff > 1000)) { bad++; console.log(`FAIL control: a full-size fallback changes only ${report.control.diff} pixels`); }
const shown = report.cards.map((r) => r.shown);
console.log(`control (the drawn hamster at full size under the painted one): ${report.control.diff} pixels differ`);
console.log(`Chrome, ${report.cards.length} cards (16 looks x tiers 1..5) at ${SIZE} px: the painted hamster covers the fallback exactly on ${report.cards.filter((r) => r.diff === 0).length}; without the WebP layers the fallback shows ${Math.min(...shown)}..${Math.max(...shown)} px of the ${(BOX[2] - BOX[0]) * (BOX[3] - BOX[1]) * (SIZE / 320) ** 2} px hamster box`);

// ---- sharp (optional): the rasterizer the review found blank
if (process.env.SHARP_MODULE) {
  const sharp = require(process.env.SHARP_MODULE);
  const box = async (svg) => {
    const { data } = await sharp(Buffer.from(svg), { density: 72 * 512 / 320 }).resize(512, 512).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const bg = [data[0], data[1], data[2]];
    let n = 0;
    for (let y = BOX[1] * 1.6; y < BOX[3] * 1.6; y++) {
      for (let x = BOX[0] * 1.6; x < BOX[2] * 1.6; x++) {
        const i = 4 * (y * 512 + x);
        if (Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) > 30) n++;
      }
    }
    return n;
  };
  const withFb = [], without = [];
  for (const c of cards) { withFb.push(await box(c.full)); without.push(await box(c.noFallback)); }
  const v = (({ sharp: s_, vips, rsvg, webp }) => ({ sharp: s_, vips, rsvg, webp }))(sharp.versions);
  report.sharp = { version: v, withFallback: [Math.min(...withFb), Math.max(...withFb)], withoutFallback: [Math.min(...without), Math.max(...without)] };
  console.log(`sharp ${JSON.stringify(v)}: hamster box pixels shown at 512 px, with the fallback ${Math.min(...withFb)}..${Math.max(...withFb)}, without it ${Math.min(...without)}..${Math.max(...without)} (of ${80 * 140 * 1.6 * 1.6})`);
  const sharpMin = 5000; // the fallback covers about 7,500-10,500 of these 28,672 px at 512
  for (let k = 0; k < cards.length; k++) if (withFb[k] < sharpMin) { bad++; console.log(`FAIL sharp looks ${cards[k].looks} tier ${cards[k].tier}: only ${withFb[k]} px show`); }
}
fs.writeFileSync(path.join(DIR, 'fallback-report.json'), JSON.stringify(report, null, 1));
console.log(bad ? `FALLBACK CHECK FAILED: ${bad}` : 'FALLBACK CHECK OK', '|', path.join(DIR, 'fallback-sheet.png'));
process.exit(bad ? 1 : 0);
