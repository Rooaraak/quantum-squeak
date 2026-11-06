// Browser tests of the built Quantum Catch page (puppeteer + Chrome, one short browser per scenario: a cron kills old Chrome
// processes).   node wheel/test/page.test.cjs [shots dir]      (on a shared box, run it under the heavy-job lock)
// Tool paths: PUPPETEER_PATH / CHROME / ANVIL, else wheel/test/local.json (not in git), else require('puppeteer') + PATH.
// Network: the page is served from 127.0.0.1 (with results.json next to it); Google Fonts are always aborted, the status API
// is mocked (RUNNING) or aborted, the Sepolia RPC is mocked (recorded-style answers) or aborted, like the claude.ai preview.
// The game since 6 Nov (owner): no picking. Casting a net = minting its test NFT (R6'); a net costs 0.01 test SQK, burned
// (QuantumCatch v2); a daily faucet gives one net's worth; one of the chip's 4,000 drops is the net's, drawn on-chain once the
// night is posted. The first screen tonight: the quantum computer, the mystery hamster, the deck and the prizes; the 16 tiles
// only on a night with data (practice, past nights, a result and its replay) (owner, 6 Nov 15:25).
// Every wallet scenario runs on a LOCAL anvil chain (chain id 11155111, never a public network) with the REAL v2 contracts from
// the forge build (QC_ARTIFACT=<out>/QuantumCatch.sol/QuantumCatch.json, else contracts/out; the same out/ holds MockSqk and
// SqkFaucet): QuantumCatch v2 + a mock test SQK (permit + burn, the real token's errors) + SqkFaucet, and a minimal
// window.ethereum shim (an unlocked anvil account, or an impersonated one for reads). The chain is the record: casts (permit,
// approve fallback), the faucet, a net cast elsewhere, the lock, and the hatcher's posts that draw each net's drop (casters
// whose drop lands on the wanted spot are found BEFORE they cast with the contract's own pure drawOf). Scenarios without a
// wallet read the public Sepolia RPC, which is mocked (SqueekCore) or forwarded to the local anvil (rpcUrl). Without anvil or
// the v2 build the run FAILS, unless QW_NO_CHAIN=1 is set on purpose (then every chain scenario is listed as skipped).
// Tiers on the page are checked against the Python reference wheel/test/tier_ref.py (the owner's rank rule). Console errors count as failures, except the
// "Failed to load resource" lines of the deliberately aborted requests; every page error is fatal.
// Clock: Date.now() starts at a fixed moment per scenario (default Thu 5 Nov 2026 17:30 UTC); time zone Europe/Ljubljana
// (UTC+1), locale en-GB, so "your time" is 22:00 for the 21:00 UTC lock.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');
const LOCAL = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'local.json'), 'utf8')); } catch (e) { return {}; } })();
const puppeteer = require(process.env.PUPPETEER_PATH || LOCAL.puppeteer || 'puppeteer');
const QW = require('../engine.js'), QC = require('../catch.js');

const ROOT = path.join(__dirname, '..', '..');
const REF = JSON.parse(execFileSync('python3', [path.join(__dirname, 'tier_ref.py')], { encoding: 'utf8', maxBuffer: 64 << 20 }));
const refOf = (job) => { const x = REF.real.find((r) => r.job_id === job); assert.ok(x, `${job} in the Python reference`); return x; };
const PAGE = process.env.QW_PAGE || path.join(__dirname, '..', 'out', 'quantum-catch.html');
const SHOTS = process.argv[2] || path.join(__dirname, '..', 'out', 'shots');
const CHROME = process.env.CHROME || LOCAL.chrome || undefined;
const ANVIL = process.env.ANVIL || LOCAL.anvil || 'anvil';
fs.mkdirSync(SHOTS, { recursive: true });
const html = fs.readFileSync(PAGE), RESULTS = fs.readFileSync(path.join(path.dirname(PAGE), 'results.json'));
const DATA = JSON.parse(html.toString().match(/const DATA = (\{.*?\});\n/s)[1]);
const DAYS = Object.keys(DATA.nights).sort(), NEWEST = DAYS[DAYS.length - 1];
const T0 = Date.parse('2026-11-05T17:30:00Z');
const KEY = 'quantum-catch-v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-page-'));
const BANNED_FIRST = /mod 16|TVD|total variation|ghost copies step|\bdials?\b|0x[0-9a-f]{4}|qubit|π/i;
// the result card: the reward and ONE plain line about the night; the distances and "how much closer" live in How it works
const BANNED_REVEAL = /×|closer|quantum ghost|normal hamster|tonight/i;

// the page as visitors get it: the site's index.html (tools/export-public.sh) and the claude.ai artifact both put the built
// page (it starts with its <meta charset> line) under a doctype and a viewport meta, so Chrome lays it out in STANDARDS mode
// (CSS1Compat; the raw page alone would be quirks mode, about 8 px higher on a phone). Every scenario is served like that.
const standard = (body) => {
  const s = Buffer.isBuffer(body) ? body.toString('utf8') : String(body), i = s.indexOf('\n');
  assert.ok(s.startsWith('<meta charset'), 'the built page starts with its <meta charset> line');
  return '<!doctype html>\n<html lang="en">\n<head>\n' + s.slice(0, i) + '\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' + s.slice(i + 1);
};
function serve(body, resultsBody) {
  body = standard(body);
  return new Promise((res) => {
    const s = http.createServer((q, r) => {
      if (q.url === '/favicon.ico') { r.writeHead(204); return r.end(); }
      if (q.url.split('?')[0] === '/results.json') { if (resultsBody == null) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': 'application/json' }); return r.end(resultsBody); }
      if (q.url !== '/') { r.writeHead(404); return r.end(); }
      r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(body);
    }).listen(0, '127.0.0.1', () => res(s));
  });
}

const ONLY = process.env.QW_ONLY ? process.env.QW_ONLY.split(',') : null;      // QW_ONLY=lock,resolve runs just those
async function scenario(name, o, body) {
  if (ONLY && !ONLY.includes(name)) return;
  const { width, height, scheme = 'light', api = 'mock', fast = true, noStorage = false, page = html, at = T0, storage = null, rpc = null, rpcUrl = null, wallet = null, random = null } = o;
  const t0 = Date.now(), srv = await serve(page, 'results' in o ? o.results : RESULTS);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=en-GB'] });
  const kill = setTimeout(() => { browser.close().catch(() => {}); }, 100000);
  const errors = [], aborted = new Set(), rpcLog = [];
  try {
    const p = await browser.newPage();
    p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() !== 'error') return; const u = (m.location() && m.location().url) || ''; if (/Failed to load resource/.test(m.text()) && ([...aborted].some((a) => u.startsWith(a)) || /results\.json/.test(u))) return; errors.push('console: ' + m.text() + ' @ ' + u.slice(0, 80)); });
    await p.setRequestInterception(true);
    p.on('request', (r) => {
      const u = r.url();
      if (u.startsWith('http://127.0.0.1')) return r.continue();
      if (u.startsWith('https://api.squeekchain.com/') && api === 'mock') {
        const b = { measurement: { observedAt: new Date(at + (Date.now() - t0) - 5000).toISOString(), freshness: 'online', staleAfterSeconds: 120, speedMmPerSecond: 312 } };   // in the page's clock
        return r.respond({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify(b) });
      }
      if (u.startsWith('https://ethereum-sepolia-rpc.publicnode.com') && (rpc || rpcUrl)) {
        if (r.method() === 'OPTIONS') return r.respond({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' } });
        const q = JSON.parse(r.postData()); rpcLog.push(q.method === 'eth_call' ? q.params[0].data : q.method);
        if (rpcUrl) {          // the public Sepolia RPC = the local anvil chain (read-only calls: catch.js allows nothing else)
          fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: r.postData() }).then((x) => x.text())
            .then((b) => r.respond({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: b }), () => r.abort());
          return;
        }
        let out; try { out = { jsonrpc: '2.0', id: q.id, result: rpc(q.params[0].to, q.params[0].data) }; } catch (e) { out = { jsonrpc: '2.0', id: q.id, error: { code: -32000, message: e.message } }; }
        return r.respond({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify(out) });
      }
      aborted.add(u.split('?')[0].replace(/[^/]*$/, '')); aborted.add(u); r.abort();
    });
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    await p.emulateTimezone('Europe/Ljubljana');
    await (await p.target().createCDPSession()).send('Emulation.setLocaleOverride', { locale: 'en-GB' });
    p.__mobile = width < 640;          // a phone: touch, no hover; kept on every resize in the scenario (a change would reload the page)
    await p.setViewport({ width, height, deviceScaleFactor: 1, isMobile: p.__mobile, hasTouch: p.__mobile });
    await p.evaluateOnNewDocument((fast, noStorage, at, storage, KEY, wallet, random) => {
      if (fast) window.__QW_FAST = 1;
      if (random != null) Math.random = () => random;          // the practice net's draw, fixed for the test
      const real = Date.now.bind(Date), off = at - real(); Date.now = () => real() + off;     // the fixed moment, then time flows
      if (noStorage) Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('storage blocked'); } });
      else if (storage && !sessionStorage.getItem('qc-preset')) { localStorage.setItem(KEY, JSON.stringify(storage)); sessionStorage.setItem('qc-preset', '1'); }
      if (wallet) {      // a browser wallet for the page: one anvil account, Sepolia selected, everything else to the local node
        window.__walletLog = []; window.__sent = [];
        const script = (wallet.send || []).slice();      // how the user answers each transaction prompt: 'reject' | 'hold' (until __releaseSend()) | default yes
        let connected = wallet.connected !== false;      // false: eth_accounts is empty until the page asks (eth_requestAccounts)
        window.ethereum = { request: async ({ method, params }) => {
          window.__walletLog.push(method);
          if (method === 'eth_sendTransaction' && script.length) {
            const k = script.shift();
            if (k === 'reject') { const e = new Error('User rejected the request.'); e.code = 4001; throw e; }
            if (k === 'hold') await new Promise((r) => { window.__releaseSend = r; });
          }
          if (method === 'eth_sendTransaction') window.__sent.push([String(params[0].to).toLowerCase(), params[0].data]);
          // a wallet that cannot sign typed data (then catch.js approves exactly the cost first)
          if (method === 'eth_signTypedData_v4' && wallet.sign === 'unsupported') { const e = new Error('The requested method is not supported by this Ethereum provider.'); e.code = 4200; throw e; }
          if (method === 'eth_requestAccounts') { connected = true; return [wallet.account]; }
          if (method === 'eth_accounts') return connected ? [wallet.account] : [];
          if (method === 'eth_chainId') return '0xaa36a7';
          if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
          const r = await fetch(wallet.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] }) });
          const j = await r.json(); if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; } return j.result;
        } };
      }
    }, fast, noStorage, at, storage, KEY, wallet, random);
    await p.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: 'load' });
    await p.waitForFunction(() => window.QCP && document.querySelectorAll('.spot').length === 16, { timeout: 15000 });
    assert.equal(await p.evaluate(() => document.compatMode), 'CSS1Compat', 'standards mode, as the site and the artifact serve the page');
    await sleep(600);
    const shot = (n, full) => p.screenshot({ path: path.join(SHOTS, `${name}-${n}.png`), fullPage: !!full });
    const noHScroll = async (where) => { const [sw, cw] = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]); assert.ok(sw <= cw, `${where}: horizontal scroll ${sw} > ${cw}`); };
    await body(p, { shot, noHScroll, rpcLog });
    assert.deepEqual(errors, [], 'console/page errors');
    results.push(['ok', name, ((Date.now() - t0) / 1000).toFixed(1) + 's']);
  } catch (e) {
    results.push(['FAIL', name, e.message + (errors.length ? ' | ' + errors.join(' | ') : '')]);
  } finally { clearTimeout(kill); await browser.close().catch(() => {}); srv.close(); }
}

