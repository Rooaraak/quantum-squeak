// The painted renderer, end to end on a LOCAL anvil (never a public network) and in Chrome:
//   1. start anvil, deploy the ArtChunk data contracts + PaintedArt with script/DeployArt.s.sol (gas per transaction);
//   2. eth_call hamster(looks, tier) for all 16 looks x tiers 0..5, check each against test/data/art-expected.json
//      (tools/pack_art.py's reference renderer), eth_estimateGas the heaviest calls;
//   3. in Chrome, render every looks x tier 1..5 the way a wallet shows an NFT (<img src="data:image/svg+xml;base64,...">,
//      the fragment inside <svg viewBox='0 0 448 600'>) and compare it pixel by pixel with the Quantum Catch page's own
//      canvas composite() (code taken from wheel/page.template.html, engine.js as the page loads it, the same art.json),
//      cropped to the 448 x 600 body box (the page's 448 x 612 canvas has it at y = 12). A control without the erase
//      mask shows the comparison sees the cut-outs. Writes report.json and PNGs (contact sheet, side by side, diff).
//   node contracts/script/art-render-check.mjs [outDir]    (PORT=8611 by default)
// (It names this machine's paths, so it lives in script/, which the public export leaves out.)
// FORGE_EXTRA adds flags to the forge script call, e.g. FORGE_EXTRA='--skip Catch' while other sources do not compile
// (the art needs only PaintedArt, the ArtChunks and forge-std).
// Uses only anvil's own unlocked test accounts. Chrome runs once, briefly (local file:// page only).
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
const C = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); // contracts/
const ROOT = path.join(C, '..');
const PORT = Number(process.env.PORT || 8611);
const RPC = `http://127.0.0.1:${PORT}`;
const F = process.env.FOUNDRY_BIN || `${process.env.HOME}/.foundry/bin`;
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'qc-art-'));
const TX_CAP = 16777216; // EIP-7825 per-transaction gas cap
const EXP = JSON.parse(fs.readFileSync(path.join(C, 'test/data/art-expected.json'), 'utf8'));
const ABI = ['function hamster(uint8 looks, uint8 tier) view returns (string)', 'function chunks() view returns (address[])'];
const sha = (s) => '0x' + crypto.createHash('sha256').update(s).digest('hex');
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- 1 + 2: anvil
const anvil = spawn(`${F}/anvil`, ['--host', '127.0.0.1', '--port', String(PORT), '--silent'], { stdio: 'ignore' });
const stop = () => { try { anvil.kill('SIGTERM'); } catch {} };
process.on('exit', stop);
const frags = {};
const report = { deploy: {}, call: {}, render: [] };
try {
  const provider = new ethers.JsonRpcProvider(RPC, 31337, { staticNetwork: true });
  for (let i = 0; ; i++) {
    try { await provider.getBlockNumber(); break; } catch { if (i > 100) throw new Error('anvil did not start'); await new Promise((r) => setTimeout(r, 100)); }
  }
  assert.equal(await provider.send('eth_chainId', []), '0x7a69', 'local anvil only');
  const deployer = (await provider.send('eth_accounts', []))[9];
  const dep = execFileSync(`${F}/forge`, ['script', 'script/DeployArt.s.sol', '--tc', 'DeployArt', '--offline', '--rpc-url', RPC, '--broadcast', '--slow', '--unlocked', '--sender', deployer,
    ...(process.env.FORGE_EXTRA || '').split(/\s+/).filter(Boolean)],
    { cwd: C, encoding: 'utf8' });
  const addr = /PaintedArt (0x[0-9a-fA-F]{40})/.exec(dep)?.[1] || assert.fail('no address in deploy output:\n' + dep);
  const art = new ethers.Contract(addr, ABI, provider);
  const chunks = await art.chunks();
  assert.equal(chunks.length, EXP.chunks);
  // gas of every deploy transaction (anvil mines one per block)
  const txs = [];
  for (let b = 1, top = await provider.getBlockNumber(); b <= top; b++) {
    const blk = await provider.getBlock(b);
    for (const h of blk.transactions) { const r = await provider.getTransactionReceipt(h); txs.push({ to: r.contractAddress, gas: Number(r.gasUsed) }); }
  }
  const byAddr = Object.fromEntries(txs.map((t) => [t.to?.toLowerCase(), t.gas]));
  const chunkGas = chunks.map((a) => byAddr[a.toLowerCase()]);
  report.deploy = { paintedArt: addr, chunkGas, paintedArtGas: byAddr[addr.toLowerCase()], total: txs.reduce((s, t) => s + t.gas, 0), txs: txs.length,
    maxTx: Math.max(...txs.map((t) => t.gas)) };
  assert.ok(report.deploy.maxTx <= TX_CAP, 'every deploy transaction under the EIP-7825 cap');
  for (let looks = 0; looks < 16; looks++) for (let tier = 0; tier <= 5; tier++) {
    const s = await art.hamster(looks, tier), i = looks * 6 + tier;
    assert.equal(s.length, EXP.svgLen[i]); assert.equal(sha(s), EXP.svgSha[i], `hamster(${looks}, ${tier}) is the reference`);
    assert.ok(!/["\\]/.test(s), 'no double quote or backslash');
    frags[`${looks}_${tier}`] = s;
  }
  const iface = new ethers.Interface(ABI);
  for (const [l, t, what] of [[7, 5, 'gold, all 3 items'], [15, 3, 'circuit, all 3 items, grin (longest)'], [0, 1, 'plain Common']]) {
    const data = iface.encodeFunctionData('hamster', [l, t]);
    report.call[`${l}_${t}`] = { what, estimateGas: Number(await provider.estimateGas({ to: addr, data })), bytes: frags[`${l}_${t}`].length };
  }
} finally { stop(); }
console.log('deploy', JSON.stringify(report.deploy));
console.log('call', JSON.stringify(report.call));

// ---------------------------------------------------------------- 3: Chrome
const tpl = fs.readFileSync(path.join(ROOT, 'wheel/page.template.html'), 'utf8');
const a = tpl.indexOf('  const [BW, BH, CW, CH] = ART.size'), b = tpl.indexOf('  // head-and-shoulders crop');
assert.ok(a > 0 && b > a, 'composite() found in the page template');
const composite = tpl.slice(a, b);
const SKINKEY = /SKINKEY = (\[[^\]]*\])/.exec(tpl)?.[1] || assert.fail('SKINKEY not found in the page template');
const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff">
<script>${fs.readFileSync(path.join(ROOT, 'wheel/engine.js'), 'utf8')}</script>
<script>
const ART = ${fs.readFileSync(path.join(ROOT, 'wheel/art/art.json'), 'utf8')};
const FR = ${JSON.stringify(frags)};
const SKINKEY = ${SKINKEY};
// ---- from wheel/page.template.html, verbatim ----
${composite}
// ---- end ----
const svgImg = (frag) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej;
  i.src = 'data:image/svg+xml;base64,' + btoa("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 448 600' width='448' height='600'>" + frag + '</svg>'); });