// ---------- helpers that run in the page ----------
const vp = (p, width, height) => p.setViewport({ width, height, deviceScaleFactor: 1, isMobile: p.__mobile, hasTouch: p.__mobile });
const txt = (p, sel) => p.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());
const hidden = (p, sel) => p.$eval(sel, (e) => e.hidden || getComputedStyle(e).display === 'none');
const stored = (p) => p.evaluate((KEY) => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return 'blocked'; } }, KEY);
const scrollTo = (p, sel) => p.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'start' }), sel);
const box = (p, sel) => p.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, h: r.height, docTop: r.top + scrollY }; }, sel);
const visible = async (p, sel, h) => { const b = await box(p, sel); return b.h > 0 && b.top >= 0 && b.bottom <= h; };
const revealed = (p, t = 40000) => p.waitForFunction(() => !QCP.playing && !document.getElementById('reveal').hidden, { timeout: t });
const firstScreenText = (p) => p.evaluate(() => document.querySelector('.hero').innerText + '\n' + document.getElementById('play').innerText);
const items = (p, sel) => p.$$eval(sel, (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
const dl = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const short = (d) => dl(d).replace(/^\w+ /, '');
// what a hamster was that night (the strip word): its tier, or got away (chip noise)
const wordOf = (x, s) => (x.tiers[s] ? QW.TIER_NAMES[x.tiers[s] - 1] : 'got away');
const NUMS = [...Array(16).keys()].map(String);
// the practice net's draw (Math.random fixed): the value that makes the page draw the first of the chip's drops on `spot`
function drawFor(test, d = NEWEST) {
  const c = DATA.chips[d], T = QW.ringTurn(DATA.nights[d].rounds.map((r) => r[1])), i = c.shots_in_order.findIndex((p, k) => test(QW.spotOf(p, T), k));
  assert.ok(i >= 0, 'a drop for the practice'); return { random: (i + 0.5) / c.shots_in_order.length, spot: QW.spotOf(c.shots_in_order[i], T) };
}
// the roster after a reveal: every tile's tier, its strip word (Python reference), only the number in its tag
async function rosterIs(p, x, where) {
  const R = await p.$$eval('.spot', (e) => e.map((b) => [b.dataset.spot, b.dataset.tier, b.querySelector('.tag').textContent.trim(), b.querySelector('.lnd b').textContent.trim(), b.querySelector('.lnd').dataset.t]));
  R.forEach(([sp, t, tag, w, wt], i) => {
    assert.equal(+sp, i); assert.equal(+t, x.tiers[i] - 1, `${where} spot ${i}: data-tier`); assert.equal(tag, String(i), `${where} spot ${i}: the tag is the number`);
    assert.equal(w, wordOf(x, i), `${where} spot ${i}: the word`); assert.equal(+wt, x.tiers[i] - 1, `${where} spot ${i}: the word's tier`);
  });
}

// the practice net (one tap, fast mode) up to the result: returns the drawn spot
async function practice(p) {
  assert.equal(await txt(p, '#act'), 'Cast a practice net · free');
  await p.click('#act'); await revealed(p); await sleep(300);
  const st = await p.evaluate(() => QCP.store().practice);
  assert.equal(st.drop, true, 'a practice net is a drop too'); return st.spot;
}
// casting tonight's net = minting its NFT through the (anvil) wallet, in one click; resolves once the net is recorded
async function castNft(p, day = '2026-11-05') {
  await p.waitForFunction(() => document.getElementById('act').textContent === 'Cast a net · 0.01 test SQK', { timeout: 15000 });
  await p.click('#act');
  await p.waitForFunction((day) => { try { const n = JSON.parse(localStorage.getItem('quantum-catch-v1')).nets[day]; return !!(n && n.nft); } catch (e) { return false; } }, { timeout: 30000 }, day);
  await sleep(200);
}
// watch mode (no wallet, or no contract in the build): one plain line and the faucet link instead of the cast button; a build
// whose config says a net costs test SQK (the real one and the anvil ones) adds one more line about the test SQK
const WATCH = 'To catch, open this page in a browser with a crypto wallet (e.g. MetaMask) on the free Sepolia test network. Get free test ETH.';
const FAUCET = 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia';
// (the real build until the v2 switch has no faucet: then no "free daily from this page"; the anvil builds have one)
async function watchMode(p, paid = true, faucet = false) {
  assert.ok(await hidden(p, '#act'), 'no cast button without a wallet');
  assert.ok(!(await hidden(p, '#watch')), 'the watch line instead');
  assert.equal(await txt(p, '#watch'), WATCH + (!paid ? '' : faucet ? ' You also need 0.01 test SQK (free daily from this page).' : ' You also need 0.01 test SQK.'));
  assert.equal(await hidden(p, '#watchsqk'), !paid);
  assert.equal(await p.$eval('#faucet', (e) => e.href), FAUCET);
}
// the free practice net: under Past nights, on the newest night the chip has looked at (R3: not the first screen)
async function openPractice(p) {
  await p.click(`#nights button[data-day="${NEWEST}"]`); await sleep(250);
  assert.equal(await p.evaluate(() => QCP.stage), NEWEST, 'Past nights opens the practice night');
}
// a 4-step tour for the screenshots (no wallet: watch mode): first screen, practice result, tonight's net with the countdown,
// How it works open
async function tour(p, { shot, noHScroll }) {
  await noHScroll('first screen');
  assert.equal(await p.evaluate(() => QCP.stage), 'tonight', "a first visit opens on tonight's net (R3)");
  await watchMode(p);
  await shot('1-first-screen');
  await openPractice(p);
  const s = await practice(p);
  await p.evaluate(() => document.getElementById('play').scrollIntoView({ block: 'start' })); await sleep(250);
  await shot('2-practice-result');
  assert.equal(await txt(p, '#act'), "See tonight's net", 'no wallet: nothing to cast, so the next step only shows tonight');
  await p.click('#act'); await sleep(300);
  assert.equal(await p.evaluate(() => QCP.stage), 'tonight');
  assert.ok(await rosterHidden(p), "tonight's screen: no tiles");
  await watchMode(p);
  await p.evaluate(() => document.getElementById('play').scrollIntoView({ block: 'start' })); await sleep(250);
  await shot('3-tonight-watch');
  await p.click('#how > summary'); await sleep(200);
  await scrollTo(p, '#how'); await sleep(250);
  await shot('4-how-it-works');
  await noHScroll('how it works open');
  return s;
}
// the 16 tiles are not on tonight's screen (owner, 6 Nov 15:25: "Why do we need this"): the roster block (heading, legend,
// tiles, caption) is not displayed; the tiles stay in the DOM for the replay
const rosterHidden = (p) => p.evaluate(() => getComputedStyle(document.querySelector('#play .pick')).display === 'none' && document.getElementById('ring').getBoundingClientRect().height === 0);
// the first screen tonight: the computer, the mystery hamster, the ONE action (or the line in its place) and the prizes
// (`prizes`: '#prizes' = heading, the 5 skins and the odds line; '#prow' = the row of skins) fit, no scrolling, no tiles
async function fits(p, h, action, prizes = '#prizes') {
  assert.equal(await p.evaluate(() => window.scrollY), 0, 'nothing scrolled');
  assert.ok(await rosterHidden(p), 'no tiles on the first screen');
  const fit = await p.evaluate((a, z) => ['#core', '#ham', a, z].map((q) => { const r = document.querySelector(q).getBoundingClientRect(); return [q, Math.round(r.top), Math.round(r.bottom)]; }), action, prizes);
  for (const [q, t, b] of fit) assert.ok(t >= 0 && b <= h && b > t, `${q} on the first screen (${t}-${b} in ${h})`);
  assert.ok(fit[2][2] <= fit[3][1], `the prizes right under ${action}`);
}

// a synthetic "next night" for the results.json tests: his 4 Nov rounds + the real v1.2 re-run of 4 Nov, relabelled `day`
// (default 5 Nov), added to `base` (a results.json body; default the build's).
// tamper: 'counts' (counts that do not match the shots), 'first' (first_shot claims the Epic spot, the shots say otherwise),
// 'legendary' (a valid night whose first shot IS on the Epic spot 7: the order of the shots changed, nothing else)
function nextNightResults(tamper, day = '2026-11-05', base = RESULTS.toString()) {
  const R = JSON.parse(fs.readFileSync(path.join(ROOT, 'quantum', 'wheel-2026-11-04-ibm_marrakesh-dbmbr0hkbkrc73cp7u8g.json'), 'utf8'));
  const n4 = DATA.nights['2026-11-04'], k = Math.round((Date.parse(day) - Date.parse('2026-11-04')) / 864e5);
  const night = { core: n4.core, genesis: n4.genesis, firstRound: n4.firstRound + 144 * k, lastRound: n4.lastRound + 144 * k, rounds: n4.rounds, recipe: 'v1.2', steps: R.steps };
  const chip = { night: day, core: n4.core, rounds: n4.rounds, steps: R.steps, backend: R.backend, job_id: R.job_id, wheel_shots: R.wheel_shots, wheel_2q_gates: R.wheel_2q_gates,
    counts: R.counts.slice(), shots_in_order: R.shots_in_order.slice(), twin: R.twin, quantum_seconds: null, dd_twirl: true, created: new Date(Date.parse(day) + 864e5 + 8 * 36e5).toISOString().replace('.000', ''), recipe: 'v1.2' };
  const T = QW.ringTurn(n4.rounds.map((r) => r[1]));                     // 9: the Epic spot 7 is position 14
  if (tamper === 'legendary') { const i = chip.shots_in_order.indexOf(14); [chip.shots_in_order[0], chip.shots_in_order[i]] = [chip.shots_in_order[i], chip.shots_in_order[0]]; }
  chip.first_shot = QW.spotOf(chip.shots_in_order[0], T);
  if (tamper === 'counts' || tamper === true) chip.counts[0] += 5;
  if (tamper === 'first') chip.first_shot = 7;
  const J = JSON.parse(base);
  J.nights[day] = night; J.chips[day] = chip;
  const perSpot = QW.turned(chip.counts, T), turns = n4.rounds.reduce((a, r) => a + r[1], 0);
  return { body: JSON.stringify(J), night, chip, perSpot, turns, tiers: QW.tiers(perSpot, turns, chip.steps.length, chip.first_shot) };
}
// the night as the hatcher posts it to QuantumCatch (post_night.mjs): landings per SPOT, his turns, the steps, the spot of the
// chip's first shot, the IBM job id (ASCII, zero-padded) and a sha256 of the result (here: of the synthetic chip record)
const jobHex = (j) => Buffer.from(j, 'ascii').toString('hex').padEnd(64, '0');
const postOf = (X) => ({ perSpot: X.perSpot, turns: X.turns, steps: X.night.steps.length, first: X.chip.first_shot, job: jobHex(X.chip.job_id), sha: crypto.createHash('sha256').update(JSON.stringify(X.chip)).digest('hex') });
const SLEPT_POST = { perSpot: new Array(16).fill(0), turns: 0, steps: 0, first: 0, job: '0'.repeat(64), sha: '0'.repeat(64) };

// SqueekCore answers for the live "tonight so far" read: his 5 Nov night starts at round 242 (12:00 UTC); round 297 starts at
// 21:10 UTC; settled through round 303 (ends 22:20 UTC = 23:20 in Ljubljana); rounds after that are unknown
const pad = (x) => BigInt(x).toString(16).padStart(64, '0');
const SOFAR = [[297, 120], [298, 300], [300, 450]];
function fakeCore(to, data) {
  assert.equal(to, DATA.core.address);
  if (data === QC.enc.state()) return '0x' + [303, 0, 0, 0, 0, 0, 0, 0].map(pad).join('');
  if (data === QC.enc.roundPage(241, 303, 16)) {
    let w = 5000; const words = [];
    for (const [id, t] of SOFAR) { w += t; words.push(pad(id), pad(w), pad(0), pad(0), pad(0)); }
    return '0x' + [pad(32), pad(303), pad(5000), pad(0), pad(0), pad(w), pad(0), pad(0), pad(8 * 32), pad(SOFAR.length)].join('') + words.join('');
  }
  throw new Error('unexpected call ' + data.slice(0, 10));
}

// ---------- a local anvil chain with the REAL v2 contracts (QuantumCatch v2 + a mock test SQK + the SqkFaucet) ----------
const QC_JSON = process.env.QC_ARTIFACT || path.join(ROOT, 'contracts/out/QuantumCatch.sol/QuantumCatch.json');
const OUTDIR = path.resolve(path.dirname(QC_JSON), '..');
const MOCK_JSON = path.join(OUTDIR, 'MockSqk.sol/MockSqk.json'), FAUCET_JSON = path.join(OUTDIR, 'SqkFaucet.sol/SqkFaucet.json');
const POST_SIG = 'postNight(uint32,uint16[16],uint32,uint8,bytes32,bytes32,uint8)', DRAW_SIG = 'drawOf(uint32,bytes32,bytes32,uint256,uint16[16])';
const CENT = 10n ** 16n;                                                  // 0.01 test SQK: a net's cost and the faucet's drip
let anvilSkip = 'no anvil';
// the build must be the v2 game (castNet() without a spot, the paid cast, the draw) and its 3-argument faucet: never an older one
function v2Problem() {
  for (const f of [QC_JSON, MOCK_JSON, FAUCET_JSON]) if (!fs.existsSync(f)) return `no contract build at ${f} (forge build in contracts/, or QC_ARTIFACT)`;
  const ids = JSON.parse(fs.readFileSync(QC_JSON, 'utf8')).methodIdentifiers;
  for (const sig of ['castNet()', 'castNetWithPermit(uint256,uint8,bytes32,bytes32)', 'NET_COST()', 'SQK()', POST_SIG, DRAW_SIG]) if (!ids[sig]) return `the build at ${QC_JSON} is not the v2 game (no ${sig})`;
  if (ids['castNet(uint8)']) return `the build at ${QC_JSON} still takes a spot (castNet(uint8))`;
  const fc = (JSON.parse(fs.readFileSync(FAUCET_JSON, 'utf8')).abi.find((x) => x.type === 'constructor') || { inputs: [] }).inputs.map((x) => x.type).join(',');
  if (fc !== 'address,uint256,address') return `the SqkFaucet build at ${FAUCET_JSON} is not one claim per net night (constructor (${fc}))`;
  return null;
}
// a page built for the local chain: its QuantumCatch, the mock SQK and the faucet in DATA.config (build.py's test flags)
function buildFor(catchAddr, sqk, faucet, name) {
  const page = path.join(tmp, name);
  execFileSync('python3', [path.join(ROOT, 'wheel/build.py'), '--catch-address', catchAddr, '--sqk-address', sqk, '--faucet-address', faucet, '--out', page], { encoding: 'utf8' });
  return fs.readFileSync(page);
}
async function startAnvil() {
  try { execFileSync(ANVIL, ['--version'], { stdio: 'ignore' }); } catch (e) { anvilSkip = 'no anvil'; return null; }
  const bad = v2Problem(); if (bad) { anvilSkip = bad; return null; }
  const port = 19000 + (process.pid % 1000), url = `http://127.0.0.1:${port}`;
  const proc = spawn(ANVIL, ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '11155111', '--timestamp', String(T0 / 1000), '--accounts', '20', '--silent'], { stdio: 'ignore' });
  let id = 0;
  const rpc = async (method, params = []) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) }); const j = await r.json(); if (j.error) throw Object.assign(new Error(j.error.message), { data: j.error.data }); return j.result; };
  for (let i = 0; ; i++) { try { await rpc('eth_chainId'); break; } catch (e) { if (i > 100) { proc.kill(); anvilSkip = 'anvil did not start'; return null; } await sleep(100); } }
  try {
    const receipt = async (h) => { for (let i = 0; i < 200; i++) { const rc = await rpc('eth_getTransactionReceipt', [h]); if (rc) return rc; await sleep(30); } throw new Error('no receipt'); };
    const send = async (from, to, data) => { const rc = await receipt(await rpc('eth_sendTransaction', [{ from, to, data }])); assert.equal(rc.status, '0x1', `tx ${data.slice(0, 10)} from ${from} failed`); return rc; };
    const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest']);
    const deploy = async (from, file, args = '') => {
      const rc = await receipt(await rpc('eth_sendTransaction', [{ from, data: JSON.parse(fs.readFileSync(file, 'utf8')).bytecode.object + args, gas: '0x1c9c380' }]));
      if (rc.status !== '0x1' || (await rpc('eth_getCode', [rc.contractAddress, 'latest'])) === '0x') throw new Error(`the deploy of ${path.basename(file)} failed on anvil`);
      return rc.contractAddress.toLowerCase();
    };
    // the chain's clock: forward only (a block at that time, unless the chain is already past it)
    const at = async (ms) => { const b = await rpc('eth_getBlockByNumber', ['latest', false]); const t = Math.floor(ms / 1000); if (Number(b.timestamp) < t) { await rpc('evm_setNextBlockTimestamp', ['0x' + t.toString(16)]); await rpc('evm_mine'); } };
    const impersonate = async (a) => { await rpc('anvil_impersonateAccount', [a]); await rpc('anvil_setBalance', [a, '0x56bc75e2d63100000']); };
    const acc = (await rpc('eth_accounts')).map((a) => a.toLowerCase()), hatcher = acc[0], deployer = acc[19];
    const ids = JSON.parse(fs.readFileSync(QC_JSON, 'utf8')).methodIdentifiers, mids = JSON.parse(fs.readFileSync(MOCK_JSON, 'utf8')).methodIdentifiers;
    const sqk = await deploy(deployer, MOCK_JSON);                                                         // the mock test SQK ("Squeek", v1)
    const address = await deploy(deployer, QC_JSON, pad(hatcher) + pad(0) + pad(sqk) + pad(CENT));         // QuantumCatch(hatcher, no art, SQK, 0.01)
    const faucet = await deploy(deployer, FAUCET_JSON, pad(sqk) + pad(CENT) + pad(address));               // SqkFaucet(SQK, DRIP 0.01, the game)
    const free = await deploy(deployer, QC_JSON, pad(hatcher) + pad(0) + pad(0) + pad(0));                 // a free game (no SQK): the build/contract mismatch
    const A = {
      post: (n, x) => '0x' + ids[POST_SIG] + pad(n) + x.perSpot.map(pad).join('') + pad(x.turns) + pad(x.steps) + x.job + x.sha + pad(x.first),
      draw: (n, x, tokenId) => '0x' + ids[DRAW_SIG] + pad(n) + x.sha + x.job + pad(tokenId) + x.perSpot.map(pad).join(''),
      mint: (to, v) => '0x' + mids['mint(address,uint256)'] + pad(to) + pad(v),
      transfer: (to, v) => '0x' + mids['transfer(address,uint256)'] + pad(to) + pad(v),
      totalSupply: '0x' + mids['totalSupply()'],
    };
    const sqkOf = async (a) => QC.dec.uint(await call(sqk, QC.enc.balanceOf(a)));
    const supply = async () => QC.dec.uint(await call(sqk, A.totalSupply));
    await send(deployer, sqk, A.mint(faucet, 500n * 10n ** 18n));                                              // the faucet: 500 test SQK
    const ch = { proc, url, rpc, send, call, at, impersonate, A, sqkOf, supply, accounts: acc, hatcher, sqk, faucet, address, free };
    // a net cast outside the page (the test's own transactions; anvil impersonates any address): approve exactly the cost, castNet()
    ch.castDirect = async (a, mint = true) => { if (mint) await send(deployer, sqk, A.mint(a, CENT)); await send(a, sqk, QC.enc.approve(address, CENT)); await send(a, address, QC.enc.castNet()); return QC.netId(QC.dec.uint(await call(address, '0x' + ids['openNight()'])), a); };
    // a caster whose net for night n draws `spot` once x is posted (the contract's own pure drawOf, BEFORE the cast)
    let nextCaster = 1;
    ch.casterFor = async (n, x, spot) => {
      for (let k = 0; k < 20000; k++) {
        const a = '0x' + 'ca57' + (nextCaster++).toString(16).padStart(36, '0');
        if (Number(QC.dec.uint(await call(address, A.draw(n, x, QC.netId(n, a))))) === spot) { await impersonate(a); return a; }
      }
      throw new Error(`no caster draws spot ${spot}`);
    };
    ch.post = (n, x) => send(hatcher, address, A.post(n, x));
    ch.html = buildFor(address, sqk, faucet, 'v2.html');
    ch.freeHtml = buildFor(free, sqk, faucet, 'v2-free.html');
    return ch;
  } catch (e) { proc.kill('SIGTERM'); anvilSkip = 'the v2 setup failed on anvil: ' + e.message; return null; }
}

// a slept night in results.json (no rounds: he did not run), added to `base`
function sleptNightResults(day = '2026-11-05', base = RESULTS.toString()) {
  const n4 = DATA.nights['2026-11-04'], J = JSON.parse(base), k = Math.round((Date.parse(day) - Date.parse('2026-11-04')) / 864e5);
  J.nights[day] = { core: n4.core, genesis: n4.genesis, firstRound: n4.firstRound + 144 * k, lastRound: n4.lastRound + 144 * k, rounds: [], recipe: 'v1.2', steps: [], slept: true };
  return JSON.stringify(J);
}

const ALLOWED_WALLET = ['eth_requestAccounts', 'eth_accounts', 'eth_chainId', 'eth_call', 'eth_getBalance', 'eth_getBlockByNumber', 'eth_sendTransaction', 'eth_getTransactionReceipt', 'eth_signTypedData_v4', 'wallet_switchEthereumChain', 'wallet_addEthereumChain'];
const PRESET = (nets = {}) => ({ practice: { day: NEWEST, spot: 15, at: 1, seen: true }, nets });     // an old picked practice, seen
const asked = (p) => p.evaluate(() => window.__walletLog.filter((m) => m === 'eth_sendTransaction' || m === 'eth_requestAccounts' || m === 'eth_signTypedData_v4'));
const count = (p, m) => p.evaluate((m) => window.__walletLog.filter((x) => x === m).length, m);
const N5 = QC.nightOfDay('2026-11-05'), N6 = QC.nightOfDay('2026-11-06'), N7 = QC.nightOfDay('2026-11-07');
const ME = '0x' + '5a'.repeat(20), T5 = QC.netId(N5, ME), SCENT = String(CENT);     // (a made-up wallet for the scenarios without a chain)
const DROP5 = (spot = null) => ({ drop: true, spot, at: 1, seen: false, nft: { tokenId: T5, day: '2026-11-05', image: null } });
// a drop net in this browser: the night's net NFT of wallet a, its hamster not known yet
const DROP = (day, a) => ({ drop: true, spot: null, at: 1, seen: false, nft: { tokenId: QC.netId(QC.nightOfDay(day), a), day, image: null } });
const PAID_HINT = 'Plus a little Sepolia test ETH for the fee. Test tokens: no value. One net per wallet per night.';      // the button says the price
const FAUCET_HINT = 'Free test SQK from this page: 0.01 per wallet per day, enough for one net. You also need a little Sepolia test ETH for the fee.';
// no test SQK yet: an expected first step, a plain line (not a red error) under the faucet button that takes the cast button's place
const NO_SQK_WORDS = "This wallet has no test SQK yet. Tap the button to get today's free 0.01 (one transaction), then cast. Nothing was sent.";
const NOT_WIRED = 'A net costs 0.01 test SQK (burned). Casting opens soon; until then try a free practice net under Past nights.';
const CAST_BTN = ['Cast a net · 0.01 test SQK', 'burned · Sepolia test network'];
// every line #nftmsg showed, in order (the wallet steps pass quickly)
const watchMsgs = (p) => p.evaluate(() => { window.__msgs = []; const e = document.getElementById('nftmsg'); new MutationObserver(() => { const t = e.textContent; if (t && window.__msgs[window.__msgs.length - 1] !== t) window.__msgs.push(t); }).observe(e, { childList: true, characterData: true, subtree: true }); });
const sqkRead = (p, f) => p.waitForFunction(f, { timeout: 15000 });

// the cast with a wallet that signs typed data (the permit path, real v2 on anvil): ONE signature + ONE transaction
// (castNetWithPermit), exactly 0.01 test SQK burned; the first screen (stage, button, prizes; no tiles) fits; the net recorded
// under the chain's night as a DROP (its hamster unknown until the night is posted); survives a reload; comes back from the
// chain when this browser forgot it
async function nftCastScenario(chain, name, viewport, account) {
  await scenario(name, { ...viewport, page: chain.html, storage: PRESET(), wallet: { account, rpc: chain.url } }, async (p, { shot, noHScroll }) => {
    assert.equal(await p.evaluate(() => QCP.stage), 'tonight', 'a seen practice: the first screen is tonight');
    assert.equal(await p.evaluate(() => QCP.paid), true, 'the build says a net costs test SQK');
    await sqkRead(p, () => QCP.sqk.balance != null);
    const q0 = await p.evaluate(() => QCP.sqk);
    assert.deepEqual([q0.cost, q0.sqk, q0.balance, q0.drip, q0.claimed, q0.who], [SCENT, chain.sqk, String(5n * CENT), SCENT, false, account],
      'read from the chain (QC.sqkInfo through the wallet, read-only): the cost, the token, this wallet, the faucet');
    assert.equal(q0.faucetLeft, String(await chain.sqkOf(chain.faucet)), 'what the faucet holds');
    assert.ok(await hidden(p, '#watch'), 'a wallet and the contract: no watch line');
    assert.deepEqual(await p.$eval('#act', (e) => [e.hidden, e.disabled, e.textContent, e.dataset.sub]), [false, false, ...CAST_BTN], 'one button, ready: nothing to pick first');
    assert.equal(await txt(p, '#nfthint'), PAID_HINT);
    assert.equal(await p.$$eval('.spot[aria-pressed], .spot.sel, .spot.net', (e) => e.length), 0, 'no picker: no pressed or selected tile');
    // the button's price never breaks inside ("CAST A NET · 0.01 TEST / SQK"): a long label wraps after the dot
    assert.equal(await p.$eval('#act .nw', (e) => [e.textContent, e.getClientRects().length].join(' ')), '0.01 test SQK 1', 'the price on one line');
    if (viewport.width <= 400) {
      await fits(p, viewport.height, '#act', '#prow');                // 360x740: the stage, the button and the row of prizes
      await vp(p, 390, 844); await sleep(250);
      await fits(p, 844, '#act');                                     // the owner's phone (390x844): all of the prizes too
      await shot('0-390x844');
      await vp(p, viewport.width, viewport.height); await sleep(250);
    }
    assert.deepEqual(await asked(p), [], 'the page asks the wallet nothing on its own');
    assert.equal((await stored(p)).nets['2026-11-05'], undefined, 'nothing saved before the cast');
    await noHScroll('nft ready'); await shot('1-ready');
    const bal0 = await chain.sqkOf(account), sup0 = await chain.supply();
    await watchMsgs(p);
    await p.click('#act');
    await p.waitForFunction(() => !document.getElementById('nftbox').hidden, { timeout: 30000 });
    const want = QC.netId(N5, account), st = await stored(p), n = st.nets['2026-11-05'];
    assert.deepEqual([n.drop, n.spot, n.seen], [true, null, false], 'a drop: its hamster is unknown until the chip has dropped and the night is posted');
    assert.equal(n.nft.tokenId, want, 'token id = (night << 160) | wallet, from the NetCast log');
    assert.equal(n.nft.day, '2026-11-05');
    // the chain: one permit signature, one castNetWithPermit, exactly 0.01 test SQK burned, the game keeps nothing
    const log = await p.evaluate(() => window.__walletLog);
    for (const m of log) assert.ok(ALLOWED_WALLET.includes(m), `never asks for ${m}`);
    assert.ok(log.includes('eth_getBalance'), 'the public RPC is blocked here: the wallet\'s own read-only balance check');
    assert.deepEqual([await count(p, 'eth_signTypedData_v4'), await count(p, 'eth_sendTransaction')], [1, 1], 'one click: ONE signature (the permit) + ONE transaction');
    assert.deepEqual((await p.evaluate(() => window.__sent)).map(([to, d]) => [to, d.slice(0, 10)]), [[chain.address, QC.SEL.castNetWithPermit]], 'the transaction: castNetWithPermit on the game');
    assert.deepEqual([bal0 - (await chain.sqkOf(account)), sup0 - (await chain.supply()), await chain.sqkOf(chain.address)], [CENT, CENT, 0n], 'exactly 0.01 test SQK left the wallet and was burned');
    const msgs = await p.evaluate(() => window.__msgs);
    for (const m of ['Checking your test SQK…', 'Sign in your wallet: let your net burn exactly the test SQK it costs (a signature, no fee)…', 'Confirm the one transaction in your wallet: your net (0.01 test SQK, burned), plus the Sepolia test fee.'])
      assert.ok(msgs.includes(m), `the step "${m}" (${JSON.stringify(msgs)})`);
    assert.ok(!msgs.some((m) => /approve/i.test(m)), 'no approve step');
    assert.match(await p.$eval('#nftimg', (e) => e.src), /^data:image\/svg\+xml;base64,/);
    assert.equal(await txt(p, '#nfttext'), 'Your net is in: a test NFT on Sepolia (no money value), night of Thu 5 Nov. It shows your catch (or "got away") once the chip\'s result is posted.');
    assert.ok(await hidden(p, '#act') && await hidden(p, '#nfthint'), 'nothing more to press for this net');
    assert.ok(await p.$eval('#nftbox', (e) => !!e.closest('#actions')), 'the minted net sits where the button was');
    assert.match(await txt(p, '#prompt'), /^Tomorrow 13:00 the quantum computer decides\.Nets close at 22:00 your time \(in 3 h \d\d min\)\. He usually starts between 22:10 and 22:40\. His night ends Fri 13:00 your time, then IBM's chip drops 4,000 times: one drop is yours\.$/);
    assert.deepEqual([await txt(p, '#stamp'), await txt(p, '#platek'), await txt(p, '#platen')], ['Your net is in', 'Your catch', '?'], 'the stage: your net is in, the mystery hamster');
    assert.deepEqual(await items(p, '#platew li'), ['decided', 'tomorrow 13:00']);
    assert.ok(await rosterHidden(p), 'waiting for the chip: still no tiles');
    assert.equal(await txt(p, '#tnstate'), 'Your net is in: tomorrow 13:00 the quantum computer decides which hamster it catches. A test NFT on Sepolia.');
    await sqkRead(p, () => QCP.sqk.balance === '40000000000000000');      // read again after the cast: 0.01 less
    await p.waitForFunction(() => !document.getElementById('nftnets').hidden, { timeout: 15000 });
    assert.match(await txt(p, '#nftgrid'), /waiting for the chip.*#\?/, 'the chain: waiting, no hamster yet');
    await p.evaluate(() => document.getElementById('play').scrollIntoView({ block: 'start' })); await sleep(200);
    await noHScroll('nft minted'); await shot('2-net-in');
    // remembered after a reload; and when this browser forgot it, the chain gives it back (still a drop: unknown hamster)
    await p.reload({ waitUntil: 'load' }); await p.waitForFunction(() => window.QCP, { timeout: 15000 }); await sleep(400);
    assert.equal(await p.evaluate(() => QCP.stage), 'tonight');
    assert.match(await txt(p, '#prompt'), /^Tomorrow 13:00 the quantum computer decides\./);
    assert.equal(await p.$eval('#mycountn', (e) => e.textContent), '1', 'the practice catch (a net is not a catch yet)');
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'load' }); await p.waitForFunction(() => window.QCP, { timeout: 15000 });
    await p.waitForFunction(() => /^Tomorrow 13:00 the quantum computer decides/.test(document.getElementById('prompt').textContent), { timeout: 15000 });
    const back = (await stored(p)).nets['2026-11-05'];
    assert.deepEqual([back.drop, back.spot, back.nft.tokenId], [true, null, want], 'read back from the chain (QuantumCatch result + tokenURI): not posted, so no hamster yet');
    assert.ok(!(await hidden(p, '#nftbox')), 'with its picture');
    assert.deepEqual(await asked(p), [], 'reading it back asks nothing');
  });
}