const px = (src, sx, sy) => { const c = mk(448, 600), g = c.getContext('2d'); g.drawImage(src, sx, sy, 448, 600, 0, 0, 448, 600); return g.getImageData(0, 0, 448, 600).data; };
function diff(p, q) {           // on premultiplied values (colour under alpha 0 does not matter), 0..255
  let max = 0, sum = 0, n2 = 0, n8 = 0, opaque = 0;
  for (let i = 0; i < p.length; i += 4) {
    const ap = p[i + 3], aq = q[i + 3]; let m = Math.abs(ap - aq);
    for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(p[i + c] * ap - q[i + c] * aq) / 255);
    if (m > max) max = m; sum += m; if (m > 2) n2++; if (m > 8) n8++; if (ap > 0) opaque++;
  }
  return { max: Math.round(max * 10) / 10, mean: Math.round(sum / (p.length / 4) * 1e4) / 1e4, over2: n2, over8: n8, visible: opaque };
}
async function run() {
  const rows = [], keep = {};
  for (let tier = 1; tier <= 5; tier++) for (let looks = 0; looks < 16; looks++) {
    const want = px(await composite(looks, tier - 1), 0, ${12});
    const img = await svgImg(FR[looks + '_' + tier]); await new Promise((r) => requestAnimationFrame(r));
    const got = px(img, 0, 0);
    const row = Object.assign({ looks, tier }, diff(want, got));
    if (looks & 7) { const nm = await svgImg(FR[looks + '_' + tier].replace(/ mask='url\\(#[^)]*\\)'/, '')); row.noMask = diff(want, px(nm, 0, 0)); }
    rows.push(row); keep[looks + '_' + tier] = { img, cv: await composite(looks, tier - 1) };
  }
  window.__keep = keep;
  return rows;
}
// side by side: page composite | wallet-style SVG | |difference| x 16 (red), at scale s
async function pairs(list, s) {
  const W = 448 * s, H = 600 * s, c = mk(3 * W, list.length * H), g = c.getContext('2d');
  g.fillStyle = '#e8e4dc'; g.fillRect(0, 0, c.width, c.height);
  list.forEach(([l, t], r) => {
    const k = window.__keep[l + '_' + t];
    g.drawImage(k.cv, 0, 12, 448, 600, 0, r * H, W, H); g.drawImage(k.img, W, r * H, W, H);
    const p = px(k.cv, 0, 12), q = px(k.img, 0, 0), d = new ImageData(448, 600);
    for (let i = 0; i < p.length; i += 4) { let m = Math.abs(p[i + 3] - q[i + 3]); for (let ch = 0; ch < 3; ch++) m = Math.max(m, Math.abs(p[i + ch] * p[i + 3] - q[i + ch] * q[i + 3]) / 255);
      d.data[i] = 255; d.data[i + 1] = d.data[i + 2] = 255 - Math.min(255, m * 16); d.data[i + 3] = 255; }
    const dc = mk(448, 600); dc.getContext('2d').putImageData(d, 0, 0); g.drawImage(dc, 2 * W, r * H, W, H);
  });
  return c.toDataURL('image/png');
}
</script>
<div id="wallet" style="display:grid;grid-template-columns:repeat(16,112px);gap:4px;padding:4px;background:#1b2654;width:max-content"></div>`;
const harness = path.join(OUT, 'harness.html');
fs.writeFileSync(harness, html);

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await page.setViewport({ width: 1900, height: 800, deviceScaleFactor: 1 });
  await page.goto('file://' + harness, { waitUntil: 'load', timeout: 60000 });
  report.render = await page.evaluate(() => run());
  const png = async (name, expr) => fs.writeFileSync(path.join(OUT, name), Buffer.from((await page.evaluate(expr)).split(',')[1], 'base64'));
  await png('pairs.png', () => pairs([[0, 1], [7, 5], [15, 3], [6, 2], [9, 4], [13, 5]], 0.5));
  await png('pair-7-5-full.png', () => pairs([[7, 5]], 1));
  // the wallet view: 80 <img> elements, one per looks (columns) x tier 1..5 (rows)
  await page.evaluate(() => {
    const w = document.getElementById('wallet');
    for (let t = 1; t <= 5; t++) for (let l = 0; l < 16; l++) {
      const i = document.createElement('img'); i.width = 112; i.height = 150; i.title = l + '/' + t;
      i.src = 'data:image/svg+xml;base64,' + btoa("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 448 600'>" + FR[l + '_' + t] + '</svg>'); w.appendChild(i);
    }
    return Promise.all([...w.querySelectorAll('img')].map((i) => i.decode()));
  });
  await (await page.$('#wallet')).screenshot({ path: path.join(OUT, 'wallet-grid.png') });
  report.errors = errs;
} finally { await browser.close(); }

const worst = report.render.reduce((m, r) => (r.max > m.max ? r : m), report.render[0]);
const ctl = report.render.filter((r) => r.noMask);
report.summary = {
  combos: report.render.length, worstMax: worst.max, worstAt: `${worst.looks}/${worst.tier}`, worstMean: Math.max(...report.render.map((r) => r.mean)),
  pixelsOver2: report.render.reduce((s, r) => s + r.over2, 0), pixelsOver8: report.render.reduce((s, r) => s + r.over8, 0),
  controlNoMaskMinMax: Math.min(...ctl.map((r) => r.noMask.max)), controlNoMaskMinOver8: Math.min(...ctl.map((r) => r.noMask.over8)),
};
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
console.log('render', JSON.stringify(report.summary), 'errors', report.errors.length ? report.errors : 'none');
console.log('out', OUT);
// Chrome on 5 Nov: worst 2.5 of 255 (rounding on antialiased edges), 4 pixels over 2 in all 80, none over 8; without
// the mask every dressed look is off by 124+ on 173+ pixels
assert.deepEqual(report.errors, [], 'no page errors');
assert.equal(report.summary.combos, 80);
assert.ok(report.summary.worstMax <= 4 && report.summary.pixelsOver8 === 0, 'every SVG renders as the page composite');
assert.ok(report.summary.controlNoMaskMinOver8 > 50, 'the comparison sees the erase cut-outs');