// the wallet's errors (real v2): it says no to the transaction (plain line, the button comes back, nothing stored, nothing
// burned), then yes; while the wallet is asking the button is locked
async function nftErrorScenario(chain, name, viewport, account) {
  await scenario(name, { ...viewport, page: chain.html, storage: PRESET(), wallet: { account, rpc: chain.url, send: ['reject', 'hold'] } }, async (p, { shot }) => {
    await sqkRead(p, () => QCP.sqk.balance != null);
    const bal0 = await chain.sqkOf(account);
    await p.click('#act');
    await p.waitForFunction(() => document.getElementById('nftmsg').classList.contains('err'), { timeout: 30000 });
    assert.equal(await txt(p, '#nftmsg'), 'You said no in your wallet. Nothing was sent.');
    assert.deepEqual(await p.$eval('#act', (e) => [e.hidden, e.disabled, e.textContent]), [false, false, CAST_BTN[0]], 'the button is usable again');
    assert.equal((await stored(p)).nets['2026-11-05'], undefined, 'no transaction, no net (no local-only nets)');
    assert.equal(await chain.sqkOf(account), bal0, 'a signed permit alone moves nothing');
    assert.ok((await box(p, '#nftmsg')).top >= (await box(p, '#act')).bottom, 'the wallet line right under the button');
    await shot('1-said-no');
    await p.click('#act');
    await p.waitForFunction(() => typeof window.__releaseSend === 'function', { timeout: 30000 }); await sleep(100);
    assert.deepEqual(await p.$eval('#act', (e) => [e.disabled, e.textContent]), [true, 'Casting your net…'], 'busy');
    assert.equal(await txt(p, '#nftmsg'), 'Confirm the one transaction in your wallet: your net (0.01 test SQK, burned), plus the Sepolia test fee.');
    await p.click('#act'); await sleep(100);
    assert.equal(await count(p, 'eth_sendTransaction'), 2, 'a second tap while the wallet asks sends nothing more');
    await shot('2-wallet-asking');
    await p.evaluate(() => window.__releaseSend());
    await p.waitForFunction(() => !document.getElementById('nftbox').hidden, { timeout: 30000 });
    const st = await stored(p);
    assert.deepEqual([st.nets['2026-11-05'].drop, st.nets['2026-11-05'].spot], [true, null]);
    assert.equal(st.nets['2026-11-05'].nft.tokenId, QC.netId(N5, account));
    assert.ok(await hidden(p, '#nftmsg'), 'the error is gone');
    assert.deepEqual([await count(p, 'eth_signTypedData_v4'), await count(p, 'eth_sendTransaction')], [2, 2], 'a permit per try; the refused prompt and the real one');
    assert.equal(bal0 - (await chain.sqkOf(account)), CENT, 'one net paid');
  });
}

(async () => {
  const ref4 = refOf(DATA.chips[NEWEST].job_id);
  const EPIC4 = drawFor((s) => ref4.tiers[s] === 4);                                  // a practice drop on the Epic of 4 Nov (spot 11)
  const NOISE4 = drawFor((s) => !ref4.reach[s]);                                       // a practice drop on chip noise (out of reach)
  // 1. phone, light, no wallet (watch mode): the first screen (no picking), the practice net at REAL speed, tonight's net with
  //    the countdown, How it works
  await scenario('phone-light', { width: 360, height: 740, scheme: 'light', fast: false, random: EPIC4.random }, async (p, { shot, noHScroll }) => {
    await noHScroll('start');
    await p.waitForFunction(() => !document.getElementById('live').hidden, { timeout: 10000 });
    assert.match(await txt(p, '#live'), /LIVE · RUNNING/);
    assert.equal(await p.title(), 'Quantum Catch');
    assert.equal(await txt(p, '.hero h1'), 'Quantum Catch');
    assert.equal(await txt(p, '.lede'), "Squeektoshi's run programs a real quantum computer. Catch the hamster it lands on.");
    const pw = await p.evaluate(() => { const b = document.getElementById('powered'), r = b.getBoundingClientRect(); return { t: b.textContent.trim(), href: b.getAttribute('href'), top: r.top, shown: r.height > 0 }; });
    assert.equal(pw.t, "Powered by Squeektoshi's real wheel on Squeekchain"); assert.equal(pw.href, 'https://squeekchain.com'); assert.ok(pw.shown && pw.top < 60, 'near the top');
    // the first screen: the quantum computer over a MYSTERY hamster, the plate, one action (here the watch line) and the
    // prizes; no tiles (owner, 6 Nov 15:25), no picking, no math
    assert.equal(await p.evaluate(() => QCP.stage), 'tonight', "a first visit opens on tonight's net");
    assert.equal(await txt(p, '.headline'), 'A real quantum computer decides which hamster you catch.');
    assert.equal(await txt(p, '#stageh'), "Tonight's net", 'the section\'s (hidden) heading');
    assert.ok(await rosterHidden(p), 'no tiles tonight: nothing is known about tonight\'s 16 hamsters');
    assert.ok(await hidden(p, '#srcbadge'), 'no badge tonight');
    assert.match(await txt(p, '#prompt'), /^Nets close 22:00 tonight · result tomorrow after 13:00He usually starts 22:10–22:40 · closes in 3 h (29|30) min$/, 'R9: the clock line');
    assert.ok(!BANNED_FIRST.test(await firstScreenText(p)), 'no math words on the first screen');
    await watchMode(p);                                        // the real build has the contract (and a net costs test SQK); no wallet here
    assert.ok(await hidden(p, '#reveal'));
    assert.equal(await p.$$eval('.spot[aria-pressed], .spot.sel, .spot.net', (e) => e.length), 0, 'no picker');
    assert.deepEqual([await txt(p, '#platek'), await txt(p, '#platen'), await p.evaluate(() => document.getElementById('ham').dataset.spot)], ['Your catch', '?', ''], 'the mystery hamster');
    assert.ok(await p.$eval('#platen', (e) => e.previousElementSibling.hidden), 'no "No." before the \'?\': nothing to choose');
    assert.deepEqual(await items(p, '#platew li'), ['decided', 'tomorrow 13:00']);
    assert.equal(await txt(p, '#plateb'), 'Nets close 22:00 tonightOne net per wallet');
    assert.deepEqual([await txt(p, '#lcdn'), await txt(p, '#lcdk'), await txt(p, '#lcd2')], ['4,000', 'drops', 'tomorrow 13:00 · 1 is yours'], 'LCD: 4,000 DROPS · TOMORROW 13:00 · 1 IS YOURS');
    assert.equal(await txt(p, '#chipline'), `Last night's chip: ${DATA.chips[NEWEST].backend}`);
    assert.equal(await p.$eval('#mycountn', (e) => e.textContent), '0');
    // the prizes: the five skins with last night's chance of each (a tier's share of the drops)
    const by = [0, 0, 0, 0, 0]; ref4.tiers.forEach((t, s) => { if (t) by[t - 1] += ref4.counts[s]; });
    assert.deepEqual(await items(p, '.prz b'), QW.TIER_NAMES);
    // a tier with no drops last night says why: Legendary (the first drop was not on the Epic) = about the Epic share squared per net
    assert.equal(by[4], 0, '4 Nov: no Legendary');
    const e4 = (by[3] + by[4]) / 4000, inN = Number((1 / (e4 * e4)).toPrecision(2));
    assert.deepEqual(await items(p, '.prz .po'), [...by.slice(0, 4).map((x) => QW.pctText(x / 4000)), inN < 1000 ? `~1 in ${inN.toLocaleString('en-US')}` : 'rare']);
    assert.ok(!(await items(p, '.prz .po')).includes('0%'), 'no prize reads 0%');
    const noise4 = ref4.counts.reduce((a, c, s) => a + (ref4.tiers[s] ? 0 : c), 0);
    assert.equal(await txt(p, '#podds'), `Chance = share of the drops last night (${short(NEWEST)}). Legendary = the Epic hamster when the chip's very first drop lands on it too. Got away (chip noise): ${QW.pctText(noise4 / 4000)}`);
    // without a wallet: the watch line in the action's place, then the row of prizes (as with a wallet, R53: at 360x740 the
    // odds line with the Legendary rule is just below the fold; the owner's 390x844 below shows all of it)
    await fits(p, 740, '#watch', '#prow');
    await shot('1-first-screen');
    await vp(p, 390, 844); await sleep(250);
    await fits(p, 844, '#watch'); await noHScroll('390 px'); await shot('1b-390x844');      // the owner's phone
    await vp(p, 360, 740); await sleep(250);
    assert.equal(await p.evaluate(() => QCP.sel), null); assert.equal((await stored(p)), null, 'nothing saved on the first screen');
    // the free practice net, under Past nights: the newest chip night; the 16 tiles are back (a past night is known), its
    // out-of-reach half greyed
    await openPractice(p);
    assert.ok(!(await rosterHidden(p)), 'a night with data: the 16 tiles');
    assert.equal(await txt(p, '#stageh'), `Practice · night of ${dl(NEWEST)}`);
    assert.equal(await txt(p, '#srcbadge'), 'practice');
    assert.match(await txt(p, '#prompt'), /^Try a free practice net on this night\.IBM's chip already dropped 4,000 times here\. Your practice net gets one of those drops at random, like a real net: one free try\.$/);
    assert.equal(await p.$$eval('.spot.out', (e) => e.length), 8);
    assert.deepEqual(await p.$eval('#act', (e) => [e.textContent, e.dataset.sub]), ['Cast a practice net · free', 'Practice: one free try']);
    assert.ok(await visible(p, '#act', 740), `the one action is on screen (${Math.round((await box(p, '#act')).bottom)})`);
    await p.click('.spot[data-spot="0"]'); await sleep(120);
    assert.match(await txt(p, '#caption'), /^Nobody picks: tap Cast a practice net and one of the chip's drops is yours\.$/);
    assert.equal((await stored(p)), null, 'nothing stored before the cast');
    await shot('1c-practice-ready');
    await p.click('#act'); await sleep(2600);
    assert.ok(await p.evaluate(() => QCP.playing), 'his night is playing');
    assert.ok(!(await hidden(p, '#skip')), 'Skip shown while playing');
    assert.match(await txt(p, '#caption'), /\d\d:\d\d · [\d,]+ turns: a (sprint|steady run|lazy round)/);
    await shot('2a-replay');
    await p.click('#skip'); await revealed(p);
    const night = DATA.chips[NEWEST], counts = QW.turned(night.counts, QW.ringTurn(DATA.nights[NEWEST].rounds.map((r) => r[1])));
    assert.deepEqual(ref4.counts, counts);
    const st = await stored(p); assert.deepEqual([st.practice.day, st.practice.spot, st.practice.seen, st.practice.drop], [NEWEST, 11, true, true], 'the drawn drop: the Epic of 4 Nov');
    assert.equal(EPIC4.spot, 11);
    assert.equal(await txt(p, '#revt'), 'An Epic Crystal hamster!');
    assert.match(await txt(p, '#prompt'), /^You caught an Epic!That was your practice net\./);
    assert.match(await txt(p, '#revs'), /^practice ?Your drop landed on No\. 11 \(.*\), one of the chip's 289 drops there \(7\.2% of 4,000\)\. The rarest catch of the night\.$/);
    assert.equal(await txt(p, '#revq'), 'That night the chip kept the quantum pattern.');
    assert.ok(!BANNED_REVEAL.test(await txt(p, '#reveal')), `no math or jargon on the result card: ${await txt(p, '#reveal')}`);
    assert.equal(await p.$eval('#mycountn', (e) => e.textContent), '1');
    assert.deepEqual(await p.$$eval('.spot.net', (e) => e.map((b) => [b.dataset.spot, b.classList.contains('drop')])), [['11', true]], 'your drop\'s tile, highlighted after the replay');
    assert.deepEqual([await txt(p, '#platen'), await p.evaluate(() => [document.getElementById('ham').dataset.spot, document.getElementById('ham').dataset.tier])], ['11', ['11', '3']], 'the catch on the podium, in its Epic skin');
    await rosterIs(p, ref4, 'revealed 4 Nov');
    assert.deepEqual(await p.$$eval('.spot[data-tier="3"]', (e) => e.map((b) => b.dataset.spot)), ['11'], '4 Nov: spot 11 (the fewest of the 8 catches) is Epic; the first shot was on 15: no Legendary');
    const tagBox = await p.$$eval('.spot .lnd b', (e) => e.map((t) => { const r = t.getBoundingClientRect(), b = t.closest('.spot').getBoundingClientRect(); return [r.left, r.right, b.left, b.right]; }));
    tagBox.forEach(([l, r, bl, br], i) => assert.ok(l >= bl && r <= br + 0.5, `word ${i} inside its tile (${l}-${r} in ${bl}-${br})`));
    await p.click('.spot[data-spot="11"]'); await sleep(100);
    assert.match(await txt(p, '#caption'), /^No\. 11: Epic, 7\.2% of the chip's drops landed here\. The rarest catch of the night\./);
    await p.click('.spot[data-spot="15"]'); await sleep(100);
    assert.match(await txt(p, '#caption'), /^No\. 15: Common, .* The chip's very first drop landed here\./);
    assert.equal(await txt(p, '#act'), "See tonight's net", 'no wallet: the next step only shows tonight (casting needs a wallet)');
    await noHScroll('practice result'); await shot('2-practice-result');
    // tonight's net: closes 21:00 UTC = 22:00 in Ljubljana, 3 h 30 min from 17:30 UTC; without a wallet nothing can be cast
    await p.click('#act'); await sleep(300);
    assert.equal(await p.evaluate(() => QCP.stage), 'tonight');
    assert.equal(await txt(p, '#stageh'), "Tonight's net");
    assert.ok(await rosterHidden(p), 'back on tonight: the tiles go again');
    assert.match(await txt(p, '#prompt'), /^Nets close 22:00 tonight · result tomorrow after 13:00He usually starts 22:10–22:40 · closes in 3 h (29|30) min$/);
    await watchMode(p);
    assert.equal((await stored(p)).nets['2026-11-05'], undefined, 'no local-only nets (R6\')');
    assert.match(await txt(p, '#tnclose'), /^Nets close at 22:00 your time · in 3 h (29|30) min\. He usually starts between 22:10 and 22:40\.$/);
    assert.equal(await txt(p, '#tnstate'), 'No net yet for this night.');
    await p.evaluate(() => document.getElementById('play').scrollIntoView({ block: 'start' })); await sleep(200);
    await shot('3-tonight-watch');
    // How it works: the 4 claw-machine steps, last night's odds, then the night and the per-night quantumness, honestly
    await p.click('#how > summary'); await sleep(200);
    assert.deepEqual(await items(p, '#howsteps > li > b'), ['Cast a net.', 'He runs.', 'The chip drops 4,000 times.', 'One drop is yours.']);
    assert.match(await txt(p, '#howsteps'), /Before nets close at 21:00 UTC \(22:00 your time\)\. A net costs 0\.01 Squeekchain test SQK, which gets burned, and is a test NFT on Sepolia\. One net per wallet per night\. Nobody picks a hamster\./, 'the build says a net costs test SQK (no wallet: the config\'s label; no faucet in this build yet)');
    assert.match(await txt(p, '#howsteps'), /After his night ends \(12:00 UTC, 13:00 your time\) a real IBM quantum computer runs his program 4,000 times\./);
    assert.deepEqual(await p.$$eval('#oddsrows tr', (e) => e.map((r) => [...r.children].map((c) => c.textContent))), [
      ['Legendary', 'none: the first drop was not on the Epic', '0', '0%'], ...[3, 2, 1, 0].map((t) => { const sp = NUMS.filter((s) => ref4.tiers[+s] === t + 1); return [QW.TIER_NAMES[t], sp.map((s) => 'No. ' + s).join(', '), by[t].toLocaleString('en-US'), QW.pctText(by[t] / 4000)]; }),
      ['Got away (chip noise)', NUMS.filter((s) => !ref4.tiers[+s]).map((s) => 'No. ' + s).join(', '), noise4.toLocaleString('en-US'), QW.pctText(noise4 / 4000)]], 'last night\'s odds, from DATA');
    assert.equal(await txt(p, '#rarityline'), "The least-visited spot he could reach is Epic; if the chip's very first look landed there, it is Legendary.");
    assert.equal(await p.$$eval('#cmp rect', (e) => e.length), 48, 'chip / ghost / normal bars for 16 spots');
    const rows = await p.$$eval('#qrows tr', (e) => e.map((r) => r.lastElementChild.textContent));
    assert.deepEqual(rows.slice(0, 7), ['quantum', 'noise', 'noise', 'noise', 'noise', 'quantum', 'quantum']);
    assert.deepEqual(rows.slice(7), ['quantum', 'quantum'], 'the two v1.2 re-runs');
    assert.match(await txt(p, '#qnote'), /^The chip does not beat noise every night\. On 4 of the 7 first nights \(recipe v1\.1, up to 16 steps\) noise won.*Newer nights use a shorter program \(recipe v1\.2: at most 10 steps, plus noise protection\) to keep the quantum pattern\./);
    assert.match(await txt(p, '#cmptext'), /^The chip kept the quantum pattern that night: its landings were 2\.7× closer to the perfect quantum ghost than to a normal hamster\./, 'how much closer: in How it works');
    assert.match(await txt(p, '#checkkv'), /ran on IBM on 5 Nov 2026/, 'the run date of the chip job');
    assert.match(await txt(p, '#howrules'), /^One net per wallet per night, cast before he runs: nets close at 21:00 UTC \(22:00 your time\).*Each net costs 0\.01 Squeekchain test SQK, burned when you cast, and is an NFT on the Sepolia test network/);
    assert.match(await txt(p, '#contract'), /^Each net is a test NFT: QuantumCatch contract 0x[0-9a-f]{40} on Sepolia \(no money value; one net per wallet per night; its catch is drawn on-chain from the night's drops\)\.$/);
    await scrollTo(p, '#how'); await sleep(200); await shot('4-how-it-works');
    assert.equal(await p.$eval('#ghlink', (e) => e.href), DATA.config.repoUrl);
    assert.equal(await p.$eval('#ghfoot', (e) => e.href), DATA.config.repoUrl);
    // remembered after a reload: practice used: the stage opens on tonight's net
    await p.reload({ waitUntil: 'load' }); await p.waitForFunction(() => window.QCP, { timeout: 15000 }); await sleep(400);
    assert.equal(await p.evaluate(() => QCP.stage), 'tonight');
    assert.match(await txt(p, '#prompt'), /^Nets close 22:00 tonight/);
    assert.equal(await p.$eval('#mycountn', (e) => e.textContent), '1');
  });

  // 2. phone, dark: the same four screens
  await scenario('phone-dark', { width: 360, height: 740, scheme: 'dark' }, async (p, ctx) => {
    assert.ok(await p.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches));
    assert.equal(await p.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(7, 11, 26)', 'dark token background');
    await tour(p, ctx);
    await vp(p, 400, 800); await sleep(300); await ctx.noHScroll('400 px');
    await vp(p, 375, 667); await sleep(300); await ctx.noHScroll('375 px');
  });

  // 3. desktop, light: the four screens; the prizes row on the first screen; the Twin Lab inside Check it yourself
  await scenario('desktop-light', { width: 1280, height: 800, scheme: 'light' }, async (p, ctx) => {
    // the PC first screen at 1280x860 (fallback fonts): the stage on the left, the header, deck and prizes on the right (no tiles)
    await vp(p, 1280, 860); await sleep(250);
    assert.ok(await rosterHidden(p), 'no tiles tonight');
    const [stageR, deckL, pwL, stageT, prizeB, actB] = await p.evaluate(() => [document.getElementById('stage').getBoundingClientRect().right, document.getElementById('deck').getBoundingClientRect().left,
      document.getElementById('powered').getBoundingClientRect().left, document.getElementById('stage').getBoundingClientRect().top, document.getElementById('prow').getBoundingClientRect().bottom, document.getElementById('deck').getBoundingClientRect().bottom]);
    assert.ok(stageR <= deckL && stageR <= pwL, `the machine on the left, the header and the deck on the right (${stageR} | ${deckL}, ${pwL})`);
    assert.ok(stageT <= 0.5, 'the computer hangs from the top edge');
    assert.ok(actB <= 860 && prizeB <= 860, `the deck and the prizes on the 1280x860 first screen (${Math.round(actB)}, ${Math.round(prizeB)})`);
    // no tiles on the right: the prizes take their room as cards (skin, tier, skin name, chance), not a strip of 30 px skins
    const prz = await p.$$eval('#prow .prz', (e) => e.map((z) => [Math.round(z.querySelector('canvas').getBoundingClientRect().width), getComputedStyle(z.querySelector('.ps')).display]));
    assert.ok(prz.every(([w, d]) => w >= 60 && d !== 'none'), `the prize cards on the PC flat view (${JSON.stringify(prz)})`);
    await ctx.shot('0-1280x860');
    await vp(p, 1280, 800); await sleep(250);
    await tour(p, ctx);
    await p.click('#nights button[data-day="' + NEWEST + '"]'); await sleep(200);
    assert.equal(await p.evaluate(() => QCP.stage), NEWEST);
    await rosterIs(p, ref4, 'desktop 4 Nov');
    const fit = await p.$$eval('.spot .lnd b', (e) => e.map((t) => { const r = t.getBoundingClientRect(), b = t.closest('.spot').getBoundingClientRect(); return r.right <= b.right + 0.5 && r.left >= b.left; }));
    assert.ok(fit.every(Boolean), `every word fits its 1280 px tile (${fit})`);
    await p.evaluate(() => window.scrollTo(0, 0)); await sleep(150); await ctx.shot('5-revealed-night');
    const W = (x, y, ab) => ((+ab[0] ^ +ab[1]) === (x & y)) ? 1 : 0, C = ['FUR', 'HAT'];
    const chip100 = DATA.twin.pairs.reduce((a, q) => a + q.first.reduce((b, ab) => b + W(C.indexOf(q.a_card), C.indexOf(q.b_card), ab), 0), 0);
    await p.click('#check > summary'); await sleep(150); await scrollTo(p, '#check'); await p.click('#tlab summary'); await sleep(150);
    await p.click('#tplan button[data-t="A"][data-c="1"]');
    assert.equal(await p.$eval('#tplan button[data-t="A"][data-c="1"]', (e) => e.textContent), '1', 'tap flips an answer');
    await p.click('#tplay');
    await p.waitForFunction(() => /of 100/.test(document.getElementById('tcres').textContent), { timeout: 10000 });
    assert.match(await txt(p, '#tres'), /Your plan won 15 of 20/);
    assert.match(await txt(p, '#tcres'), new RegExp(`won ${chip100} of 100`));
    assert.match(await txt(p, '#twinhealth'), /under 79% is thrown out and redone/);
    await sleep(150); await ctx.shot('6-check-it-yourself');
    // narrower PC windows (iPad landscape, small laptops): no sideways scroll, the header (with the sound switch) inside the window
    for (const [w, h] of [[1024, 768], [1100, 800]]) {
      await vp(p, w, h); await p.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
      await ctx.noHScroll(`${w} px`);
      const r = await p.evaluate(() => { const b = document.getElementById('sound').getBoundingClientRect(); return [b.left, b.right, document.documentElement.clientWidth]; });
      assert.ok(r[0] >= 0 && r[1] <= r[2], `${w} px: the sound switch inside the window (${r})`);
      await ctx.shot(`7-${w}`);
    }
  });

  // 4. desktop, dark: the first screen
  await scenario('desktop-dark', { width: 1280, height: 800, scheme: 'dark' }, async (p, { shot, noHScroll }) => { await noHScroll('desktop dark'); await shot('1-first-screen'); });

  // 6. OLD picked nets (cast before 6 Nov) still render and resolve as before, labelled "old net (picked)": a net resolves when its
  //    night's chip result arrives in results.json next to the page (no rebuild); a tampered file is refused
  const NX = nextNightResults(false);
  const S5 = NX.perSpot.indexOf(Math.max(...NX.perSpot)), REFX = refOf(NX.chip.job_id);
  const OLDNET = (spot) => ({ practice: { day: NEWEST, spot: 15, at: 1, seen: true }, nets: { '2026-11-05': { spot, at: 1 } } });
  await scenario('resolve', { width: 375, height: 667, at: Date.parse('2026-11-06T13:00:00Z'), results: NX.body, storage: OLDNET(S5) }, async (p, { shot }) => {
    await p.waitForFunction(() => QCP.stage === '2026-11-05' && !!QCP.data.chips['2026-11-05'], { timeout: 10000 }); await sleep(300);
    assert.equal(await txt(p, '#stageh'), 'Your net · night of Thu 5 Nov');
    assert.match(await txt(p, '#prompt'), new RegExp(`^Your old net \\(picked\\) is on No\\. ${S5}\\. Did the chip find him there\\?`));
    assert.equal(await txt(p, '#act'), 'See if you caught him');
    assert.deepEqual([await txt(p, '#platek'), await txt(p, '#platen')], ['Old net (picked)', String(S5)]);
    assert.deepEqual(await p.$$eval('.spot.net', (e) => e.map((b) => [b.dataset.spot, b.classList.contains('drop')])), [[String(S5), false]], 'the old picked tile, as before');
    assert.equal(await p.$$eval('.spot.out', (e) => e.length), 0, 'no out-of-reach marks before the replay: the result is not spoiled');
    assert.ok(await visible(p, '#act', 667), 'See if you caught him: on screen at 375x667');
    assert.equal(await p.$$eval('#nights button', (e) => e.length), 8, '7 nights shown + tomorrow (the strip keeps the last 7)');
    await p.click('#act'); await revealed(p);
    const tier = QW.TIER_NAMES[REFX.tiers[S5] - 1];
    assert.deepEqual(NX.tiers, REFX.tiers.map((c) => c - 1), 'the relabelled night ranks as its run');
    assert.equal(tier, 'Common');
    assert.match(await txt(p, '#prompt'), new RegExp(`^You caught an? ${tier} hamster!`));
    assert.match(await txt(p, '#revs'), new RegExp(`^old net \\(picked\\) ?Spot ${S5} \\(.*\\): the chip found him there in`));
    await rosterIs(p, REFX, 'resolved 5 Nov');
    assert.equal(await p.$eval('.spot[data-spot="7"] .lnd b', (e) => e.textContent), 'Epic', 'its first shot landed on spot 3: the Epic spot 7 stays Epic');
    assert.equal(await txt(p, '#revq'), 'That night the chip kept the quantum pattern.', 'the v1.2 night kept the pattern');
    assert.equal(await p.$$eval('.spot.out', (e) => e.length), 8, 'after the replay the out-of-reach half is shown');
    assert.equal((await stored(p)).nets['2026-11-05'].seen, true);
    assert.equal(await p.$eval('#mycountn', (e) => e.textContent), '2', 'practice + the real catch');
    assert.match(await txt(p, '#mygrid'), /old net \(picked\)/);
    await shot('1-resolved');
  });
  await scenario('resolve-tampered', { width: 360, height: 740, at: Date.parse('2026-11-06T13:00:00Z'), results: nextNightResults(true).body, storage: OLDNET(S5) }, async (p) => {
    await sleep(800);
    assert.equal(await p.evaluate(() => Object.keys(QCP.data.chips).length), 7, 'a chip result whose counts do not match its shots is refused');
    assert.equal(await p.evaluate(() => QCP.stage), '2026-11-05', 'the net\'s night (his run is in) stays on the first screen');
    assert.match(await txt(p, '#prompt'), new RegExp(`^Your old net \\(picked\\) is on No\\. ${S5}\\.His run is in\\. IBM's chip has not looked yet: come back later`));
    assert.match(await txt(p, '#waiting'), new RegExp(`Thu 5 Nov: your old net \\(picked\\) on No\\. ${S5}, waiting for the chip\\.`));
  });
  await scenario('resolve-tampered-first', { width: 360, height: 740, at: Date.parse('2026-11-06T13:00:00Z'), results: nextNightResults('first').body, storage: OLDNET(7) }, async (p) => {
    await sleep(800);
    assert.equal(await p.evaluate(() => Object.keys(QCP.data.chips).length), 7, 'a first_shot that is not the file\'s own first shot (a faked Legendary) is refused');
    assert.match(await txt(p, '#prompt'), /^Your old net \(picked\) is on No\. 7\.His run is in\./);
  });

  // 6b. Legendary (an old picked net): the same night, but the chip's very first shot landed on the Epic spot 7
  const LG = nextNightResults('legendary');
  await scenario('legendary', { width: 360, height: 740, at: Date.parse('2026-11-06T13:00:00Z'), results: LG.body, storage: OLDNET(7) }, async (p, { shot, noHScroll }) => {
    await p.waitForFunction(() => QCP.stage === '2026-11-05' && !!QCP.data.chips['2026-11-05'], { timeout: 10000 }); await sleep(300);
    assert.equal(LG.chip.first_shot, 7);
    assert.deepEqual(LG.tiers, REFX.tiers.map((c, s) => (s === 7 ? 4 : c - 1)), 'only the Epic spot changes: Legendary');
    await p.click('#act'); await revealed(p);
    assert.equal(await txt(p, '#revt'), 'A Legendary Gold hamster!');
    assert.match(await txt(p, '#prompt'), /^You caught a Legendary hamster!/);
    assert.match(await txt(p, '#revs'), /^old net \(picked\) ?Spot 7 \(.*\): the chip found him there in 6\.3% of its 4,000 looks\. The rarest catch of the night, and the chip's very first drop landed there\.$/);
    assert.deepEqual(await p.$eval('.spot[data-spot="7"]', (e) => [e.dataset.tier, e.querySelector('.lnd b').textContent, getComputedStyle(e.querySelector('.lnd b')).backgroundColor]), ['4', 'Legendary', 'rgb(255, 214, 107)'], 'a gold Legendary word on the roster');
    assert.equal(await p.$$eval('.spot[data-tier="4"]', (e) => e.length), 1, 'one Legendary');
    assert.equal(await p.$$eval('.spot[data-tier="3"]', (e) => e.length), 0, 'and so no Epic that night');
    assert.deepEqual(await p.evaluate(() => { const r = QCP.netResult('2026-11-05', 7); return [r.status, r.h.tier, r.o.tier, r.o.status]; }), ['caught', 4, 5, 1], 'page = contract rule (tier 5)');
    assert.match(await txt(p, '#mygrid'), /Legendary/);
    assert.match(await txt(p, '#mystats'), /rarest: Legendary/);
    await noHScroll('legendary'); await shot('1-legendary');
  });

  // 7. SqueekCore live: "Tonight so far" from settled rounds only (state() then roundPage up to the settled round)
  await scenario('sofar', { width: 360, height: 740, at: Date.parse('2026-11-05T22:30:00Z'), rpc: fakeCore, storage: PRESET() }, async (p, { shot, rpcLog }) => {
    await p.waitForFunction(() => !document.getElementById('sofar').hidden, { timeout: 10000 });
    assert.match(await txt(p, '#sofar'), /^Tonight so far: 3 rounds, 870 turns \(his night of Thu 5 Nov, settled on-chain up to 23:20 your time\)$/);
    assert.deepEqual(rpcLog, [QC.enc.state(), QC.enc.roundPage(241, 303, 16)], 'only settled rounds are asked for');
    assert.equal(await txt(p, '#stageh'), "Tomorrow's net");
    assert.ok(await rosterHidden(p), 'tomorrow\'s net: no tiles');
    assert.equal(await txt(p, '#tnk'), "Tomorrow's net");
    assert.match(await txt(p, '#prompt'), /^Nets close 22:00 tomorrow · result Sat after 13:00/);
    assert.equal(await txt(p, '#lcd2'), 'Sat 13:00 · 1 is yours');
    await scrollTo(p, '#tonight'); await sleep(150); await shot('1-tonight-so-far');
  });

  // 7b. the viewer's net between the 21:00 UTC lock and the chip (a drop, and an old picked one): his run so far next to the
  //     net, tomorrow's net one tap away
  await scenario('running', { width: 360, height: 740, at: Date.parse('2026-11-05T22:30:00Z'), rpc: fakeCore, storage: PRESET({ '2026-11-05': DROP5() }) }, async (p, { shot }) => {
    assert.equal(await p.evaluate(() => QCP.stage), '2026-11-05', 'the running night with the viewer\'s net is the first screen');
    await p.waitForFunction(() => /Tonight so far/.test(document.getElementById('prompt').textContent), { timeout: 10000 });
    assert.equal(await txt(p, '#stageh'), 'Your net · night of Thu 5 Nov');
    assert.equal(await txt(p, '#srcbadge'), 'his night is on');
    assert.match(await txt(p, '#prompt'), /^Your net is in\.Tonight so far: 3 rounds, 870 turns \(settled on-chain up to 23:20 your time\)\. It ends Fri 13:00 your time, then IBM's chip drops 4,000 times: one drop is yours\.$/);
    assert.deepEqual([await txt(p, '#stamp'), await txt(p, '#platen'), await txt(p, '#lcdn')], ['Your net is in', '?', '#??'], 'the mystery hamster');
    assert.equal(await txt(p, '#alt'), "See tomorrow's net", 'no wallet: tomorrow\'s net can be seen, not cast'); assert.ok(await hidden(p, '#act'));
    assert.deepEqual(await p.$$eval('#nights button', (e) => e.map((b) => b.dataset.day)).then((x) => x.slice(-2)), ['2026-11-05', 'tonight'], 'a strip button for the running night');
    assert.match(await txt(p, '#sofar'), /^Tonight so far: 3 rounds, 870 turns \(his night of Thu 5 Nov, settled on-chain up to 23:20 your time\) · your net is in$/);
    assert.ok((await box(p, '#sofar')).top < (await box(p, '#tnh')).top, 'his run so far sits above the next night\'s heading');
    assert.ok(await rosterHidden(p), 'his night is on (not in the page yet): no tiles');
    assert.equal(await p.$$eval('.spot.out, .spot.net', (e) => e.length), 0);
    assert.match(await txt(p, '#waiting'), /Thu 5 Nov: your net, waiting for the chip\./);
    await shot('1-running');
  });
  await scenario('running-old', { width: 360, height: 740, at: Date.parse('2026-11-05T22:30:00Z'), rpc: fakeCore, storage: OLDNET(6) }, async (p) => {
    await p.waitForFunction(() => /Tonight so far/.test(document.getElementById('prompt').textContent), { timeout: 10000 });
    assert.match(await txt(p, '#prompt'), /^Your old net \(picked\) is on No\. 6\.Tonight so far: 3 rounds, 870 turns \(settled on-chain up to 23:20 your time\)\. It ends Fri 13:00 your time, then IBM's chip looks\.$/);
    assert.match(await txt(p, '#sofar'), / · your old net \(picked\) there: No\. 6$/);
    assert.deepEqual([await txt(p, '#platek'), await txt(p, '#platen')], ['Old net (picked)', '6'], 'the old picked net on the plate (no tiles while his night is on)');
    assert.ok(await rosterHidden(p));
  });
  await scenario('morning', { width: 360, height: 740, at: Date.parse('2026-11-06T07:30:00Z'), storage: OLDNET(6) }, async (p) => {
    assert.equal(await p.evaluate(() => QCP.stage), '2026-11-05');
    assert.match(await txt(p, '#prompt'), /^Your old net \(picked\) is on No\. 6\.His night is on\. It ends Fri 13:00 your time, then IBM's chip looks\.$/);
    assert.equal(await txt(p, '#alt'), "See tonight's net");
  });
  await scenario('over-stale', { width: 360, height: 740, at: Date.parse('2026-11-07T19:00:00Z'), storage: PRESET({ '2026-11-05': DROP5() }) }, async (p, { shot }) => {
    assert.equal(await p.evaluate(() => QCP.stage), '2026-11-05');
    assert.equal(await txt(p, '#srcbadge'), 'waiting for the chip');
    assert.match(await txt(p, '#prompt'), /^Your net is in\.His night is over\. IBM's chip has not looked at a night since Wed 4 Nov: nets wait until it does\.$/, 'stale: no "come back later" promise');
    assert.match(await txt(p, '#waiting'), /IBM's chip has not looked at a night since Wed 4 Nov/);
    await shot('1-over-stale');
  });
  await scenario('over-fresh', { width: 360, height: 740, at: Date.parse('2026-11-06T13:00:00Z'), results: null, storage: OLDNET(6) }, async (p) => {
    assert.match(await txt(p, '#prompt'), /^Your old net \(picked\) is on No\. 6\.His night is over\. IBM's chip has not looked yet: come back later to see if you caught him\.$/, 'no stale note 25 h after the newest chip night');
  });

  // 7c. an old picked net on a spot OUT OF REACH that night with 1.4 % of the landings: he got away, as the contract says
  const OUT5 = 2;
  await scenario('resolve-out', { width: 360, height: 740, at: Date.parse('2026-11-06T13:00:00Z'), results: NX.body, storage: OLDNET(OUT5) }, async (p, { shot }) => {
    await p.waitForFunction(() => QCP.stage === '2026-11-05' && !!QCP.data.chips['2026-11-05'], { timeout: 10000 }); await sleep(300);
    assert.equal(NX.perSpot[OUT5], 55); assert.ok(55 * 100 >= 4000, 'by share alone (1.4 %): catchable');
    const rec = { counts: NX.perSpot, shots: 4000, turns: NX.turns, steps: NX.night.steps.length, firstShot: NX.chip.first_shot };
    assert.deepEqual(QC.outcome(rec, OUT5), { status: 2, hits: 55, shots: 4000, tier: 0, reach: 2 }, 'the contract rule: got away');
    assert.equal(await p.$$eval('.spot.out', (e) => e.length), 0, 'no spoiler before the replay');
    await p.click('#act'); await revealed(p);
    assert.match(await txt(p, '#prompt'), /^He got away\./);
    assert.equal(await txt(p, '#revt'), 'He got away.');
    assert.match(await txt(p, '#revs'), new RegExp(`^old net \\(picked\\) ?Spot ${OUT5} was out of reach that night: he could not land there\\. The chip's 55 landings there are its noise\\.$`));
    assert.deepEqual(await p.evaluate((s) => { const r = QCP.netResult('2026-11-05', s); return [r.status, r.o.status, r.o.tier, r.o.reach, r.h.tier]; }, OUT5), ['away', 2, 0, 2, -1]);
    assert.equal(await p.$eval('#mycountn', (e) => e.textContent), '1', 'only the practice catch counts');
    assert.match(await txt(p, '#mygrid'), /Got away.*old net \(picked\)/);
    assert.ok(!/Legendary/.test(await txt(p, '#mygrid')));
    await shot('1-got-away-out-of-reach');
  });

  // ===================== with a wallet: the REAL v2 contracts on a local anvil chain =====================
  // QuantumCatch v2 + the mock test SQK + the SqkFaucet (forge build). Missing = a failed run, unless opted out (QW_NO_CHAIN=1)
  const chain = await startAnvil();
  const NO_CHAIN = !chain && process.env.QW_NO_CHAIN === '1';
  if (!chain) results.push([NO_CHAIN ? 'skip' : 'FAIL', 'chain', `${anvilSkip}: the wallet scenarios cannot run${NO_CHAIN ? ' (QW_NO_CHAIN=1)' : ' (forge build in contracts/, or QC_ARTIFACT; QW_NO_CHAIN=1 skips them on purpose)'}`]);
  if (chain) {
    try {
      const acc = chain.accounts, DEAD = '0x000000000000000000000000000000000000dead';
      // who plays what (anvil's 20 unlocked accounts; 0 = the hatcher, 19 = the deployer): 1 nft-phone-light, 2 nft-phone-dark,
      // 3 nft-desktop, 4 nft-errors, 5 lock, 6-8 short-*, 8 no-address, 10 nft-approve, 11 sqk-faucet, 12 sqk-nosqk,
      // 13 sqk-claimed, 14 already, 15 not-wired. 0.05 test SQK each where the scenario casts with its own SQK
      for (const k of [1, 3, 4, 5, 6, 7, 8, 10, 15]) await chain.send(acc[19], chain.sqk, chain.A.mint(acc[k], 5n * CENT));
      // set up on the 5 Nov net night (the chain's clock: 17:3x UTC), outside the page: a net cast elsewhere (14); today's free
      // SQK claimed and spent elsewhere (13); the casters of the result scenarios, found with drawOf for the 5 Nov post before
      // they cast: a drop on the Epic spot 7, a drop on chip noise (spot 2, out of reach)
      const T14 = await chain.castDirect(acc[14]);
      assert.equal(T14, QC.netId(N5, acc[14]), 'the chain is on the 5 Nov net night');
      await chain.send(acc[13], chain.faucet, QC.enc.claim()); await chain.send(acc[13], chain.sqk, chain.A.transfer(DEAD, CENT));
      const LG6 = nextNightResults('legendary', '2026-11-06', NX.body), SL7 = sleptNightResults('2026-11-07', LG6.body);
      const P5 = postOf(NX), P6 = postOf(LG6);
      const E5 = await chain.casterFor(N5, P5, 7), A5 = await chain.casterFor(N5, P5, OUT5);
      await chain.castDirect(E5); await chain.castDirect(A5);

      // 8. the permit cast (ONE signature + ONE transaction, 0.01 burned): phone (360x740 + the owner's 390x844), desktop; the
      //    wallet's errors
      await nftCastScenario(chain, 'nft-phone-light', { width: 360, height: 740, scheme: 'light' }, acc[1]);
      await nftErrorScenario(chain, 'nft-errors', { width: 360, height: 740, scheme: 'light' }, acc[4]);
      await nftCastScenario(chain, 'nft-desktop', { width: 1280, height: 800, scheme: 'light' }, acc[3]);
      // 8b. a wallet that cannot sign typed data: approve exactly 0.01 (one extra transaction), then castNet()
      await scenario('nft-approve', { width: 360, height: 740, page: chain.html, storage: PRESET(), wallet: { account: acc[10], rpc: chain.url, sign: 'unsupported' } }, async (p, { shot }) => {
        await sqkRead(p, () => QCP.sqk.balance != null);
        assert.deepEqual(await p.$eval('#act', (e) => [e.textContent, e.dataset.sub]), CAST_BTN);
        const bal0 = await chain.sqkOf(acc[10]), sup0 = await chain.supply();
        await watchMsgs(p);
        await p.click('#act');
        await p.waitForFunction(() => !document.getElementById('nftbox').hidden, { timeout: 30000 });
        assert.deepEqual(await p.evaluate(() => window.__sent), [[chain.sqk, QC.enc.approve(chain.address, CENT)], [chain.address, QC.enc.castNet()]], 'approve exactly the cost, then castNet()');
        assert.equal(await count(p, 'eth_signTypedData_v4'), 1, 'asked once: this wallet cannot');
        const msgs = await p.evaluate(() => window.__msgs);
        assert.ok(msgs.includes('Your wallet cannot sign that: approve exactly the test SQK a net costs (one extra transaction)…'), JSON.stringify(msgs));
        assert.deepEqual([bal0 - (await chain.sqkOf(acc[10])), sup0 - (await chain.supply())], [CENT, CENT], '0.01 test SQK burned');
        assert.equal(QC.dec.uint(await chain.call(chain.sqk, QC.enc.allowance(acc[10], chain.address))), 0n, 'nothing left approved');
        assert.equal((await stored(p)).nets['2026-11-05'].nft.tokenId, QC.netId(N5, acc[10]));
        await shot('1-approved-and-cast');
      });

      // 9. no test SQK: today's free 0.01 from the faucet (ONE transaction), then the cast (ONE permit + ONE transaction)
      await scenario('sqk-faucet', { width: 360, height: 740, page: chain.html, storage: PRESET(), wallet: { account: acc[11], rpc: chain.url } }, async (p, { shot }) => {
        await p.waitForFunction(() => /^Get today's free/.test(document.getElementById('act').textContent), { timeout: 15000 });
        assert.deepEqual(await p.$eval('#act', (e) => [e.textContent, e.dataset.sub]), ["Get today's free 0.01 test SQK", 'one transaction · Sepolia test network']);
        assert.equal(await txt(p, '#nfthint'), FAUCET_HINT);
        await fits(p, 740, '#act', '#prow');
        await shot('1-faucet');
        const left0 = await chain.sqkOf(chain.faucet);
        await p.click('#act');
        await p.waitForFunction(() => document.getElementById('act').textContent === 'Cast a net · 0.01 test SQK', { timeout: 30000 });
        assert.equal(await txt(p, '#nftmsg'), '0.01 test SQK is in your wallet. Now cast your net.');
        assert.ok(!(await p.$eval('#nftmsg', (e) => e.classList.contains('err'))));
        assert.deepEqual(await p.evaluate(() => window.__sent), [[chain.faucet, QC.enc.claim()]], 'ONE transaction: claim() on the faucet');
        assert.deepEqual([await chain.sqkOf(acc[11]), left0 - (await chain.sqkOf(chain.faucet))], [CENT, CENT], 'the faucet gave 0.01');
        await shot('2-then-cast');
        await p.click('#act');
        await p.waitForFunction(() => !document.getElementById('nftbox').hidden, { timeout: 30000 });
        assert.deepEqual([await count(p, 'eth_signTypedData_v4'), await count(p, 'eth_sendTransaction')], [1, 2], 'the claim, then one permit + one cast');
        assert.equal(await chain.sqkOf(acc[11]), 0n, 'the free 0.01 was burned by the net');
        assert.equal((await stored(p)).nets['2026-11-05'].nft.tokenId, QC.netId(N5, acc[11]));
        await sqkRead(p, () => QCP.sqk.claimed === true && QCP.sqk.balance === '0');
        await shot('3-net-in');
      });
      // 9b. today's free test SQK already claimed (and spent elsewhere): nothing to press, come back tomorrow
      await scenario('sqk-claimed', { width: 360, height: 740, page: chain.html, storage: PRESET(), wallet: { account: acc[13], rpc: chain.url } }, async (p, { shot }) => {
        await p.waitForFunction(() => !document.getElementById('sqkout').hidden, { timeout: 15000 });
        assert.deepEqual(await p.evaluate(() => [QCP.sqk.balance, QCP.sqk.claimed]), ['0', true], 'the chain: no test SQK, today claimed');
        assert.ok(await hidden(p, '#act') && await hidden(p, '#nfthint') && await hidden(p, '#watch'), 'nothing to press today');
        assert.equal(await txt(p, '#sqkout'), "A net costs 0.01 test SQK and this wallet has none. Today's free 0.01 is already claimed: come back tomorrow.");
        assert.ok(!(await p.$eval('#deckrow', (e) => e.classList.contains('solo'))));
        await fits(p, 740, '#sqkout', '#prow');
        assert.deepEqual(await asked(p), []);
        await shot('1-come-back-tomorrow');
      });
      // 9c. a wallet not connected yet: the cost is known, the balance is not; the cast finds no SQK (NO_SQK: nothing signed or
      //     sent) and the faucet button takes its place
      await scenario('sqk-nosqk', { width: 360, height: 740, page: chain.html, storage: PRESET(), wallet: { account: acc[12], rpc: chain.url, connected: false } }, async (p, { shot }) => {
        await sqkRead(p, () => QCP.sqk.cost === '10000000000000000');
        assert.deepEqual(await p.evaluate(() => [QCP.sqk.who, QCP.sqk.balance]), [null, null], 'no account yet: nothing asked');
        assert.equal(await txt(p, '#act'), CAST_BTN[0]);
        await p.click('#act');
        await p.waitForFunction(() => !document.getElementById('nftmsg').hidden && /test SQK/.test(document.getElementById('nftmsg').textContent), { timeout: 30000 });
        await p.waitForFunction(() => /^Get today's free/.test(document.getElementById('act').textContent), { timeout: 15000 });
        assert.equal(await txt(p, '#nftmsg'), NO_SQK_WORDS);
        assert.ok(!(await p.$eval('#nftmsg', (e) => e.classList.contains('err'))), 'an expected step: not a red error');
        assert.equal((await stored(p)).nets['2026-11-05'], undefined, 'nothing cast');
        assert.deepEqual([await count(p, 'eth_signTypedData_v4'), await count(p, 'eth_sendTransaction')], [0, 0], 'nothing signed, nothing sent');
        await p.waitForFunction((a) => QCP.sqk.who === a, { timeout: 15000 }, acc[12]);      // read again with the account the wallet just gave
        assert.equal(await txt(p, '#nftmsg'), NO_SQK_WORDS, 'still the faucet step once the claim is known');
        await shot('1-no-sqk');
      });
      // 9d. a net this wallet cast elsewhere (another browser): this browser does not know it; the cast finds it on-chain
      //     ('already': nothing signed or sent) and the chain's net takes the button's place
      await scenario('already', { width: 360, height: 740, page: chain.html, storage: PRESET(), wallet: { account: acc[14], rpc: chain.url, connected: false } }, async (p, { shot }) => {
        await sqkRead(p, () => QCP.sqk.cost != null);
        assert.equal(await txt(p, '#act'), CAST_BTN[0], 'this browser knows no net');
        await p.click('#act');
        await p.waitForFunction(() => document.getElementById('nftmsg').classList.contains('err'), { timeout: 30000 });
        assert.equal(await txt(p, '#nftmsg'), 'This wallet already has a net NFT for this night (one per wallet per night).');
        await p.waitForFunction(() => !document.getElementById('nftbox').hidden, { timeout: 15000 });
        assert.equal((await stored(p)).nets['2026-11-05'].nft.tokenId, T14, 'read back from the chain');
        assert.ok(await hidden(p, '#act'), 'no second net');
        assert.deepEqual([await count(p, 'eth_signTypedData_v4'), await count(p, 'eth_sendTransaction')], [0, 0], 'nothing signed, nothing sent');
        await shot('1-already');
      });
      // 9e. the build says a net costs test SQK but its contract takes none (the live page before the v2 switch: the old
      //     contract has no NET_COST()): a plain line instead of a button that could only fail
      await scenario('not-wired', { width: 360, height: 740, page: chain.freeHtml, storage: PRESET(), wallet: { account: acc[15], rpc: chain.url } }, async (p, { shot }) => {
        await p.waitForFunction(() => !document.getElementById('sqkout').hidden, { timeout: 15000 });
        assert.equal(await p.evaluate(() => QCP.sqk.cost), '0', 'the contract: free nets');
        assert.equal(await txt(p, '#sqkout'), NOT_WIRED);
        assert.ok(await hidden(p, '#act') && await hidden(p, '#nfthint'));
        assert.deepEqual(await asked(p), []);
        await shot('1-not-wired');
      });

      // 10. short phones with a wallet: the practice from Past nights, its result, and then tonight's net: each time the ONE
      //     action is fully on screen (the jump brings it into view)
      for (const [w, h, k] of [[375, 667, 6], [390, 664, 7], [360, 640, 8]]) {
        await scenario(`short-${w}x${h}`, { width: w, height: h, page: chain.html, wallet: { account: acc[k], rpc: chain.url } }, async (p, { shot, noHScroll }) => {
          assert.equal(await p.evaluate(() => QCP.stage), 'tonight');
          await p.waitForFunction(() => document.getElementById('act').textContent === 'Cast a net · 0.01 test SQK', { timeout: 15000 });
          assert.ok((await box(p, '#ham')).bottom <= h && (await box(p, '#core')).top >= 0, 'the computer and the mystery hamster on the first screen');
          assert.ok(await rosterHidden(p));
          await scrollTo(p, '#past'); await sleep(100);
          await openPractice(p);
          assert.equal(await txt(p, '#act'), 'Cast a practice net · free');
          assert.ok(await visible(p, '#act', h), `practice: the button on screen after the jump (${JSON.stringify(await box(p, '#act'))})`);
          await shot('1-practice');
          await p.click('#act'); await revealed(p); await sleep(200);
          assert.ok(await visible(p, '#act', h), 'after the result: Now cast tonight\'s net on screen');
          assert.equal(await txt(p, '#act'), "Now cast tonight's net");
          await p.click('#act'); await sleep(300);
          assert.equal(await p.evaluate(() => QCP.stage), 'tonight');
          assert.equal(await txt(p, '#act'), CAST_BTN[0]);
          assert.ok(await visible(p, '#act', h), 'tonight: the cast button on screen after the jump');
          assert.deepEqual(await asked(p), [], 'nothing asked of the wallet');
          await noHScroll('short'); await shot('2-tonight');
        });
      }

      // 11. an old visitor's net, cast locally before R6': still shown (and resolved, see resolve*) as "old net (picked)", nothing sent
      await scenario('nft-phone-dark', { width: 360, height: 740, scheme: 'dark', page: chain.html, storage: PRESET({ '2026-11-05': { spot: 6, at: T0 - 60e3 } }), wallet: { account: acc[2], rpc: chain.url } }, async (p, { shot, noHScroll }) => {
        assert.equal(await p.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(7, 11, 26)');
        assert.equal(await p.evaluate(() => QCP.stage), 'tonight');
        assert.match(await txt(p, '#prompt'), /^Your old net \(picked\) is on No\. 6\./, 'the old local net still shows');
        assert.deepEqual([await txt(p, '#platek'), await txt(p, '#platen')], ['Old net (picked)', '6'], 'on the plate (no tiles tonight)');
        assert.ok(await rosterHidden(p));
        for (const q of ['#act', '#watch', '#nftbox', '#nfthint', '#sqkout']) assert.ok(await hidden(p, q), `${q}: no second net, no "make it an NFT" step`);
        assert.ok(await p.$eval('#deckrow', (e) => e.classList.contains('solo')), 'the LCD takes the whole row');
        assert.equal(await txt(p, '#tnstate'), 'Your old net (picked): No. 6 (glasses + scarf, calm face).');
        assert.deepEqual(await asked(p), [], 'nothing asked');
        await noHScroll('old net'); await shot('1-old-local-net');
      });
      // a build without the contract address: watch mode even with a wallet, and the wallet is never asked anything
      const noAddr = Buffer.from(chain.html.toString().replace(/"catchAddress":"0x[0-9a-f]{40}"/, '"catchAddress":null'));
      assert.ok(!noAddr.equals(chain.html), 'the address was in the config');
      await scenario('no-address', { width: 360, height: 740, page: noAddr, storage: PRESET(), wallet: { account: acc[8], rpc: chain.url } }, async (p) => {
        await watchMode(p, true, true);                 // this build has the faucet
        assert.ok(await hidden(p, '#contract'), 'no contract line in Check it yourself');
        assert.deepEqual(await p.evaluate(() => window.__walletLog), [], 'the wallet is never touched');
      });

      // 12. nets close at 21:00 UTC: a net cast at 20:59:5x stays on 5 Nov; from 21:00 the open net is tomorrow's (6 Nov). The
      //     night a cast lands in is the CHAIN's (block time): its clock is set next to the page's, then past 21:00
      const at = Date.parse('2026-11-05T20:59:50Z');
      await chain.at(at - 10000);
      await scenario('lock', { width: 360, height: 740, at, page: chain.html, storage: PRESET(), wallet: { account: acc[5], rpc: chain.url } }, async (p, { shot }) => {
        assert.equal(await p.evaluate(() => QCP.stage), 'tonight');
        assert.equal(await txt(p, '#stageh'), "Tonight's net");
        await castNft(p);
        assert.ok(await hidden(p, '#act'), 'cast: nothing more to press');
        await p.waitForFunction(() => QCP.win().day === '2026-11-06', { timeout: 15000 }); await sleep(1300);
        assert.equal(await p.evaluate(() => QCP.stage), '2026-11-05', 'after 21:00 UTC the net just locked stays on the first screen');
        assert.equal(await txt(p, '#stageh'), 'Your net · night of Thu 5 Nov');
        assert.match(await txt(p, '#prompt'), /^Your net is in\.Nets are closed\. He usually starts between 22:10 and 22:40 your time\. It ends Fri 13:00 your time, then IBM's chip drops 4,000 times: one drop is yours\.$/);
        assert.equal(await p.$eval('#nights button[aria-pressed="true"]', (e) => e.dataset.day), '2026-11-05', 'a strip button for the net\'s night (not in the page yet)');
        assert.ok(await rosterHidden(p), 'waiting for his night: no tiles');
        assert.match(await txt(p, '#waiting'), /Thu 5 Nov: your net, waiting for the chip\./);
        assert.ok(!(await hidden(p, '#nftbox')), 'the locked net\'s NFT in the deck');
        await shot('0-net-locked');
        assert.equal(await txt(p, '#alt'), "Cast tomorrow's net");
        await p.click('#alt'); await sleep(200);
        assert.equal(await txt(p, '#stageh'), "Tomorrow's net", 'tomorrow\'s net behind the secondary button');
        assert.match(await txt(p, '#prompt'), /^Nets close 22:00 tomorrow · result Sat after 13:00He usually starts 22:10–22:40 · closes in 23 h 59 min$/);
        await chain.at(Date.parse('2026-11-05T21:00:30Z'));
        await castNft(p, '2026-11-06');
        const st = await stored(p); assert.ok(st.nets['2026-11-05'].drop && st.nets['2026-11-06'].drop);
        assert.equal(st.nets['2026-11-06'].nft.tokenId, QC.netId(N6, acc[5]), 'the chain put it on 6 Nov');
        assert.deepEqual([await count(p, 'eth_signTypedData_v4'), await count(p, 'eth_sendTransaction')], [2, 2], 'two nights, two nets: a permit and a cast each');
        await shot('1-after-lock');
      });

      // 13. the night's draw on the real contract: the hatcher posts each night (counts per spot, turns, steps, job id, sha256,
      //     first shot); every net gets ONE of the night's landings (drawOf). First a 6 Nov net drawn on the Epic spot 7 of a
      //     night whose first shot landed there (Legendary), cast now that the chain is past 21:00 UTC
      await chain.at(Date.parse('2026-11-05T21:01:00Z'));
      const L6 = await chain.casterFor(N6, P6, 7);
      assert.equal(await chain.castDirect(L6), QC.netId(N6, L6));
      // the chip has dropped (5 Nov in results.json) but the night is not posted on Sepolia yet: the drop is not known. No
      // wallet: the public Sepolia RPC (here: the local chain)
      await scenario('drop-posting', { width: 360, height: 740, at: Date.parse('2026-11-06T13:00:00Z'), page: chain.html, results: NX.body, storage: PRESET({ '2026-11-05': DROP('2026-11-05', E5) }), rpcUrl: chain.url }, async (p, { shot, rpcLog }) => {
        const want = QC.enc.result(QC.netId(N5, E5));
        for (let i = 0; i < 150 && !rpcLog.includes(want); i++) await sleep(100);
        assert.ok(rpcLog.includes(want), 'result(the net) asked on the public RPC');
        await sleep(400);
        assert.equal(await p.evaluate(() => QCP.stage), '2026-11-05');
        assert.match(await txt(p, '#prompt'), /^The chip has dropped\. Your drop is posted soon\.Your net gets one of its 4,000 drops when the night's result is posted on Sepolia: come back a little later\.$/);
        assert.equal(await txt(p, '#stamp'), 'Drop posted soon');
        const st = await p.evaluate(() => { const a = document.getElementById('stamp').getBoundingClientRect(), b = document.querySelector('.stage').getBoundingClientRect(); return [a.left - b.left, b.right - a.right]; });
        assert.ok(st[0] >= 0 && st[1] >= 0, `the stamp inside the stage (${st})`);
        assert.equal(await txt(p, '#alt'), '▶ Watch his night');
        assert.match(await txt(p, '#waiting'), /Thu 5 Nov: your net, the chip has dropped, your drop is posted soon\./);
        assert.match(await txt(p, '#mygrid'), /Soon.*your drop is posted soon/);
        await shot('1-posting');
        await p.click('#alt'); await revealed(p);
        assert.match(await txt(p, '#revs'), /Your own drop is shown once the result is posted on Sepolia\.$/);
        assert.equal((await stored(p)).nets['2026-11-05'].seen, false, 'watched, not seen: the drop comes later');
        assert.equal(await p.$$eval('.spot.net', (e) => e.length), 0);
      });
      // a 7 Nov net on a night he sleeps through; then the hatcher posts 5, 6 and 7 Nov (8 Nov 12:30 UTC: all three nights are
      // over, all inside the 14-day window)
      await chain.at(Date.parse('2026-11-06T21:01:00Z'));
      const Z7 = '0x' + '51ee9' + '0'.repeat(35); await chain.impersonate(Z7);
      assert.equal(await chain.castDirect(Z7), QC.netId(N7, Z7));
      await chain.at(Date.parse('2026-11-08T12:30:00Z'));
      await chain.post(N5, P5); await chain.post(N6, P6); await chain.post(N7, SLEPT_POST);
      const res = async (n, a) => QC.dec.result(await chain.call(chain.address, QC.enc.result(QC.netId(n, a))));
      assert.deepEqual(await res(N5, E5).then((r) => [r.status, r.spot, r.tier]), [1, 7, 4], 'the contract: E5 caught the Epic No. 7');
      assert.deepEqual(await res(N5, A5).then((r) => [r.status, r.spot, r.tier]), [2, OUT5, 0], 'the contract: A5\'s drop is chip noise, got away');
      assert.deepEqual(await res(N6, L6).then((r) => [r.status, r.spot, r.tier]), [1, 7, 5], 'the contract: L6 caught the Legendary No. 7');
      assert.deepEqual(await res(N7, Z7).then((r) => [r.status, r.spot]), [3, null], 'the contract: he slept');

      // 14. results: caught (Epic; no wallet, the public RPC), got away (chip noise; the wallet reads), Legendary (the chain is
      //     the record: this browser knew nothing), he slept
      await scenario('drop-caught', { width: 360, height: 740, at: Date.parse('2026-11-06T13:00:00Z'), page: chain.html, results: NX.body, storage: PRESET({ '2026-11-05': DROP('2026-11-05', E5) }), rpcUrl: chain.url }, async (p, { shot, noHScroll, rpcLog }) => {
        await p.waitForFunction(() => QCP.stage === '2026-11-05' && QCP.store().nets['2026-11-05'].spot === 7, { timeout: 15000 }); await sleep(300);
        assert.ok(rpcLog.includes(QC.enc.result(QC.netId(N5, E5))), 'the drop read from the contract by its token id (no wallet: the public RPC)');
        assert.equal(await txt(p, '#stageh'), 'Your net · night of Thu 5 Nov');
        assert.match(await txt(p, '#prompt'), /^Your net is in\. Which hamster did your drop land on\?IBM's chip dropped 4,000 times: one drop is yours\. Watch his night to find out\.$/);
        assert.equal(await txt(p, '#act'), 'See what you caught');
        assert.ok(await visible(p, '#act', 740), 'on screen at 360x740');
        assert.ok(!(await rosterHidden(p)), 'a night with its result: the 16 tiles');
        assert.deepEqual([await txt(p, '#platen'), await p.evaluate(() => document.getElementById('ham').dataset.spot)], ['?', ''], 'still a mystery: no spoiler');
        assert.equal(await p.$$eval('.spot.out, .spot.net', (e) => e.length), 0, 'no out-of-reach marks, no tile of yours before the replay');
        assert.match(await txt(p, '#mygrid'), /Ready!.*tap to see/);
        await shot('0-ready');
        await p.click('#act'); await revealed(p);
        assert.deepEqual(await p.$$eval('.spot.net', (e) => e.map((b) => [b.dataset.spot, b.classList.contains('drop')])), [['7', true]], 'YOUR drop\'s tile');
        assert.equal(await txt(p, '#revt'), 'An Epic Crystal hamster!');
        assert.match(await txt(p, '#prompt'), /^You caught an Epic!Your net, night of Thu 5 Nov\.$/);
        assert.match(await txt(p, '#revs'), new RegExp(`^Your drop landed on No\\. 7 \\(.*\\), one of the chip's ${NX.perSpot[7]} drops there \\(${QW.pctText(NX.perSpot[7] / 4000).replace('.', '\\.')} of 4,000\\)\\. The rarest catch of the night\\.$`));
        assert.deepEqual([await txt(p, '#platen'), await p.evaluate(() => [document.getElementById('ham').dataset.spot, document.getElementById('ham').dataset.tier])], ['7', ['7', '3']], 'the catch on the podium in its Epic skin');
        await rosterIs(p, REFX, 'drop 5 Nov');
        assert.equal(await p.$eval('#mycountn', (e) => e.textContent), '2', 'practice + the catch');
        assert.match(await txt(p, '#mygrid'), /^Epic5 Nov · #7IBM chip/);
        assert.equal((await stored(p)).nets['2026-11-05'].seen, true);
        await noHScroll('drop caught'); await shot('1-caught-epic');
      });
      await scenario('drop-away', { width: 360, height: 740, at: Date.parse('2026-11-06T13:00:00Z'), page: chain.html, results: NX.body, storage: PRESET({ '2026-11-05': DROP('2026-11-05', A5) }), wallet: { account: A5, rpc: chain.url } }, async (p, { shot }) => {
        await p.waitForFunction(() => QCP.store().nets['2026-11-05'].spot === 2, { timeout: 15000 }); await sleep(300);
        await p.click('#act'); await revealed(p);
        assert.match(await txt(p, '#prompt'), /^Your hamster got away \(chip noise\)\./);
        assert.equal(await txt(p, '#revt'), 'Your hamster got away (chip noise).');
        assert.equal(await txt(p, '#revs'), 'Your drop landed on No. 2, a spot he could not reach that night: only the chip\'s noise lands there (55 of 4,000 drops).');
        assert.deepEqual(await p.$$eval('.spot.net', (e) => e.map((b) => b.dataset.spot)), ['2']);
        assert.ok(await p.$eval('#ham', (e) => e.classList.contains('away')), 'a shadow on the podium');
        assert.deepEqual([await txt(p, '#platek'), await txt(p, '#platen'), await txt(p, '#plateb')], ['Your drop', '2', 'Night of 5 Novgot away · chip noise']);
        assert.equal(await p.$eval('#mycountn', (e) => e.textContent), '1', 'only the practice catch counts');
        assert.match(await txt(p, '#mygrid'), /Got away.*chip noise/);
        await p.waitForFunction(() => !document.getElementById('nftnets').hidden, { timeout: 15000 });
        assert.match(await txt(p, '#nftgrid'), /got away.*#2/, 'the chain: got away, the drawn spot');
        assert.deepEqual(await asked(p), [], 'reading asks nothing');
        await shot('1-got-away');
      });
      await scenario('drop-legendary', { width: 390, height: 844, at: Date.parse('2026-11-07T13:00:00Z'), page: chain.html, results: LG6.body, storage: PRESET(), wallet: { account: L6, rpc: chain.url } }, async (p, { shot }) => {
        await p.waitForFunction(() => { const n = QCP.store().nets['2026-11-06']; return !!n && n.spot === 7 && QCP.stage === '2026-11-06'; }, { timeout: 15000 }); await sleep(300);
        assert.equal((await stored(p)).nets['2026-11-06'].nft.tokenId, QC.netId(N6, L6), 'this browser knew nothing: the chain is the record');
        await p.click('#act'); await revealed(p);
        assert.equal(await txt(p, '#revt'), 'A Legendary Gold hamster!');
        assert.match(await txt(p, '#prompt'), /^You caught a Legendary!/);
        assert.match(await txt(p, '#revs'), /The rarest catch of the night, and the chip's very first drop landed there\.$/);
        assert.deepEqual(await p.$eval('.spot[data-spot="7"]', (e) => [e.className.includes('net drop'), e.querySelector('.lnd b').textContent, getComputedStyle(e.querySelector('.lnd b')).backgroundColor]), [true, 'Legendary', 'rgb(255, 214, 107)']);
        assert.match(await txt(p, '#mystats'), /rarest: Legendary/);
        // the prizes on a Legendary night (6 Nov is the newest): Epic got no drops (its hamster went Legendary), so it points
        // there instead of "0%"; the word stays inside its tile on a 360 px phone
        assert.equal((await items(p, '.prz .po'))[3], '→ Legendary');
        await vp(p, 360, 740); await sleep(250);
        assert.ok(await p.$eval('.prz[data-t="3"]', (z) => { const a = z.getBoundingClientRect(), b = z.querySelector('.po').getBoundingClientRect(); return b.left >= a.left && b.right <= a.right; }), 'the word fits its tile at 360 px');
        await vp(p, 390, 844); await sleep(250);
        await shot('1-caught-legendary');
      });
      await scenario('drop-slept', { width: 360, height: 740, at: Date.parse('2026-11-08T13:00:00Z'), page: chain.html, results: SL7, storage: PRESET(), wallet: { account: Z7, rpc: chain.url } }, async (p, { shot }) => {
        await p.waitForFunction(() => !!QCP.store().nets['2026-11-07'] && !!QCP.data.nights['2026-11-07'], { timeout: 15000 }); await sleep(300);
        assert.equal(await p.evaluate(() => QCP.netResult('2026-11-07', null).status), 'slept');
        await p.evaluate(() => QCP.select('2026-11-07')); await sleep(200);
        assert.match(await txt(p, '#prompt'), /^He slept: no catch that night\.No run, nothing to catch\.$/);
        assert.equal(await txt(p, '#stamp'), 'He slept');
        assert.match(await txt(p, '#mygrid'), /He slept.*no catch/);
        assert.match(await txt(p, '#nftgrid'), /he slept/, 'the chain: he slept');
        await shot('1-slept');
      });
    } finally { chain.proc.kill('SIGTERM'); }
  } else results.push(['skip', 'nft-*, sqk-*, already, not-wired, short-*, no-address, lock, drop-*', 'no chain']);

  // 15. fetch blocked (as in the claude.ai preview: no wallet either) AND no localStorage: watch mode, the practice works (here
  //     its drop is chip noise: got away), nothing live is shown
  await scenario('blocked', { width: 360, height: 740, scheme: 'light', api: 'abort', noStorage: true, results: null, random: NOISE4.random }, async (p, { shot, noHScroll }) => {
    await sleep(1200);
    assert.ok(await hidden(p, '#live'), 'LIVE badge hidden'); assert.ok(await hidden(p, '#sofar'), 'no live rounds');
    assert.equal(await p.evaluate(() => QCP.stage), 'tonight');
    await watchMode(p);
    await openPractice(p);
    const s = await practice(p);
    assert.equal(s, NOISE4.spot);
    assert.equal(await txt(p, '#revt'), 'Your hamster got away (chip noise).');
    assert.match(await txt(p, '#revs'), new RegExp(`^practice ?Your drop landed on No\\. ${s}, a spot he could not reach that night: only the chip's noise lands there \\(${ref4.counts[s]} of 4,000 drops\\)\\.$`));
    assert.equal(await p.$eval('#mycountn', (e) => e.textContent), '0', 'got away: no catch (and no storage needed)');
    assert.equal(await txt(p, '#act'), "See tonight's net");
    await p.click('#act'); await sleep(200);
    await watchMode(p);
    assert.match(await txt(p, '#prompt'), /^Nets close 22:00 tonight/);
    await noHScroll('blocked'); await shot('1-blocked');
  });

  for (const r of results) console.log(r.join('  '));
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`${results.filter((r) => r[0] === 'ok').length}/${results.filter((r) => r[0] !== 'skip').length} scenarios passed${results.some((r) => r[0] === 'skip') ? ' (some SKIPPED, see above)' : ''}; screenshots in ${SHOTS}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
