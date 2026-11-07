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
// the page under test: QW_PAGE, else the real build's template and config with the nights FROZEN through 4 Nov (the
// scenarios' fixed clock and synthetic 5-7 Nov nights must not depend on how many real nights have been posted since)
const FROZEN = '2026-11-04';
// The proof line's on-chain link (QC_POSTS: the build's post scan from a file): the newest frozen night posted on Season 1
// with its own IBM job and the sha256 of its raw result file (linked), 3 Nov posted on Season 2 with another file's sha256
// (never linked: a wrong fingerprint)
const POST_TX = '0x' + 'ab'.repeat(32), CFGJ = JSON.parse(fs.readFileSync(path.join(ROOT, 'wheel/config.json'), 'utf8'));
const PAGE = process.env.QW_PAGE || (() => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-frozen-')), f = path.join(d, 'quantum-catch.html'), fx = path.join(d, 'posts.json');
  const build = (env) => execFileSync('python3', [path.join(__dirname, '..', 'build.py'), '--nights-through', FROZEN, '--out', f], { encoding: 'utf8', env: { ...process.env, ...env } });
  build({ QC_POSTS: 'none' });
  const ch = JSON.parse(fs.readFileSync(f, 'utf8').match(/const DATA = (\{.*?\});\n/s)[1]).chips, sha = (c) => '0x' + require('crypto').createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'quantum', c.file))).digest('hex');
  const nn = (day) => String(Math.round(Date.parse(day + 'T00:00:00Z') / 864e5)), C4 = ch[FROZEN], C3 = ch['2026-11-03'];
  fs.writeFileSync(fx, JSON.stringify({ games: {
    [CFGJ.season1Address]: { posts: { [nn(FROZEN)]: { txHash: POST_TX, jobId: C4.job_id, resultSha256: sha(C4) } } },
    [CFGJ.season2Address]: { posts: { [nn('2026-11-03')]: { txHash: '0x' + 'cd'.repeat(32), jobId: C3.job_id, resultSha256: sha(C4) } } } } }));
  build({ QC_POSTS: fx });
  return f;
})();
const SHOTS = process.argv[2] || path.join(__dirname, '..', 'out', 'shots');
const CHROME = process.env.CHROME || LOCAL.chrome || undefined;
const ANVIL = process.env.ANVIL || LOCAL.anvil || 'anvil';
fs.mkdirSync(SHOTS, { recursive: true });
const html = fs.readFileSync(PAGE), RESULTS = fs.readFileSync(path.join(path.dirname(PAGE), 'results.json'));
const DATA = JSON.parse(html.toString().match(/const DATA = (\{.*?\});\n/s)[1]);
const DAYS = Object.keys(DATA.nights).sort(), NEWEST = DAYS[DAYS.length - 1];
// the page under test may be a Season 2 build (QW_PAGE, or the real build after the switch): old picked nets are then
// "Season 1 · picked", the night's heading "Your Season 1 net", a practice catch shows a Season 2 example of its tier
const S2PAGE = !!(DATA.config && DATA.config.season2);
const OLD_RE = S2PAGE ? 'early net · picked' : 'old net \\(picked\\)', HEAD5 = S2PAGE ? 'Your early net · Thu 5 Nov' : 'Your net · Thu 5 Nov';
const S2EX = S2PAGE ? Object.entries(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'art', 's2', 'examples.json'), 'utf8'))) : [];
const practiceTitle = (tier, skin, spot) => { if (!S2PAGE) return `${/^[AEIOU]/.test(tier) ? 'An' : 'A'} ${tier} ${skin} hamster!`;
  const L = S2EX.filter(([n]) => n.startsWith(tier + ' ')); return `${/^[AEIOU]/.test(tier) ? 'An' : 'A'} ${tier} ${L[spot % L.length][0].slice(tier.length + 1).split(',')[0]} hamster!`; };
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
  const { width, height, scheme = 'light', api = 'mock', fast = true, noStorage = false, page = html, at = T0, storage = null, rpc = null, rpcUrl = null, wallet = null, random = null, hash = '' } = o;
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
    if (o.ua) await p.setUserAgent(o.ua);          // a real phone browser's user agent (no wallet inside it)
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
        let account = wallet.account; const ons = {};    // __switchAccount(a): the user picks another account (accountsChanged)
        window.__switchAccount = (a) => { account = a; (ons.accountsChanged || []).forEach((f) => f([a])); };
        window.ethereum = { on: (ev, f) => { (ons[ev] = ons[ev] || []).push(f); }, removeListener: () => {}, request: async ({ method, params }) => {
          window.__walletLog.push(method);
          if (method === 'eth_sendTransaction' && script.length) {
            const k = script.shift();
            if (k === 'reject') { const e = new Error('User rejected the request.'); e.code = 4001; throw e; }
            if (k === 'hold') await new Promise((r) => { window.__releaseSend = r; });
          }
          if (method === 'eth_sendTransaction') window.__sent.push([String(params[0].to).toLowerCase(), params[0].data]);
          // a wallet that cannot sign typed data (then catch.js approves exactly the cost first)
          if (method === 'eth_signTypedData_v4' && wallet.sign === 'unsupported') { const e = new Error('The requested method is not supported by this Ethereum provider.'); e.code = 4200; throw e; }
          if (method === 'eth_requestAccounts') { connected = true; return [account]; }
          if (method === 'eth_accounts') return connected ? [account] : [];
          if (method === 'eth_chainId') return '0xaa36a7';
          if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
          const r = await fetch(wallet.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] }) });
          const j = await r.json(); if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; } return j.result;
        } };
      }
    }, fast, noStorage, at, storage, KEY, wallet, random);
    await p.goto(`http://127.0.0.1:${srv.address().port}/${hash ? '#' + hash : ''}`, { waitUntil: 'load' });
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
const seenTxt = (p, sel) => p.$eval(sel, (e) => e.innerText.replace(/\s+/g, ' ').trim());          // what is on screen (hidden parts left out)
const hidden = (p, sel) => p.$eval(sel, (e) => e.hidden || getComputedStyle(e).display === 'none');
const stored = (p) => p.evaluate((KEY) => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return 'blocked'; } }, KEY);
const scrollTo = (p, sel) => p.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'start' }), sel);
const box = (p, sel) => p.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, h: r.height, docTop: r.top + scrollY }; }, sel);
const visible = async (p, sel, h) => { const b = await box(p, sel); return b.h > 0 && b.top >= 0 && b.bottom <= h; };
const revealed = (p, t = 40000) => p.waitForFunction(() => !QCP.playing && !document.getElementById('reveal').hidden, { timeout: t });
// v3: Details is a view of its own (#details #past #tonight #mine #how #check) with a Back link; the game is the main view
const openDetails = async (p, id = 'details') => { await p.evaluate((id) => { location.hash = id; }, id); await p.waitForFunction(() => !document.getElementById('details').hidden); await sleep(150); };
const backToMain = async (p) => { await p.click('#back'); await p.waitForFunction(() => document.getElementById('details').hidden && window.QCP.route === 'main'); await sleep(150); };
const firstScreenText = (p) => p.evaluate(() => document.querySelector('.hero').innerText + '\n' + document.getElementById('play').innerText);
const items = (p, sel) => p.$$eval(sel, (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
const dl = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const short = (d) => dl(d).replace(/^\w+ /, '');
// what a hamster was that night (the strip word): its tier, or got away (chip noise)
const wordOf = (x, s) => (x.tiers[s] ? QW.TIER_NAMES[x.tiers[s] - 1] : 'got away');
const NUMS = [...Array(16).keys()].map(String);
// what a spot's Season 1 hamster wears (the page's WEARS): bit 0 party hat, 1 round glasses, 2 striped scarf, 3 grin
const QC_WEARS = (s) => { const w = []; if (s & 1) w.push('party hat'); if (s & 2) w.push('round glasses'); if (s & 4) w.push('striped scarf'); if (s & 8) w.push('grin'); return w.length ? w : ['plain look']; };
let bigName5 = '';
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
// watch mode (no wallet, or no contract in the build): one plain line and ONE button, "What you need" (How it works), instead
// of the cast button; the test SQK and the test ETH faucet are in How it works ("What you need", first in it)
const WATCH = 'Open this page in a crypto wallet to cast a net. What you need';
const FAUCET = 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia';
// the real build says "free daily from this page" exactly when wheel/config.json names a faucet (v2 live since 11-06:
// it does); the anvil builds pass their own value
const REAL_FAUCET = !!JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8')).faucetAddress;
async function watchMode(p, paid = true, faucet = REAL_FAUCET) {
  assert.ok(await hidden(p, '#act'), 'no cast button without a wallet');
  assert.ok(!(await hidden(p, '#watch')), 'the watch line instead');
  assert.equal(await txt(p, '#watch'), WATCH);
  assert.equal(await txt(p, '#needsqk'), !paid ? 'no test SQK (nets are free)' : faucet ? '0.01 test SQK (free here, once per night)' : '0.01 test SQK', 'What you need (How it works)');
  assert.equal(await p.$eval('#faucet', (e) => e.href), FAUCET);
}
// the free practice net: under Past nights, on the newest night the chip has looked at (R3: not the first screen)
async function openPractice(p) {
  await openDetails(p, 'past');
  await p.click(`#nights button[data-day="${NEWEST}"]`); await sleep(250);
  assert.equal(await p.evaluate(() => QCP.stage), NEWEST, 'Past nights opens the practice night');
  assert.equal(await p.evaluate(() => QCP.route), 'main', 'a night from Details: back on the game');
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
  await openDetails(p, 'how'); await sleep(250);
  assert.ok(await p.$eval('#how', (e) => e.open), 'How it works opens in Details');
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
  execFileSync('python3', [path.join(ROOT, 'wheel/build.py'), '--catch-address', catchAddr, '--season2-address', 'null', '--sqk-address', sqk, '--faucet-address', faucet, '--nights-through', FROZEN, '--out', page], { encoding: 'utf8' });
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

// ---------- Season 2: the REAL QuantumCatchV3 on its own local anvil chain ----------
// v3 (forge build: QC3_ARTIFACT=<out>/QuantumCatchV3.sol/QuantumCatchV3.json, else contracts/out) with a stand-in renderer
// (contracts/test/mocks/MockS2Renderer.sol, QC3_RENDERER, else next to the v3 build: a small recognisable on-chain card, the
// same call as the real S2Renderer, without its ~70 art data contracts), and Season 1 next to it: the real v2 (QC_ARTIFACT),
// the mock test SQK and the SqkFaucet (whose clock v3 shares). The page is built with the ONE switch (--season1-address v2
// --season2-address v3). Missing = a failed run, unless QW_NO_S2=1.
const QC3_JSON = process.env.QC3_ARTIFACT || path.join(ROOT, 'contracts/out/QuantumCatchV3.sol/QuantumCatchV3.json');
const R3_JSON = process.env.QC3_RENDERER || path.join(path.resolve(path.dirname(QC3_JSON), '..'), 'MockS2Renderer.sol/MockS2Renderer.json');
const SEAL_SIG = 'seal(uint32)', MOCK_SKIN = ['Plain', 'Tiger', 'Circuit', 'Galaxy', 'Rainbow'];       // the stand-in's skin per tier
let s2Skip = 'no anvil';
function v3Problem() {
  for (const f of [QC3_JSON, R3_JSON]) if (!fs.existsSync(f)) return `no build at ${f} (forge build in contracts/ with QuantumCatchV3, or QC3_ARTIFACT / QC3_RENDERER)`;
  const ids = JSON.parse(fs.readFileSync(QC3_JSON, 'utf8')).methodIdentifiers;
  for (const sig of ['castNet()', 'castNetWithPermit(uint256,uint8,bytes32,bytes32)', 'NET_COST()', POST_SIG, SEAL_SIG, 'dnaOf(uint256)', 'locked()', 'lock()', 'setRenderer(address)', 'result(uint256)', 'tokenURI(uint256)'])
    if (!ids[sig]) return `the build at ${QC3_JSON} is not QuantumCatchV3 (no ${sig})`;
  const r = JSON.parse(fs.readFileSync(R3_JSON, 'utf8')).methodIdentifiers;
  if (!Object.keys(r).some((k) => k.startsWith('tokenURI((')) || !Object.keys(r).some((k) => k.startsWith('itemsOf(('))) return `${R3_JSON} is not a Season 2 renderer`;
  return v2Problem();
}
async function startS2Anvil() {
  try { execFileSync(ANVIL, ['--version'], { stdio: 'ignore' }); } catch (e) { s2Skip = 'no anvil'; return null; }
  const bad = v3Problem(); if (bad) { s2Skip = bad; return null; }
  const port = 21000 + (process.pid % 1000), url = `http://127.0.0.1:${port}`;
  const proc = spawn(ANVIL, ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '11155111', '--timestamp', String(T0 / 1000), '--accounts', '20', '--silent'], { stdio: 'ignore' });
  let id = 0;
  const rpc = async (method, params = []) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) }); const j = await r.json(); if (j.error) throw Object.assign(new Error(j.error.message), { data: j.error.data }); return j.result; };
  for (let i = 0; ; i++) { try { await rpc('eth_chainId'); break; } catch (e) { if (i > 100) { proc.kill(); s2Skip = 'anvil did not start'; return null; } await sleep(100); } }
  try {
    const receipt = async (h) => { for (let i = 0; i < 200; i++) { const rc = await rpc('eth_getTransactionReceipt', [h]); if (rc) return rc; await sleep(30); } throw new Error('no receipt'); };
    const send = async (from, to, data) => { const rc = await receipt(await rpc('eth_sendTransaction', [{ from, to, data }])); assert.equal(rc.status, '0x1', `tx ${data.slice(0, 10)} from ${from} failed`); return rc; };
    const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest']);
    const deploy = async (from, file, args = '') => {
      const rc = await receipt(await rpc('eth_sendTransaction', [{ from, data: JSON.parse(fs.readFileSync(file, 'utf8')).bytecode.object + args, gas: '0xe4e1c0' }]));
      if (rc.status !== '0x1' || (await rpc('eth_getCode', [rc.contractAddress, 'latest'])) === '0x') throw new Error(`the deploy of ${path.basename(file)} failed on anvil`);
      return rc.contractAddress.toLowerCase();
    };
    const at = async (ms) => { const b = await rpc('eth_getBlockByNumber', ['latest', false]); const t = Math.floor(ms / 1000); if (Number(b.timestamp) < t) { await rpc('evm_setNextBlockTimestamp', ['0x' + t.toString(16)]); await rpc('evm_mine'); } };
    const impersonate = async (a) => { await rpc('anvil_impersonateAccount', [a]); await rpc('anvil_setBalance', [a, '0x56bc75e2d63100000']); };
    const acc = (await rpc('eth_accounts')).map((a) => a.toLowerCase()), hatcher = acc[0], deployer = acc[19];
    const ids2 = JSON.parse(fs.readFileSync(QC_JSON, 'utf8')).methodIdentifiers, ids3 = JSON.parse(fs.readFileSync(QC3_JSON, 'utf8')).methodIdentifiers, mids = JSON.parse(fs.readFileSync(MOCK_JSON, 'utf8')).methodIdentifiers;
    const sqk = await deploy(deployer, MOCK_JSON);
    const v2 = await deploy(deployer, QC_JSON, pad(hatcher) + pad(0) + pad(sqk) + pad(CENT));                // Season 1: QuantumCatch v2
    const faucet = await deploy(deployer, FAUCET_JSON, pad(sqk) + pad(CENT) + pad(v2));
    const renderer = await deploy(deployer, R3_JSON);
    const v3 = await deploy(deployer, QC3_JSON, pad(hatcher) + pad(renderer) + pad(sqk) + pad(CENT));         // QuantumCatchV3(hatcher, renderer, SQK, 0.01)
    const mint = (to, v) => '0x' + mids['mint(address,uint256)'] + pad(to) + pad(v);
    await send(deployer, sqk, mint(faucet, 500n * 10n ** 18n));
    const ch = { proc, url, rpc, send, call, at, impersonate, accounts: acc, hatcher, deployer, sqk, faucet, v2, v3, renderer };
    ch.mint = (a, v) => send(deployer, sqk, mint(a, v));
    ch.castOn = async (game, a, minted = true) => { if (minted) await ch.mint(a, CENT); await send(a, sqk, QC.enc.approve(game, CENT)); await send(a, game, QC.enc.castNet()); };
    ch.post = (game, n, x) => send(hatcher, game, '0x' + (game === v3 ? ids3 : ids2)[POST_SIG] + pad(n) + x.perSpot.map(pad).join('') + pad(x.turns) + pad(x.steps) + x.job + x.sha + pad(x.first));
    ch.seal = (n) => send(acc[9], v3, '0x' + ids3[SEAL_SIG] + pad(n));
    ch.lock = () => send(deployer, v3, '0x' + ids3['lock()']);
    ch.result = async (game, tid) => QC.readNet(call, game, tid, { dna: game === v3 });
    ch.meta = async (game, tid) => QC.tokenMeta(QC.dec.string(await call(game, QC.enc.tokenURI(tid))));
    // the REAL Season 2 renderer (when the v3 build has it next to it: S2Art00..NN, S2Directory, S2Text, S2Renderer), deployed
    // on demand and set by the owner (before lock): every net's picture becomes the real painted card
    // (the chunks are S2Art000.sol .. since the 7 Nov art, S2Art00.sol .. before)
    const OUT3 = path.resolve(path.dirname(QC3_JSON), '..'), art3 = (n) => path.join(OUT3, `${n}.sol/${n}.json`);
    const W3 = fs.existsSync(art3('S2Art000')) ? 3 : 2, nn = (k) => `S2Art${String(k).padStart(W3, '0')}`;
    ch.realRenderer = async () => {
      if (!['S2Renderer', 'S2Directory', 'S2Text', nn(0)].every((n) => fs.existsSync(art3(n)))) return null;
      const chunks = []; for (let k = 0; fs.existsSync(art3(nn(k))); k++) chunks.push(await deploy(deployer, art3(nn(k))));
      const dir = await deploy(deployer, art3('S2Directory')), text = await deploy(deployer, art3('S2Text'));
      const r = await deploy(deployer, art3('S2Renderer'), pad(dir) + pad(96) + pad(text) + pad(chunks.length) + chunks.map(pad).join(''));
      await send(deployer, v3, '0x' + ids3['setRenderer(address)'] + pad(r));
      return { address: r, chunks: chunks.length };
    };
    const page = path.join(tmp, 's2.html');
    // the burned total as a build would count it at this block (here: a made-up 0.50 before the first net of this chain)
    ch.burnedAt = parseInt(await rpc('eth_blockNumber'), 16); ch.burnedWei = 5n * 10n ** 17n;
    execFileSync('python3', [path.join(ROOT, 'wheel/build.py'), '--season1-address', v2, '--season2-address', v3, '--sqk-address', sqk, '--faucet-address', faucet, '--nights-through', FROZEN, '--out', page],
      { encoding: 'utf8', env: { ...process.env, QC_BURNED: `0.5@${ch.burnedAt}` } });
    // what the page must show: the build's total + every NetPaid of both games since that block (the chain's own logs)
    ch.burnedNow = async () => { const logs = await rpc('eth_getLogs', [{ address: [v3, v2], topics: [QC.TOPIC_NETPAID], fromBlock: '0x' + (ch.burnedAt + 1).toString(16), toBlock: 'latest' }]);
      return logs.reduce((a, l) => a + QC.dec.netPaid(l).burned, ch.burnedWei); };
    ch.v2Draw = async (n, x, tokenId) => Number(QC.dec.uint(await call(v2, '0x' + ids2[DRAW_SIG] + pad(n) + x.sha + x.job + pad(tokenId) + x.perSpot.map(pad).join(''))));
    ch.html = fs.readFileSync(page);
    // the same build again with more env (QC_POSTS / QC_CHAIN_RPC / QC_PRIVATE: what the build reads from this chain)
    ch.build = (env) => { const f = path.join(tmp, `s2-${++ch.builds}.html`);
      execFileSync('python3', [path.join(ROOT, 'wheel/build.py'), '--season1-address', v2, '--season2-address', v3, '--sqk-address', sqk, '--faucet-address', faucet, '--nights-through', FROZEN, '--out', f],
        { encoding: 'utf8', env: { ...process.env, QC_BURNED: `0.5@${ch.burnedAt}`, ...env } });
      return fs.readFileSync(f); };
    ch.builds = 0;
    return ch;
  } catch (e) { proc.kill('SIGTERM'); s2Skip = 'the Season 2 setup failed on anvil: ' + e.message; return null; }
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
// no test SQK yet: an expected first step, a plain line (not a red error) under the faucet button that takes the cast button's place
const NO_SQK_WORDS = 'No test SQK yet: get the free one above, then cast. Nothing was sent.';
const NOT_WIRED = 'A net costs 0.01 test SQK (burned). Casting opens soon; until then try a free practice net under Past nights.';
const CAST_BTN = ['Cast a net · 0.01 test SQK', 'test token · no money value'];
// every line #nftmsg showed, in order (the wallet steps pass quickly)
const watchMsgs = (p) => p.evaluate(() => { window.__msgs = []; const e = document.getElementById('nftmsg'); new MutationObserver(() => { const t = e.textContent; if (t && window.__msgs[window.__msgs.length - 1] !== t) window.__msgs.push(t); }).observe(e, { childList: true, characterData: true, subtree: true }); });
const sqkRead = (p, f) => p.waitForFunction(f, { timeout: 15000 });
// the same state at the owner's phone (390x844) and a PC (1280x860), for the review screenshots (sel: scrolled into view)
async function shots2(p, shot, name, sel) {
  for (const [w, h] of [[390, 844], [1280, 860]]) {
    await vp(p, w, h); await sleep(400);
    if (sel) await scrollTo(p, sel); else await p.evaluate(() => window.scrollTo(0, 0));
    await sleep(300); await shot(`${name}-${w}x${h}`);
  }
}

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
    assert.equal(await p.$('#nfthint'), null, 'no hint under the button: one short line per state (owner, 6 Nov)');
    assert.equal(await txt(p, '#prompt'), 'Nets close 22:00 · result tomorrow 13:00', 'the ONE line under the button');
    // the fuel (owner 11-07): one small line under the button; this test build has no complete total, so no number at all
    assert.equal(await seenTxt(p, '#burn'), viewport.width < 400 ? '🔥 The door eats 0.01 test SQK' : '🔥 The door eats 0.01 test SQK per net');
    assert.ok(await hidden(p, '#burnt') && (await box(p, '#burn')).top >= (await box(p, '#act')).bottom, 'under the button; no total without a complete count');
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
    // phones: the sticky "Cast a net" shows only after scrolling past the deck, above the bottom edge; a tap is the real button's
    // single cast (scrolled back to the deck, the wallet steps under it)
    const phone = viewport.width < 640;
    if (phone) {
      assert.ok(!(await p.$eval('#castbar', (e) => e.classList.contains('on'))), 'no sticky bar on load');
      await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await p.waitForFunction(() => document.getElementById('castbar').classList.contains('on'), { timeout: 5000 }); await sleep(450);
      const cb = await box(p, '#castbar');
      assert.ok(cb.top > 0 && cb.bottom <= viewport.height - 12 + 0.5, `the sticky bar above the bottom edge (${JSON.stringify(cb)})`);
      assert.equal(await txt(p, '#castgo'), 'Cast a net');
      await noHScroll('sticky bar'); await shot('1b-sticky');
    }
    await watchMsgs(p);
    await p.click(phone ? '#castgo' : '#act');
    await p.waitForFunction(() => !document.getElementById('nftbox').hidden, { timeout: 30000 });
    if (phone) {
      assert.ok(await visible(p, '#nftbox', viewport.height), 'the sticky tap went back to the deck: the net\'s card on screen');
      assert.ok(!(await p.$eval('#castbar', (e) => e.classList.contains('on'))), 'cast: the bar is gone');
    }
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
    assert.match(await txt(p, '#nfttext'), /^✓ Your net is inResult tomorrow at 13:00in \d+ h \d+ minUntil 13:00 your hamster is in every universe at once\.$/, 'the approved card: thumb, ✓ Your net is in, the result\'s time, a countdown, the wait (lore)');
    assert.ok(await hidden(p, '#act'), 'nothing more to press for this net');
    assert.ok(await p.$eval('#nftbox', (e) => !!e.closest('#actions')), 'the minted net sits where the button was');
    assert.ok(await hidden(p, '#status'), 'nothing under the card (owner: "nothing else")');
    assert.deepEqual([await txt(p, '#stamp'), await txt(p, '#platek'), await txt(p, '#platen')], ['', 'Your catch', '?'], 'the stage: the mystery hamster, no stamp');
    assert.deepEqual(await items(p, '#platew li'), []);
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
    assert.match(await txt(p, '#nfttext'), /^✓ Your net is inResult tomorrow at 13:00/);
    assert.equal(await p.$eval('#mycountn', (e) => e.textContent), '1', 'the practice catch (a net is not a catch yet)');
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'load' }); await p.waitForFunction(() => window.QCP, { timeout: 15000 });
    await p.waitForFunction(() => !document.getElementById('nftbox').hidden && /^✓ Your net is in/.test(document.getElementById('nfttext').textContent), { timeout: 15000 });
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
    assert.equal(await txt(p, '#live'), 'Squeektoshi is running right now', 'ALIVE: his wheel right now (no turns read: the RPC is blocked here)');
    assert.ok(!(await hidden(p, '#alive')) && await hidden(p, '#netsn'), 'the nets counter hidden when the RPC cannot be read');
    assert.ok(await p.$eval('#stage', (e) => e.classList.contains('run')), 'the wheel spins faster while he runs');
    // the website is Quantum Squeak (owner 11-07); the story: the h1, one line, the footer's tagline
    assert.equal(await p.title(), 'Quantum Squeak');
    assert.equal(await txt(p, '.hero .wm'), 'Quantum Squeak');
    assert.equal(await txt(p, '.lede'), "Catch a hamster from another universe. Every night Squeektoshi's run opens the door, and a real IBM quantum computer shakes it.");
    assert.equal(await txt(p, '#lede1'), "Every night Squeektoshi's run opens the door. At 13:00 a real IBM quantum computer shakes it.", '13:00 = his night\'s end in your time');
    const seen = await p.evaluate(() => document.body.innerText);
    assert.ok(!/season|quantum catch/i.test(seen), `no season words, no old name on the page: ${(seen.match(/.{20}(season|quantum catch).{20}/i) || [''])[0]}`);
    const pw = await p.evaluate(() => { const b = document.getElementById('powered'), r = b.getBoundingClientRect(); return { t: b.textContent.trim(), href: b.getAttribute('href'), top: r.top, shown: r.height > 0 }; });
    assert.equal(pw.t, "Powered by Squeektoshi's real wheel on Squeekchain"); assert.equal(pw.href, 'https://squeekchain.com'); assert.ok(pw.shown && pw.top < 60, 'near the top');
    // the first screen: the quantum computer over a MYSTERY hamster, the plate, one action (here the watch line) and the
    // prizes; no tiles (owner, 6 Nov 15:25), no picking, no math
    assert.equal(await p.evaluate(() => QCP.stage), 'tonight', "a first visit opens on tonight's net");
    assert.equal(await txt(p, 'h1'), 'Catch a hamster from another universe.', 'the headline is the page\'s one h1');
    assert.equal(await txt(p, '#stageh'), "Tonight's net", 'the section\'s (hidden) heading');
    assert.ok(await rosterHidden(p), 'no tiles tonight: nothing is known about tonight\'s 16 hamsters');
    assert.ok(await hidden(p, '#srcbadge'), 'no badge tonight');
    assert.equal(await txt(p, '#prompt'), 'Nets close 22:00 · result tomorrow 13:00', 'the ONE line under the button (owner, 6 Nov)');
    assert.ok(!BANNED_FIRST.test(await firstScreenText(p)), 'no math words on the first screen');
    await watchMode(p);                                        // the real build has the contract (and a net costs test SQK); no wallet here
    assert.ok(await hidden(p, '#reveal'));
    assert.equal(await p.$$eval('.spot[aria-pressed], .spot.sel, .spot.net', (e) => e.length), 0, 'no picker');
    assert.deepEqual([await txt(p, '#platek'), await txt(p, '#platen'), await p.evaluate(() => document.getElementById('ham').dataset.spot)], ['Your catch', '?', ''], 'the mystery hamster');
    assert.ok(await p.$eval('#platen', (e) => e.previousElementSibling.hidden), 'no "No." before the \'?\': nothing to choose');
    assert.deepEqual(await items(p, '#platew li'), []);
    assert.equal(await txt(p, '#plateb'), '', 'the plate: YOUR CATCH and the \'?\' only');
    for (const id of ['#lcd', '#chipline', '#nfthint', '#deckrow']) assert.equal(await p.$(id), null, `${id} is gone (owner: "make it simple")`);
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
    assert.equal(await txt(p, '#podds'), 'Chances from last night.');
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
    assert.equal(await txt(p, '#stageh'), `Practice · ${dl(NEWEST)}`);
    assert.ok(await hidden(p, '#srcbadge'), 'no badge: one line per state');
    assert.equal(await txt(p, '#prompt'), 'One free try on a night that already ran.');
    assert.equal(await p.$$eval('.spot.out', (e) => e.length), 8);
    assert.deepEqual(await p.$eval('#act', (e) => [e.textContent, e.dataset.sub]), ['Cast a practice net · free', null], 'no small print under the practice button');
    assert.ok(await visible(p, '#act', 740), `the one action is on screen (${Math.round((await box(p, '#act')).bottom)})`);
    await p.click('.spot[data-spot="0"]'); await sleep(120);
    assert.equal(await txt(p, '#caption'), "Tap Cast a practice net: one of the chip's drops is yours.");
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
    assert.equal(await txt(p, '#revt'), practiceTitle('Epic', 'Crystal', EPIC4.spot));
    assert.equal(await txt(p, '#prompt'), 'That was practice. Real nets are cast before he runs.');
    assert.match(await txt(p, '#revs'), /^practice ?289 of the 4,000 drops landed on No\. 11\. The rarest catch of the night\.$/);
    assert.ok(await hidden(p, '#revq'), 'the result card: the catch and one line (the night\'s quantumness is in How it works)');
    assert.ok(!BANNED_REVEAL.test(await txt(p, '#reveal')), `no math or jargon on the result card: ${await txt(p, '#reveal')}`);
    assert.equal(await p.$eval('#mycountn', (e) => e.textContent), '1');
    assert.deepEqual(await p.$$eval('.spot.net', (e) => e.map((b) => [b.dataset.spot, b.classList.contains('drop')])), [['11', true]], 'your drop\'s tile, highlighted after the replay');
    assert.deepEqual([await txt(p, '#platen'), await p.evaluate(() => [document.getElementById('ham').dataset.spot, document.getElementById('ham').dataset.tier])], ['11', ['11', '3']], 'the catch on the podium, in its Epic skin');
    await rosterIs(p, ref4, 'revealed 4 Nov');
    assert.deepEqual(await p.$$eval('.spot[data-tier="3"]', (e) => e.map((b) => b.dataset.spot)), ['11'], '4 Nov: spot 11 (the fewest of the 8 catches) is Epic; the first shot was on 15: no Legendary');
    const tagBox = await p.$$eval('.spot .lnd b', (e) => e.map((t) => { const r = t.getBoundingClientRect(), b = t.closest('.spot').getBoundingClientRect(); return [r.left, r.right, b.left, b.right]; }));
    tagBox.forEach(([l, r, bl, br], i) => assert.ok(l >= bl && r <= br + 0.5, `word ${i} inside its tile (${l}-${r} in ${bl}-${br})`));
    await p.click('.spot[data-spot="11"]'); await sleep(100);
    assert.equal(await txt(p, '#caption'), 'No. 11: Epic · 7.2% of the drops.');
    await p.click('.spot[data-spot="15"]'); await sleep(100);
    assert.match(await txt(p, '#caption'), /^No\. 15: Common · .* The chip's very first drop landed here\.$/);
    assert.equal(await txt(p, '#act'), "See tonight's net", 'no wallet: the next step only shows tonight (casting needs a wallet)');
    await noHScroll('practice result'); await shot('2-practice-result');
    // tonight's net: closes 21:00 UTC = 22:00 in Ljubljana, 3 h 30 min from 17:30 UTC; without a wallet nothing can be cast
    await p.click('#act'); await sleep(300);
    assert.equal(await p.evaluate(() => QCP.stage), 'tonight');
    assert.equal(await txt(p, '#stageh'), "Tonight's net");
    assert.ok(await rosterHidden(p), 'back on tonight: the tiles go again');
    assert.equal(await txt(p, '#prompt'), 'Nets close 22:00 · result tomorrow 13:00');
    await watchMode(p);
    assert.equal((await stored(p)).nets['2026-11-05'], undefined, 'no local-only nets (R6\')');
    assert.match(await txt(p, '#tnclose'), /^Nets close at 22:00 your time · in 3 h (29|30) min\. He usually starts between 22:10 and 22:40\.$/);
    assert.equal(await txt(p, '#tnstate'), 'No net yet for this night.');
    await p.evaluate(() => document.getElementById('play').scrollIntoView({ block: 'start' })); await sleep(200);
    await shot('3-tonight-watch');
    // How it works: the 4 claw-machine steps, last night's odds, then the night and the per-night quantumness, honestly
    await openDetails(p, 'how');
    assert.deepEqual(await items(p, '#howsteps > li > b'), ['The door.', 'The shake.', 'Your net.', 'Got away?', 'The fuel.'], 'How it works opens with the story');
    assert.match(await txt(p, '#howsteps'), /The door only opens for SQK\. Every net burns 0\.01 test SQK forever\./, 'the fuel (owner 11-07)');
    assert.ok(await hidden(p, '#burnth'), 'no live read here (the RPC is not reachable): no total, never a wrong one');
    assert.match(await txt(p, '#howsteps'), /At 13:00 the quantum computer runs it 4,000 times\. Each run is a drop through the door that lands on one of 16 hamsters\./);
    assert.deepEqual(await items(p, '#unis > div'), ['Common the Home Burrow', 'Uncommon the Wild Worlds', 'Rare the Machine Worlds', 'Epic the Dream Worlds', 'Legendary the Golden World'], 'the universes per tier');
    assert.match(await txt(p, '#howfacts'), new RegExp(`^Cast your net before 22:00 your time\\. It costs 0\\.01 test SQK \\(burned${REAL_FAUCET ? '; free here once per night' : ''}\\) and is a test NFT on Sepolia\\. Nobody picks a hamster\\.$`));
    const howSeen = await p.$eval('#how', (e) => e.innerText);
    assert.ok(!/season/i.test(howSeen), 'How it works: no season words');
    assert.deepEqual(await items(p, '#faq dt'), ['Why 16 hamsters?', 'Why 4,000 drops?', 'Which drop is mine?'], "the owner's plain answers");
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
    assert.equal(await txt(p, '#howrules'), 'Free practice: one net on the newest night, under Past nights.');
    assert.match(await txt(p, '#needs'), /^What you need: a crypto wallet on the Sepolia test network, 0\.01 test SQK.*One net per wallet per night\.$/);
    assert.match(await txt(p, '#needs'), REAL_FAUCET ? /once per night/ : /test SQK/, 'the faucet: once per NIGHT');
    assert.match(await txt(p, '#contract'), S2PAGE ? /^Each net is a test NFT: contract 0x[0-9a-f]{40} on Sepolia \(no money value; one net per wallet per night; its catch and its traits are drawn on-chain from the night's drops\)\. Early nets: 0x[0-9a-f]{40}\.$/
      : /^Each net is a test NFT: QuantumCatch contract 0x[0-9a-f]{40} on Sepolia \(no money value; one net per wallet per night; its catch is drawn on-chain from the night's drops\)\.$/);
    await scrollTo(p, '#how'); await sleep(200); await shot('4-how-it-works');
    assert.equal(await p.$eval('#ghlink', (e) => e.href), DATA.config.repoUrl);
    assert.equal(await p.$eval('#ghfoot', (e) => e.href), DATA.config.repoUrl);
    // remembered after a reload: practice used: the stage opens on tonight's net
    await p.reload({ waitUntil: 'load' }); await p.waitForFunction(() => window.QCP, { timeout: 15000 }); await sleep(400);
    assert.equal(await p.evaluate(() => QCP.stage), 'tonight');
    assert.match(await txt(p, '#prompt'), /^Nets close 22:00 · /);
    assert.equal(await p.evaluate(() => QCP.route), 'details', 'a reload keeps the Details hash');
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
    // (a Season 2 build: no skin names on the cards, a surprise: owner 11-07)
    const prz = await p.$$eval('#prow .prz', (e) => e.map((z) => [Math.round(z.querySelector('canvas, .pst').getBoundingClientRect().width), z.querySelector('.ps') ? getComputedStyle(z.querySelector('.ps')).display : 'none']));
    assert.ok(prz.every(([w, d]) => w >= 60 && (S2PAGE ? d === 'none' : d !== 'none')), `the prize cards on the PC flat view (${JSON.stringify(prz)})`);
    await ctx.shot('0-1280x860');
    await vp(p, 1280, 800); await sleep(250);
    await tour(p, ctx);
    await openDetails(p, 'past');
    await p.click('#nights button[data-day="' + NEWEST + '"]'); await sleep(200);
    assert.equal(await p.evaluate(() => QCP.stage), NEWEST);
    await rosterIs(p, ref4, 'desktop 4 Nov');
    const fit = await p.$$eval('.spot .lnd b', (e) => e.map((t) => { const r = t.getBoundingClientRect(), b = t.closest('.spot').getBoundingClientRect(); return r.right <= b.right + 0.5 && r.left >= b.left; }));
    assert.ok(fit.every(Boolean), `every word fits its 1280 px tile (${fit})`);
    await p.evaluate(() => window.scrollTo(0, 0)); await sleep(150); await ctx.shot('5-revealed-night');
    const W = (x, y, ab) => ((+ab[0] ^ +ab[1]) === (x & y)) ? 1 : 0, C = ['FUR', 'HAT'];
    const chip100 = DATA.twin.pairs.reduce((a, q) => a + q.first.reduce((b, ab) => b + W(C.indexOf(q.a_card), C.indexOf(q.b_card), ab), 0), 0);
    await openDetails(p, 'check'); await scrollTo(p, '#check'); await p.click('#tlab summary'); await sleep(150);
    await p.click('#tplan button[data-t="A"][data-c="1"]');
    assert.equal(await p.$eval('#tplan button[data-t="A"][data-c="1"]', (e) => e.textContent), '1', 'tap flips an answer');
    await p.click('#tplay');
    await p.waitForFunction(() => /of 100/.test(document.getElementById('tcres').textContent), { timeout: 10000 });
    assert.match(await txt(p, '#tres'), /Your plan won 15 of 20/);
    assert.match(await txt(p, '#tcres'), new RegExp(`won ${chip100} of 100`));
    assert.match(await txt(p, '#twinhealth'), /under 79% is thrown out and redone/);
    await sleep(150); await ctx.shot('6-check-it-yourself');
    await backToMain(p);
    // narrower PC windows (iPad landscape, small laptops): no sideways scroll, the header (with the sound switch) inside the window
    for (const [w, h] of [[1024, 768], [1100, 800]]) {
      await vp(p, w, h); await p.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
      await ctx.noHScroll(`${w} px`);
      const r = await p.evaluate(() => { const b = document.getElementById('sound').getBoundingClientRect(); return [b.left, b.right, document.documentElement.clientWidth]; });
      assert.ok(r[0] >= 0 && r[1] <= r[2], `${w} px: the sound switch inside the window (${r})`);
      await ctx.shot(`7-${w}`);
    }
  });

  // 3b. the Details view (owner, 6 Nov: "too much text ... could be somewhere separated"): a hash in the same page, a Back
  //     link, the browser's back button; My catches and Past nights open it; a night from it goes back to the game. The
  //     main view ends with the art band ("Hamster battles", coming soon) and the 12-card Season 2 gallery
  // THE PROOF of a night (owner 11-07): one compact line under a revealed night's result, and in Check it yourself: the IBM
  // job, the chip, its shots, the night's own entanglement test, its raw result file and its on-chain fingerprint (the post)
  await scenario('proof', { width: 390, height: 844 }, async (p, { shot, noHScroll }) => {
    const clk = async (p, sel, what) => { try { await p.click(sel); } catch (e) { throw new Error(`${what}: ${e.message} (${await p.evaluate((q) => { const x = document.querySelector(q); return x ? [x.hidden, x.textContent, QCP.route, QCP.stage].join('|') : 'none'; }, sel)})`); } };
    const c = DATA.chips[NEWEST], tw = Math.round(100 * c.twin.reduce((a, q) => a + q.wins, 0) / c.twin.reduce((a, q) => a + q.shots, 0));
    const line = `Proof: IBM job ${c.job_id} · ${c.backend} · ${c.wheel_shots.toLocaleString('en-US')} shots · entanglement test ${tw}% · raw result · on-chain fingerprint`;
    const raw = `${CFGJ.repoUrl}/blob/main/quantum/${c.file}`, chain = `https://sepolia.etherscan.io/tx/${POST_TX}`;
    assert.ok(c.file && c.file.includes(c.job_id), 'the chip says its raw result file');
    await openDetails(p, 'past'); await clk(p, `#nights button[data-day="${NEWEST}"]`, 'the night'); await sleep(300);
    assert.ok(await hidden(p, '#proof'), 'not before the night is shown');
    await clk(p, '#act', 'the practice net'); await p.waitForFunction(() => !QCP.playing && !document.getElementById('proof').hidden, { timeout: 30000 });
    assert.equal(await txt(p, '#proof'), line);
    assert.deepEqual(await p.$$eval('#proof a', (e) => e.map((a) => [a.textContent, a.href, a.target])), [['raw result', raw, '_blank'], ['on-chain fingerprint', chain, '_blank']]);
    await noHScroll('proof'); await p.evaluate(() => document.getElementById('proof').scrollIntoView({ block: 'center' })); await sleep(150); await shot('1-proof-390x844');
    await openDetails(p, 'check');
    assert.equal(await txt(p, '#checkproof'), line, 'Check it yourself: the same line');
    await p.evaluate(() => document.getElementById('checkproof').scrollIntoView({ block: 'center' })); await sleep(150); await shot('2-check-390x844');
    // 3 Nov: its post names another file's fingerprint: no on-chain link (never a wrong one); the raw result stays
    await p.evaluate(() => QCP.select('2026-11-03')); await openDetails(p, 'past'); await openDetails(p, 'check'); await sleep(200);
    assert.deepEqual(await p.$$eval('#checkproof a', (e) => e.map((a) => a.textContent)), ['raw result'], '3 Nov: no fingerprint link');
    await vp(p, 1280, 860); await openDetails(p, 'past'); await clk(p, `#nights button[data-day="${NEWEST}"]`, 'the night'); await sleep(400);
    assert.ok(!(await hidden(p, '#proof')), 'its practice seen: the proof line again');
    await p.evaluate(() => document.getElementById('proof').scrollIntoView({ block: 'center' })); await sleep(150); await shot('3-proof-1280x860');
  });
  await scenario('details', { width: 360, height: 740, hash: 'how' }, async (p, { shot, noHScroll }) => {
    assert.deepEqual(await p.evaluate(() => [QCP.route, document.getElementById('game').hidden, document.getElementById('details').hidden, document.getElementById('how').open]), ['details', true, false, true], '#how on load: Details, How it works open');
    assert.ok((await box(p, '#how')).top < 120, 'How it works at the top');
    await noHScroll('details'); await shot('details-how');
    await backToMain(p);
    assert.equal(await p.evaluate(() => window.scrollY), 0, 'Back: the game from the top');
    assert.ok(!(await hidden(p, '#watch')), 'the game view: the watch line');
    // its one button, "What you need": Details, the requirements on the first screen (first in How it works)
    await p.click('#needlink'); await p.waitForFunction(() => QCP.route === 'details', { timeout: 5000 }); await sleep(200);
    assert.equal(await p.evaluate(() => location.hash), '#how');
    // (How it works opens with the story since 11-07; the "What you need" button still lands on What you need)
    { const b = await box(p, '#needs'); assert.ok(b.top >= 0 && b.bottom <= 740, `What you need on the first screen (${Math.round(b.top)}-${Math.round(b.bottom)} in 740)`); }
    assert.ok((await box(p, '#needs')).top > (await box(p, '#howsteps')).top, 'after the story');
    await backToMain(p);
    await p.goBack(); await p.waitForFunction(() => QCP.route === 'details', { timeout: 5000 });
    assert.equal(await p.evaluate(() => location.hash), '#how', "the browser's back button: Details again");
    await backToMain(p);
    await p.click('#mycount'); await p.waitForFunction(() => QCP.route === 'details', { timeout: 5000 }); await sleep(200);
    assert.equal(await p.evaluate(() => location.hash), '#mine');
    assert.ok(Math.abs((await box(p, '#mine')).top) < 40, 'My catches at the top');
    await p.click(`#nights button[data-day="${NEWEST}"]`); await p.waitForFunction(() => QCP.route === 'main', { timeout: 5000 }); await sleep(300);
    assert.equal(await p.evaluate(() => QCP.stage), NEWEST);
    assert.ok(!(await rosterHidden(p)), 'a night with data: the 16 tiles');
    assert.ok(await visible(p, '#act', 740), 'the practice button on screen');
    await noHScroll('practice night');
    // the art band and the gallery: 12 cards, their pictures in once the band comes near; names drawn by JS
    await scrollTo(p, '#soon'); await sleep(500);
    assert.equal(await p.$$eval('#gallery .gcard', (e) => e.length), 12);
    assert.ok(await p.$$eval('#gallery .gcard img', (e) => e.every((i) => /^data:image\/webp;base64,/.test(i.getAttribute('src') || ''))), 'every card has its picture');
    assert.match(await p.$eval('#teaser', (e) => e.getAttribute('src') || ''), /^data:image\/webp;base64,/);
    assert.equal(await txt(p, '#soonh'), 'Hamster Battles');
    assert.ok(await p.$eval('#gallery', (e) => getComputedStyle(e).scrollSnapType.startsWith('x')), 'phones: the gallery snaps sideways');
    assert.ok(!BANNED_FIRST.test(await firstScreenText(p)), 'no math on the first screen');
    await noHScroll('main with the gallery'); await shot('soon');
    await p.evaluate(() => window.scrollTo(0, 0)); await sleep(200); await shot('main-full', true);
  });

  // 4. desktop, dark: the first screen
  // a phone browser without a wallet inside it (11-06 owner on his phone: "where is wallet connection im on mobile"): one
  // button opens this page in the MetaMask app's own browser, where the cast button connects; "What you need" stays as a link
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  await scenario('phone-wallet-app', { width: 390, height: 844, ua: IPHONE }, async (p, { shot, noHScroll }) => {
    assert.ok(await hidden(p, '#act'), 'no cast button without a wallet');
    assert.equal(await txt(p, '#watch'), 'Open this page in your wallet app to cast a net. Open in MetaMask What you need');
    const want = await p.evaluate(() => 'https://metamask.app.link/dapp/' + location.host + location.pathname);
    assert.equal(await p.$eval('#mmlink', (e) => e.href), want, 'the MetaMask deep link to this very page');
    assert.ok((await p.$eval('#mmlink', (e) => e.getBoundingClientRect().bottom)) <= 844, 'the MetaMask button is on the first screen');
    await p.click('#needlink'); await p.waitForFunction(() => QCP.route === 'details', { timeout: 5000 });
    await p.goto(p.url().split('#')[0], { waitUntil: 'load' }); await sleep(300);
    await noHScroll('phone without a wallet'); await shot('wallet-app');
  });
  // the story band (owner 11-07): under the prizes, below the first screen; phones swipe its 4 panels (the dots follow)
  await scenario('lore', { width: 390, height: 844 }, async (p, { shot, noHScroll }) => {
    assert.ok((await box(p, '#lore')).top >= (await box(p, '#prow')).bottom, 'after the first screen\'s prizes (the first screen itself is unchanged: phone-light / desktop-light fit it)');
    await scrollTo(p, '#lore'); await sleep(400);
    await p.waitForFunction(() => [...document.querySelectorAll('#lrow img')].every((i) => i.complete && i.naturalWidth > 0), { timeout: 10000 });
    assert.equal(await txt(p, '#loreh'), 'How Squeektoshi opened the door');
    assert.equal((await items(p, '#lrow figcaption')).length, 5);
    assert.match((await items(p, '#lrow figcaption'))[4], /^Why wait until 13:00\? .* Until then your hamster is in every universe at once\.$/);
    assert.match(await txt(p, '.lnext'), /^Some say the door is getting wider\./);
    assert.deepEqual(await p.$$eval('#ldots i', (e) => e.map((d) => d.classList.contains('on'))), [true, false, false, false, false]);
    await shot('1-lore-390x844');
    await p.$eval('#lrow', (r) => { r.scrollLeft = r.firstElementChild.getBoundingClientRect().width * 2 + 24; }); await sleep(400);
    assert.deepEqual(await p.$$eval('#ldots i', (e) => e.map((d) => d.classList.contains('on'))), [false, false, true, false, false], 'the dots follow the swipe');
    await shot('2-lore-swiped');
    for (const [w, h] of [[360, 740], [390, 844]]) { await vp(p, w, h); await sleep(300); await noHScroll(`lore ${w}`); }
  });
  await scenario('lore-pc', { width: 1280, height: 860 }, async (p, { shot, noHScroll }) => {
    await scrollTo(p, '#lore'); await sleep(400);
    await p.waitForFunction(() => [...document.querySelectorAll('#lrow img')].every((i) => i.complete && i.naturalWidth > 0), { timeout: 10000 });
    const tops = await p.$$eval('#lrow .lp', (e) => e.map((f) => Math.round(f.getBoundingClientRect().top)));
    assert.ok(tops.length === 5 && tops.every((t) => t === tops[0]), 'a PC: the 5 panels in one row');
    assert.ok(await hidden(p, '#ldots'), 'no dots on a PC');
    await noHScroll('lore pc'); await shot('1-lore-1280x860');
  });
  await scenario('desktop-dark', { width: 1280, height: 800, scheme: 'dark' }, async (p, { shot, noHScroll }) => {
    await noHScroll('desktop dark'); await shot('1-first-screen');
    // the Season 2 grid: every trait line takes the same two lines, so every name sits on one baseline
    const tl = await p.$$eval('#gallery .gcard figcaption span', (e) => e.map((s) => Math.round(s.getBoundingClientRect().height)));
    assert.ok(tl.length === 12 && tl.every((h) => h === tl[0]), `the trait lines share one height (${tl})`);
  });

  // 6. OLD picked nets (cast before 6 Nov) still render and resolve as before, labelled "old net (picked)": a net resolves when its
  //    night's chip result arrives in results.json next to the page (no rebuild); a tampered file is refused
  const NX = nextNightResults(false);
  const S5 = NX.perSpot.indexOf(Math.max(...NX.perSpot)), REFX = refOf(NX.chip.job_id);
  const OLDNET = (spot) => ({ practice: { day: NEWEST, spot: 15, at: 1, seen: true }, nets: { '2026-11-05': { spot, at: 1 } } });
  await scenario('resolve', { width: 375, height: 667, at: Date.parse('2026-11-06T13:00:00Z'), results: NX.body, storage: OLDNET(S5) }, async (p, { shot }) => {
    await p.waitForFunction(() => QCP.stage === '2026-11-05' && !!QCP.data.chips['2026-11-05'], { timeout: 10000 }); await sleep(300);
    assert.equal(await txt(p, '#stageh'), HEAD5);
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
    assert.match(await txt(p, '#revs'), new RegExp(`^${OLD_RE} ?Spot ${S5} \\(.*\\): the chip found him there in`));
    await rosterIs(p, REFX, 'resolved 5 Nov');
    assert.equal(await p.$eval('.spot[data-spot="7"] .lnd b', (e) => e.textContent), 'Epic', 'its first shot landed on spot 3: the Epic spot 7 stays Epic');
    assert.ok(await hidden(p, '#revq'), 'one line on the result card');
    assert.equal(await p.$eval('#revq', (e) => e.textContent), 'That night the chip kept the quantum pattern.', 'the v1.2 night kept the pattern (kept for How it works)');
    assert.equal(await p.$$eval('.spot.out', (e) => e.length), 8, 'after the replay the out-of-reach half is shown');
    assert.equal((await stored(p)).nets['2026-11-05'].seen, true);
    assert.equal(await p.$eval('#mycountn', (e) => e.textContent), '2', 'practice + the real catch');
    assert.match(await txt(p, '#mygrid'), new RegExp(OLD_RE));
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
    assert.match(await txt(p, '#revs'), new RegExp(`^${OLD_RE} ?Spot 7 \\(.*\\): the chip found him there in 6\\.3% of its 4,000 looks\\. The rarest catch of the night, and the chip's very first drop landed there\\.$`));
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
    // (a Season 2 page also asks its contract's locked() once: not a SqueekCore call)
    assert.deepEqual(rpcLog.filter((x) => x.startsWith('0x') && x !== QC.enc.locked()), [QC.enc.state(), QC.enc.roundPage(241, 303, 16)], 'only settled rounds are asked for');
    assert.equal(await txt(p, '#stageh'), "Tomorrow's net");
    assert.ok(await rosterHidden(p), 'tomorrow\'s net: no tiles');
    assert.equal(await txt(p, '#tnk'), "Tomorrow's net");
    assert.equal(await txt(p, '#prompt'), 'Nets close 22:00 tomorrow · result Sat 13:00');
    assert.equal(await txt(p, '#live'), 'Squeektoshi is running right now · 870 turns', 'ALIVE: his turns tonight (settled rounds)');
    await openDetails(p, 'tonight'); await shot('1-tonight-so-far');
  });

  // 7b. the viewer's net between the 21:00 UTC lock and the chip (a drop, and an old picked one): his run so far next to the
  //     net, tomorrow's net one tap away
  await scenario('running', { width: 360, height: 740, at: Date.parse('2026-11-05T22:30:00Z'), rpc: fakeCore, storage: PRESET({ '2026-11-05': DROP5() }) }, async (p, { shot }) => {
    assert.equal(await p.evaluate(() => QCP.stage), '2026-11-05', 'the running night with the viewer\'s net is the first screen');
    await p.waitForFunction(() => !document.getElementById('sofar').hidden, { timeout: 10000 }); await sleep(200);
    assert.equal(await txt(p, '#stageh'), HEAD5);
    assert.ok(await hidden(p, '#srcbadge'));
    assert.match(await txt(p, '#nfttext'), /^✓ Your net is inResult tomorrow at 13:00in \d+ h \d+ minUntil 13:00 your hamster is in every universe at once\.$/, 'the net\'s card: the result tomorrow 13:00, a countdown');
    assert.ok(await hidden(p, '#status'), 'nothing under the card');
    assert.equal(await txt(p, '#live'), 'Squeektoshi is running right now · 870 turns', 'his turns tonight go to the ALIVE line, never the deck');
    assert.deepEqual([await txt(p, '#stamp'), await txt(p, '#platen')], ['', '?'], 'the mystery hamster');
    assert.equal(await txt(p, '#alt'), "See tomorrow's net", 'no wallet: tomorrow\'s net can be seen, not cast'); assert.ok(await hidden(p, '#act'));
    assert.deepEqual(await p.$$eval('#nights button', (e) => e.map((b) => b.dataset.day)).then((x) => x.slice(-2)), ['2026-11-05', 'tonight'], 'a strip button for the running night');
    assert.match(await txt(p, '#sofar'), /^Tonight so far: 3 rounds, 870 turns \(his night of Thu 5 Nov, settled on-chain up to 23:20 your time\) · your net is in$/);
    await openDetails(p, 'tonight');
    assert.ok((await box(p, '#sofar')).top < (await box(p, '#tnh')).top, 'his run so far sits above the next night\'s heading');
    await backToMain(p);
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
    assert.ok(await hidden(p, '#srcbadge'));
    assert.equal(await txt(p, '#prompt'), "IBM's chip has not looked at a night since Wed 4 Nov: nets wait until it does.", 'stale: no "come back later" promise');
    assert.equal(await txt(p, '#nfttext'), '✓ Your net is inWaiting for the quantum computer…', 'his night is over: no countdown');
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
    assert.match(await txt(p, '#revs'), new RegExp(`^${OLD_RE} ?Spot ${OUT5} was out of reach that night: he could not land there\\. The chip's 55 landings there are its noise\\.$`));
    assert.deepEqual(await p.evaluate((s) => { const r = QCP.netResult('2026-11-05', s); return [r.status, r.o.status, r.o.tier, r.o.reach, r.h.tier]; }, OUT5), ['away', 2, 0, 2, -1]);
    assert.equal(await p.$eval('#mycountn', (e) => e.textContent), '1', 'only the practice catch counts');
    assert.match(await txt(p, '#mygrid'), new RegExp(`Got away.*${OLD_RE}`));
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
        await p.waitForFunction(() => /^Get free test SQK$/.test(document.getElementById('act').textContent), { timeout: 15000 });
        assert.deepEqual(await p.$eval('#act', (e) => [e.textContent, e.dataset.sub]), ['Get free test SQK', 'enough for one net']);
        assert.equal(await txt(p, '#prompt'), 'Nets close 22:00 · result tomorrow 13:00');
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
        assert.ok(await hidden(p, '#act') && await hidden(p, '#watch'), 'nothing to press until the next net night');
        assert.equal(await txt(p, '#sqkout'), 'Free test SQK already used. Next one from 22:00 tonight.', 'the faucet resets per NET NIGHT (at the 22:00 close)');
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
        await p.waitForFunction(() => /^Get free test SQK$/.test(document.getElementById('act').textContent), { timeout: 15000 });
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
        assert.ok(await hidden(p, '#act'));
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
        for (const q of ['#act', '#watch', '#nftbox', '#sqkout']) assert.ok(await hidden(p, q), `${q}: no second net, no "make it an NFT" step`);
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
        assert.equal(await txt(p, '#stageh'), 'Your net · Thu 5 Nov');
        assert.match(await txt(p, '#nfttext'), /^✓ Your net is inResult (today|tomorrow) at 13:00in /, 'the locked net\'s card: the result and a countdown');
        assert.ok(await hidden(p, '#status'));
        assert.equal(await p.$eval('#nights button[aria-pressed="true"]', (e) => e.dataset.day), '2026-11-05', 'a strip button for the net\'s night (not in the page yet)');
        assert.ok(await rosterHidden(p), 'waiting for his night: no tiles');
        assert.match(await txt(p, '#waiting'), /Thu 5 Nov: your net, waiting for the chip\./);
        assert.ok(!(await hidden(p, '#nftbox')), 'the locked net\'s NFT in the deck');
        await shot('0-net-locked');
        assert.equal(await txt(p, '#alt'), "Cast tomorrow's net");
        await p.click('#alt'); await sleep(200);
        assert.equal(await txt(p, '#stageh'), "Tomorrow's net", 'tomorrow\'s net behind the secondary button');
        assert.equal(await txt(p, '#prompt'), 'Nets close 22:00 tomorrow · result Sat 13:00');
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
        assert.equal(await txt(p, '#prompt'), 'Your result is posted soon.');
        assert.equal(await txt(p, '#stamp'), '', 'no stamp: one line per state');
        const st = await p.evaluate(() => { const a = document.getElementById('stamp').getBoundingClientRect(), b = document.querySelector('.stage').getBoundingClientRect(); return [a.left - b.left, b.right - a.right]; });
        assert.ok(st[0] >= 0 && st[1] >= 0, `the stamp inside the stage (${st})`);
        assert.equal(await txt(p, '#alt'), '▶ Watch his night');
        assert.match(await txt(p, '#waiting'), /Thu 5 Nov: your net, the chip has dropped, your drop is posted soon\./);
        assert.match(await txt(p, '#mygrid'), /Soon.*your drop is posted soon/);
        await shot('1-posting');
        await p.click('#alt'); await revealed(p);
        assert.equal(await txt(p, '#revs'), 'Brighter = more drops. Your own drop is shown once the result is posted.');
        assert.equal(await txt(p, '#revt'), 'Where the drops landed · Thu 5 Nov');
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
        assert.equal(await txt(p, '#stageh'), 'Your net · Thu 5 Nov');
        assert.equal(await txt(p, '#prompt'), 'Your result is ready.');
        assert.equal(await txt(p, '#act'), 'See what you caught');
        assert.ok(await visible(p, '#act', 740), 'on screen at 360x740');
        assert.ok(!(await rosterHidden(p)), 'a night with its result: the 16 tiles');
        assert.deepEqual([await txt(p, '#platen'), await p.evaluate(() => document.getElementById('ham').dataset.spot)], ['?', ''], 'still a mystery: no spoiler');
        assert.equal(await p.$$eval('.spot.out, .spot.net', (e) => e.length), 0, 'no out-of-reach marks, no tile of yours before the replay');
        assert.match(await txt(p, '#mygrid'), /Ready!.*tap to see/);
        // My hamsters n counts the catch before its reveal (owner 11-07: "it says 0 but I have one Common now"), with a pulse
        assert.equal(await p.$eval('#mycountn', (e) => e.textContent), '2', 'practice + the catch, not revealed yet');
        assert.ok(await p.$eval('#mycount', (e) => e.classList.contains('ready')), 'a pulse while a result is ready');
        await shot('0-ready');
        await p.click('#act'); await revealed(p);
        assert.deepEqual(await p.$$eval('.spot.net', (e) => e.map((b) => [b.dataset.spot, b.classList.contains('drop')])), [['7', true]], 'YOUR drop\'s tile');
        assert.equal(await txt(p, '#revt'), 'An Epic Crystal hamster!');
        assert.ok(await hidden(p, '#status'), 'the result card says it: no line under it');
        assert.equal(await txt(p, '#revs'), `${NX.perSpot[7]} of the 4,000 drops landed on No. 7. The rarest catch of the night.`);
        assert.deepEqual([await txt(p, '#platen'), await p.evaluate(() => [document.getElementById('ham').dataset.spot, document.getElementById('ham').dataset.tier])], ['7', ['7', '3']], 'the catch on the podium in its Epic skin');
        await rosterIs(p, REFX, 'drop 5 Nov');
        assert.equal(await p.$eval('#mycountn', (e) => e.textContent), '2', 'practice + the catch');
        assert.ok(!(await p.$eval('#mycount', (e) => e.classList.contains('ready'))), 'revealed: no pulse');
        assert.match(await txt(p, '#mygrid'), /^Epic5 Nov · #7IBM chip/);
        assert.equal((await stored(p)).nets['2026-11-05'].seen, true);
        await noHScroll('drop caught'); await shot('1-caught-epic');
        // the big card (owner 11-07): a tap on the result card; a generated name (the same for everyone), tier + universe, the
        // night's numbers, Share on X, View NFT; Back closes it
        await p.click('#reveal'); await p.waitForFunction(() => QCP.big, { timeout: 5000 }); await sleep(400);
        const id = 'v2-' + BigInt(QC.netId(N5, E5)).toString(16);
        assert.equal(await p.evaluate(() => location.hash), '#hamster-' + id);
        const name = await txt(p, '#bigname');
        assert.equal(name, await p.evaluate((k) => QCP.nameOf(k, 3), 'v2:' + BigInt(QC.netId(N5, E5)).toString(16)), 'the name: from the token id');
        assert.match(name, /^[A-Z][A-Za-z ]+$/);
        assert.equal(await txt(p, '#bigtier'), 'Epic · from the Dream Worlds');
        assert.deepEqual(await items(p, '#bigtraits li'), ['Crystal skin', ...QC_WEARS(7)]);
        const kv = await p.$$eval('#bigkv dt', (e) => e.map((d) => [d.textContent, d.nextElementSibling.textContent]));
        assert.deepEqual(kv.slice(0, 3), [['Night', 'Thursday 5 November'], ['Landed on', `No. 7: ${NX.perSpot[7]} of 4,000 drops`], ['IBM job', NX.chip.job_id]]);
        const share = await p.$eval('#bigshare', (e) => e.href);
        assert.ok(share.startsWith('https://x.com/intent/post?text=') && decodeURIComponent(share).includes(`I caught ${name}, an Epic hamster from the Dream Worlds on Quantum Squeak`) && decodeURIComponent(share).includes('#hamster-' + id), 'Share on X');
        assert.equal(await p.$eval('#bignft', (e) => e.href), `https://sepolia.etherscan.io/nft/${chain.address}/${BigInt(QC.netId(N5, E5)).toString()}`);
        await noHScroll('big card'); await shot('2-big-card');
        await p.click('#bigx'); await p.waitForFunction(() => !QCP.big, { timeout: 5000 });
        assert.equal(await p.evaluate(() => location.hash), '', 'closed: back to the game');
        bigName5 = name;
      });
      // a shared link (#hamster-<id>): a visitor who knows nothing sees the same hamster with the same name (read from the chain)
      await scenario('big-link', { width: 390, height: 844, at: Date.parse('2026-11-06T13:00:00Z'), page: chain.html, results: NX.body, rpcUrl: chain.url, hash: 'hamster-v2-' + BigInt(QC.netId(N5, E5)).toString(16) }, async (p, { shot }) => {
        await p.waitForFunction(() => QCP.big, { timeout: 15000 }); await sleep(400);
        assert.equal(await txt(p, '#bigname'), bigName5, 'the same name for everyone');
        assert.equal(await txt(p, '#bigtier'), 'Epic · from the Dream Worlds');
        assert.ok(await p.$eval('#bigcv', (c) => !c.hidden && c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data[3] > 0), 'its painted look, large');
        await shot('1-shared-link');
      });
      await scenario('drop-away', { width: 360, height: 740, at: Date.parse('2026-11-06T13:00:00Z'), page: chain.html, results: NX.body, storage: PRESET({ '2026-11-05': DROP('2026-11-05', A5) }), wallet: { account: A5, rpc: chain.url } }, async (p, { shot }) => {
        await p.waitForFunction(() => QCP.store().nets['2026-11-05'].spot === 2, { timeout: 15000 }); await sleep(300);
        await p.click('#act'); await revealed(p);
        assert.ok(await hidden(p, '#status'), 'the result card says it');
        assert.equal(await txt(p, '#revt'), 'Your hamster got away.');
        assert.equal(await txt(p, '#revs'), 'Your drop hit No. 2, a spot he could not reach: chip noise.');
        assert.deepEqual(await p.$$eval('.spot.net', (e) => e.map((b) => b.dataset.spot)), ['2']);
        assert.ok(await p.$eval('#ham', (e) => e.classList.contains('away')), 'a shadow on the podium');
        assert.deepEqual([await txt(p, '#platek'), await txt(p, '#platen'), await txt(p, '#plateb')], ['Your drop', '2', '5 Nov · got away']);
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
        assert.ok(await hidden(p, '#status'), 'the result card says it');
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
        assert.equal(await txt(p, '#prompt'), 'He slept: no catch that night.');
        assert.equal(await txt(p, '#stamp'), 'He slept');
        assert.match(await txt(p, '#mygrid'), /He slept.*no catch/);
        assert.match(await txt(p, '#nftgrid'), /he slept/, 'the chain: he slept');
        await shot('1-slept');
      });
    } finally { chain.proc.kill('SIGTERM'); }
  } else results.push(['skip', 'nft-*, sqk-*, already, not-wired, short-*, no-address, lock, drop-*', 'no chain']);

  // ===================== Season 2: the REAL QuantumCatchV3 (+ the stand-in renderer) and Season 1 (v2) on one anvil chain =====
  // Missing = a failed run, unless opted out (QW_NO_S2=1)
  const s2 = await startS2Anvil();
  if (!s2) results.push([process.env.QW_NO_S2 === '1' ? 'skip' : 'FAIL', 's2-*', `${s2Skip}: the Season 2 scenarios cannot run${process.env.QW_NO_S2 === '1' ? ' (QW_NO_S2=1)' : ' (QC3_ARTIFACT / QC3_RENDERER, or QW_NO_S2=1 on purpose)'}`]);
  if (s2) {
    try {
      const acc = s2.accounts, V3 = s2.v3, V2 = s2.v2;
      const DROP3 = (day, a, game = V3) => ({ drop: true, spot: null, at: 1, seen: false, nft: { tokenId: QC.netId(QC.nightOfDay(day), a), day, contract: game, image: null } });
      // who plays what: 1 s2-cast (casts on v3 through the page), 4 a Season 1 net (v2, cast elsewhere), 0 the hatcher, 9 seals,
      // 19 the deployer (= the owner until lock); casters ca5700..13 cast on v3 for 5 Nov (the seal decides their draws)
      await s2.mint(acc[1], 5n * CENT);
      await s2.castOn(V2, acc[4]);
      await s2.castOn(V2, acc[7]); await s2.mint(acc[6], 5n * CENT);   // the wallet switch: B (7) has only an early net for 5 Nov; A (6) casts tonight
      // My hamsters: candidates whose early (v2) net for 5 Nov catches (v2's drawOf, before they cast) and who also cast on v3
      // that night (and on v3 for 6 Nov, below); after the seal the first whose v3 net caught is the window's wallet
      const P5w = postOf(NX), WH = [];
      for (let k = 0; WH.length < 5 && k < 400; k++) {
        const a = '0x' + 'a11e' + k.toString(16).padStart(36, '0'), sp = await s2.v2Draw(N5, P5w, QC.netId(N5, a));
        if (NX.tiers[sp] >= 0) { await s2.impersonate(a); await s2.castOn(V2, a); await s2.castOn(V3, a); WH.push(a); }
      }
      assert.equal(WH.length, 5, 'five My hamsters candidates');
      const C = []; for (let k = 0; k < 20; k++) { const a = '0x' + 'ca57' + k.toString(16).padStart(36, '0'); await s2.impersonate(a); await s2.castOn(V3, a); C.push(a); }

      // S2-1. the first screen of Season 2 (no wallet): the small "Season 2" tag (the only new first-screen text), the prizes as
      //       each tier's skins (Uncommon 3, Rare 2, Epic 3, Legendary 2) fitting with the stage and the ONE line at 360x740,
      //       390x844 and 1280x860; the gallery and How it works say Season 2; the lock note below the first screen
      await scenario('s2-first', { width: 360, height: 740, page: s2.html, rpcUrl: s2.url }, async (p, { shot, noHScroll }) => {
        const first = await firstScreenText(p);
        assert.ok(!BANNED_FIRST.test(first), 'no math on the first screen');
        assert.ok(!/season/i.test(first), 'no season words (owner 11-07: nobody knows there was a first one)');
        assert.equal(await txt(p, 'h1'), 'Catch a hamster from another universe.');
        assert.deepEqual(await items(p, '.prz b'), QW.TIER_NAMES);
        assert.equal((await p.$$('.prz .ps')).length, 0, 'no skin names or counts: a surprise (owner 11-07)');
        assert.ok(!/skins?\b|Plain/i.test(await txt(p, '#prow')), 'the prizes row never says skins');
        assert.deepEqual(await p.$$eval('.prz', (e) => e.map((z) => z.querySelectorAll('.pst img').length)), [1, 3, 2, 3, 2], 'each tier\'s skins');
        assert.match(await p.$eval('.prz[data-t="3"]', (e) => e.getAttribute('aria-label')), /^Epic: /);
        assert.equal(await p.$eval('.prz[data-t="3"]', (e) => e.title), '', 'no skin names on hover either');
        const inTiles = () => p.$$eval('.prz', (e) => e.map((z) => { const a = z.getBoundingClientRect(); return [...z.querySelectorAll('.pst img')].every((im) => { const b = im.getBoundingClientRect(); return im.complete && im.naturalWidth > 0 && b.width >= 16 && b.left >= a.left - 0.5 && b.right <= a.right + 0.5 && b.top >= a.top - 0.5; }); }));
        for (const [w, h] of [[360, 740], [390, 844], [1280, 860]]) {
          await vp(p, w, h); await sleep(300);
          await fits(p, h, '#watch', '#prow');
          assert.deepEqual(await inTiles(), [true, true, true, true, true], `${w}x${h}: every skin inside its tile`);
          await noHScroll(`season 2 first screen ${w}x${h}`); await shot(`1-first-${w}x${h}`);
        }
        await vp(p, 360, 740); await sleep(200);
        await p.waitForFunction(() => !document.getElementById('lockn').hidden, { timeout: 15000 });
        assert.equal(await txt(p, '#lockn'), 'Pictures still changing', 'locked() = false: the owner can still change the pictures');
        // the gallery: real Season 2 cards (wheel/art/s2/examples.json, drawn by the renderer's reference), "Season 2 hamsters"
        const EX = JSON.parse(fs.readFileSync(path.join(ROOT, 'wheel/art/s2/examples.json'), 'utf8'));
        assert.equal(await txt(p, '#gk'), 'Hamsters from other universes');
        await scrollTo(p, '#gk'); await sleep(500);
        assert.deepEqual(await p.$$eval('#gallery .gcard b', (e) => e.map((b) => b.textContent)), Object.keys(EX), 'the real examples, in order');
        assert.ok(await p.$eval('#gallery', (e) => e.classList.contains('s2ex')));
        await p.waitForFunction(() => [...document.querySelectorAll('#gallery .gcard img')].every((i) => i.complete && i.naturalWidth > 0), { timeout: 10000 });
        await shot('1b-gallery-360');
        await openDetails(p, 'how');
        assert.ok(!(await hidden(p, '#s2how')));
        assert.equal((await items(p, '#s2how li')).length, 3, 'three sentences');
        await p.waitForFunction(() => !document.getElementById('burnth').hidden, { timeout: 15000 });
        assert.equal(await seenTxt(p, '#howsteps > li:nth-child(5)'), `The fuel. The door only opens for SQK. Every net burns 0.01 test SQK forever. So far the door has eaten ${QC.units(await s2.burnedNow())} SQK.`);
        assert.ok(await hidden(p, '#myham'), 'no wallet: no My hamsters window');
        assert.deepEqual(await items(p, '.s2odds tbody td'), ['Chance', '64 in 100', '23 in 100', '7 in 100', '6 in 100', '~1 in 260'], 'the one-line odds table');
        assert.equal(await p.$$eval('.s2odds tbody tr', (e) => e.length), 1);
        assert.ok(await p.$eval('.s2odds', (t) => t.getBoundingClientRect().right <= t.parentElement.getBoundingClientRect().right + 0.5), 'the odds table fits the phone (no sideways scroll in its box)');
        await openDetails(p, 'check');
        assert.equal(await txt(p, '#recipeh'), 'The recipe in 7 lines'); assert.ok(!(await hidden(p, '#recipe7')));
        assert.match(await txt(p, '#recipe6'), /the hash of the next Sepolia block/);
        assert.match(await txt(p, '#contract'), new RegExp(`contract ${V3} .* Early nets: ${V2}\\.$`));
        const all = await p.evaluate(() => document.body.innerText);
        assert.ok(!/season|quantum catch/i.test(all), `no season words, no old name anywhere: ${(all.match(/.{20}(season|quantum catch).{20}/i) || [''])[0]}`);
        await noHScroll('season 2 details'); await shot('2-check');
        await openDetails(p, 'how'); await shots2(p, shot, '3-how', '#s2how');
        await backToMain(p); await shots2(p, shot, '4-gallery', '#gk'); await shots2(p, shot, '5-prizes', '#prizes');
      });
      // S2-1b. the free practice net once Season 2 is live (it draws no traits): a real Season 2 example of the drawn tier
      //        (wheel/art/s2/examples.json, picked by the spot) on the result card, the podium and My catches; never the
      //        Season 1 look
      await scenario('s2-practice', { width: 390, height: 844, page: s2.html, random: EPIC4.random }, async (p, { shot }) => {
        await openPractice(p);
        assert.equal(await practice(p), EPIC4.spot);
        const L = Object.entries(JSON.parse(fs.readFileSync(path.join(ROOT, 'wheel/art/s2/examples.json'), 'utf8'))).filter(([n]) => n.startsWith('Epic '));
        const [name, x] = L[EPIC4.spot % L.length];
        assert.ok(await p.$eval('#reveal', (e) => e.classList.contains('s2')), 'the Season 2 result card');
        assert.equal(await p.$eval('#revimg', (e) => e.getAttribute('src')), 'data:image/webp;base64,' + x.data, `the example ${name}`);
        assert.equal(await txt(p, '#revt'), `An Epic ${name.slice(5).split(',')[0]} hamster!`);
        assert.match(await txt(p, '#revs'), /^practice/);
        assert.ok(await hidden(p, '#burnth'), 'the public RPC is not reachable here: no total, never a wrong one');
        assert.ok(await p.$eval('#ham', (e) => e.classList.contains('s2')), 'the podium: the example');
        assert.deepEqual(await items(p, '#platew li'), [], 'no Season 1 wears');
        assert.equal(await p.$eval('#mygrid img', (e) => e.getAttribute('src')), 'data:image/webp;base64,' + x.data, 'My catches: the same example');
        await shot('1-practice');
      });
      // S2-2. the cast: ONE signature + ONE transaction, castNetWithPermit on v3 (never v2); the net remembers its contract
      const burned0 = await s2.burnedNow();
      await scenario('s2-cast', { width: 360, height: 740, page: s2.html, storage: PRESET(), wallet: { account: acc[1], rpc: s2.url }, rpcUrl: s2.url }, async (p, { shot }) => {
        await sqkRead(p, () => QCP.sqk.balance != null);
        assert.deepEqual(await p.$eval('#act', (e) => [e.hidden, e.textContent]), [false, CAST_BTN[0]]);
        // the fuel line with the total: the build's count + every net paid since its block, live (both games)
        await p.waitForFunction(() => !document.getElementById('burnt').hidden, { timeout: 15000 });
        assert.equal(await seenTxt(p, '#burn'), `🔥 The door eats 0.01 test SQK · ${QC.units(burned0)} burned so far`, '360 px: without "per net"');
        await fits(p, 740, '#act', '#prow');
        assert.ok((await box(p, '#burn')).bottom <= (await box(p, '#prow')).top, 'the button, the fuel line, then the prizes: all on the first screen');
        await shot('0-fuel-360');
        await p.click('#act');
        await p.waitForFunction(() => !document.getElementById('nftbox').hidden, { timeout: 30000 });
        assert.deepEqual((await p.evaluate(() => window.__sent)).map(([to, d]) => [to, d.slice(0, 10)]), [[V3, QC.SEL.castNetWithPermit]], 'the one transaction goes to the Season 2 contract');
        const n = (await stored(p)).nets['2026-11-05'];
        assert.deepEqual([n.drop, n.spot, n.nft.contract, n.nft.tokenId], [true, null, V3, QC.netId(N5, acc[1])]);
        assert.equal((await s2.result(V3, QC.netId(N5, acc[1]))).status, 0, 'on chain: waiting');
        assert.equal(await s2.result(V2, QC.netId(N5, acc[1])), null, 'nothing on Season 1');
        await p.waitForFunction(() => !document.getElementById('nftnets').hidden, { timeout: 20000 });
        assert.match(await txt(p, '#nftgrid'), /^waiting for the chip5 Nov · #\?$/, 'the chain: one net, Season 2 (no label)');
        assert.ok(!(await hidden(p, '#burn')) && (await box(p, '#burn')).top >= (await box(p, '#nftbox')).bottom, 'the net is in: the fuel line under its card');
        await shot('1-net-in');
      });
      // the 5 Nov night is over; the hatcher posts it on both games (v3 waits for its seal)
      await s2.at(Date.parse('2026-11-06T12:30:00Z'));
      await s2.castOn(V3, acc[4]);                                     // acc 4: an early (v2) net for 5 Nov + tonight's (6 Nov) on v3
      for (const a of WH) await s2.castOn(V3, a);                      // the My hamsters candidates: tonight's net too
      const P5 = postOf(NX);
      await s2.post(V3, N5, P5); await s2.post(V2, N5, P5);
      assert.equal((await s2.result(V3, QC.netId(N5, C[0]))).status, QC.DRAWING, 'v3: posted, not sealed = drawing');
      // S2-3. posted, not sealed: "Drawing…" (one line); no wallet: the public RPC (here: the local chain)
      await scenario('s2-drawing', { width: 360, height: 740, at: Date.parse('2026-11-06T13:00:00Z'), page: s2.html, results: NX.body, storage: PRESET({ '2026-11-05': DROP3('2026-11-05', C[0]) }), rpcUrl: s2.url }, async (p, { shot, rpcLog }) => {
        await p.waitForFunction(() => document.getElementById('prompt').textContent === 'Drawing…', { timeout: 15000 });
        assert.ok(rpcLog.includes(QC.enc.result(QC.netId(N5, C[0]))), 'result() of the net, on its own contract');
        assert.equal(await p.evaluate(() => QCP.stage), '2026-11-05');
        assert.equal(await txt(p, '#stageh'), 'Your net · Thu 5 Nov');
        assert.match(await txt(p, '#mygrid'), /Drawing….*sealed with the next block/);
        assert.equal(await txt(p, '#plateb'), '5 Nov · drawing', 'the plate says it too');
        await shot('1-drawing'); await shots2(p, shot, '2-drawing', '#play');
      });
      // the ONE line under tonight's net card about the same wallet's earlier net (owner 11-07): Drawing… while posted, not sealed
      const NETS3 = (a, game5 = V3) => ({ practice: null, nets: { '2026-11-05': DROP3('2026-11-05', a, game5), '2026-11-06': DROP3('2026-11-06', a) } });
      await scenario('s2-prev-drawing', { width: 360, height: 740, at: Date.parse('2026-11-06T13:00:00Z'), page: s2.html, results: NX.body, storage: NETS3(C[0]), rpcUrl: s2.url }, async (p, { shot }) => {
        await p.waitForFunction(() => document.getElementById('prevnet').textContent === "Last night's net: Drawing…", { timeout: 15000 });
        assert.equal(await p.evaluate(() => QCP.stage), 'tonight', "tonight's net is the first screen; the earlier one is its line");
        assert.match(await txt(p, '#nfttext'), /^✓ Your net is in/);
        await shot('1-prev-drawing');
      });
      // waiting (before 13:00): the result's time in your time zone and a live countdown; a third, older net: "+1 more" (Details)
      await scenario('s2-prev-waiting', { width: 360, height: 740, at: Date.parse('2026-11-06T11:02:00Z'), page: s2.html,
        storage: { practice: null, nets: { ...NETS3(acc[4], V2).nets, '2026-11-04': DROP3('2026-11-04', acc[4], V2) } } }, async (p, { shot, noHScroll }) => {
        assert.equal(await p.evaluate(() => QCP.stage), 'tonight');
        assert.match(await txt(p, '#prevnet'), /^Last night's net: result today at 13:00 · in 5[78] min · \+1 more$/);
        const t0 = await txt(p, '#prevnet .cdr'); await p.evaluate(() => { const r = Date.now; Date.now = () => r() + 61000; }); await sleep(1300);
        assert.notEqual(await txt(p, '#prevnet .cdr'), t0, 'the countdown is live');
        for (const [w, h] of [[360, 740], [390, 844], [1280, 860]]) {
          await vp(p, w, h); await sleep(300); await p.evaluate(() => window.scrollTo(0, 0)); await sleep(150);
          if (w >= 390) assert.ok(await visible(p, '#prevnet', h), `${w}x${h}: the line on the first screen`);
          assert.ok((await box(p, '#prevnet')).top >= (await box(p, '#nftbox')).bottom, 'under the net card');
          await noHScroll(`prev net ${w}`); await shot(`1-prev-waiting-${w}x${h}`);
        }
        await vp(p, 360, 740); await sleep(200);
        await p.click('#prevnet .pmore'); await p.waitForFunction(() => QCP.route === 'details', { timeout: 5000 });
        assert.match(await txt(p, '#waiting'), /Wed 4 Nov: your net.*Thu 5 Nov: your net/, '+1 more: Details lists them all');
      });
      // WALLET SCOPE (owner 11-07, live bug): A casts tonight, then the wallet switches to B, whose only net is an early one for
      // 5 Nov. The deck shows B's state (free SQK) and B's earlier net in the line, never A's "Your net is in"; back to A: A's net
      await scenario('s2-switch', { width: 360, height: 740, at: Date.parse('2026-11-06T11:47:00Z'), page: s2.html, storage: PRESET(), wallet: { account: acc[6], rpc: s2.url } }, async (p, { shot, noHScroll }) => {
        await castNft(p, '2026-11-06');
        assert.match(await txt(p, '#nfttext'), /^✓ Your net is in/);
        assert.ok(await hidden(p, '#prevnet'), 'A has no earlier net');
        await p.evaluate((b) => window.__switchAccount(b), acc[7]);
        await p.waitForFunction(() => document.getElementById('act').textContent === 'Get free test SQK', { timeout: 15000 });
        assert.ok(await hidden(p, '#nftbox'), 'B: never A\'s "Your net is in"');
        assert.equal(await p.evaluate(() => QCP.stage), 'tonight');
        await p.waitForFunction(() => !document.getElementById('prevnet').hidden, { timeout: 15000 });
        assert.match(await txt(p, '#prevnet'), /^Last night's net: result today at 13:00 · in 1[23] min$/, "B's earlier net, in the free-SQK state too");
        assert.equal(await txt(p, '#tnstate'), 'No net yet for this night.', 'Details: B has no net tonight');
        const st = await stored(p);
        assert.ok(st.others[acc[6]] && st.others[acc[6]]['2026-11-06'], "A's net is kept, under A's address");
        assert.ok(!st.nets['2026-11-06'] && st.nets['2026-11-05'].nft.contract === V2, "B's own nets only");
        await noHScroll('switch'); await shot('1-switched-to-B');
        for (const [w, h] of [[390, 844], [1280, 860]]) { await vp(p, w, h); await sleep(300); await p.evaluate(() => window.scrollTo(0, 0)); await shot(`2-switched-to-B-${w}x${h}`); }
        await vp(p, 360, 740); await sleep(200);
        await p.evaluate((a) => window.__switchAccount(a), acc[6]);
        await p.waitForFunction(() => !document.getElementById('nftbox').hidden, { timeout: 15000 });
        assert.match(await txt(p, '#nfttext'), /^✓ Your net is in/, 'back to A: its net again');
        assert.ok(await hidden(p, '#prevnet'), 'and not B\'s earlier net');
      });
      // EMPTY WALLET (owner 11-07): a wallet with no Sepolia test ETH cannot send anything, not even the free SQK claim: the
      // button opens a free ETH faucet with one line; ETH arrives (read again every ~15 s; here 0.3 s): the normal flow
      const POOR = '0x' + 'e7401'.padStart(40, '0');           // (built: a fresh address with no test ETH)
      await scenario('s2-noeth', { width: 390, height: 844, at: Date.parse('2026-11-06T11:47:00Z'), page: s2.html, storage: PRESET(), wallet: { account: POOR, rpc: s2.url } }, async (p, { shot, noHScroll }) => {
        await p.waitForFunction(() => document.getElementById('act').textContent === 'Get free test ETH first →', { timeout: 15000 });
        assert.equal(await p.evaluate(() => QCP.eth), '0');
        assert.equal(await txt(p, '#sqkoutt'), "You need a little test ETH for the network fee. It's free.");
        assert.ok(!(await hidden(p, '#sqkout')) && (await hidden(p, '#burn')), 'the one line; no fuel line under the ETH button');
        await noHScroll('no eth'); await shot('1-no-eth-390x844');
        await vp(p, 1280, 860); await sleep(300); await p.evaluate(() => window.scrollTo(0, 0)); await shot('2-no-eth-1280x860');
        await p.evaluate(() => { window.__QW_ETH_POLL = 300; HTMLAnchorElement.prototype.click = function () { window.__opened = [this.href, this.target, this.rel]; }; });
        await p.click('#act');
        assert.deepEqual(await p.evaluate(() => window.__opened), ['https://cloud.google.com/application/web3/faucet/ethereum/sepolia', '_blank', 'noopener'], 'a free Sepolia ETH faucet, in a new tab');
        assert.deepEqual(await p.evaluate(() => window.__sent), [], 'nothing sent');
        await s2.rpc('anvil_setBalance', [POOR, '0xde0b6b3a7640000']);
        await p.waitForFunction(() => document.getElementById('act').textContent === 'Get free test SQK', { timeout: 10000 });
        assert.equal(await p.evaluate(() => QCP.eth), '1000000000000000000');
        assert.ok(await hidden(p, '#sqkout'), 'the ETH line is gone');
      });
      // the seal (anyone, a later block): every v3 net of the night is drawn now
      await s2.rpc('evm_mine'); await s2.seal(N5);
      const R = []; for (const a of C) R.push([a, await s2.result(V3, QC.netId(N5, a))]);
      const caught = R.filter(([, r]) => r.status === 1).sort((a, b) => b[1].tier - a[1].tier), away = R.filter(([, r]) => r.status === 2);
      assert.ok(caught.length, 'a caught net among 20 casters');
      const [CC, RC] = caught[0];
      assert.deepEqual([RC.dna.status, RC.dna.tier, RC.dna.spot], [1, RC.tier, RC.spot], 'dnaOf agrees with result()');
      const want = await s2.meta(V3, QC.netId(N5, CC));
      assert.match(want.image, /^data:image\/svg\+xml;base64,/);
      // LATEST CATCHES (owner 11-07): the build reads the newest posted night's nets from the chain (the NetPaid casters, each
      // net's result()); one slim line under the prizes: name · tier · night, a tap opens its big card. A household wallet's
      // net (data/private-wallets.json) is named but has no id: no link, no wallet in the page
      {
        const fxd = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-tk-')), PRIV = caught.length > 1 ? caught[caught.length - 1][0] : null;
        fs.writeFileSync(path.join(fxd, 'posts.json'), JSON.stringify({ games: { [V3]: { posts: { [N5]: {} }, nets: { [N5]: C } } } }));
        fs.writeFileSync(path.join(fxd, 'private.json'), JSON.stringify({ wallets: PRIV ? [PRIV] : [] }));
        const tkHtml = s2.build({ QC_POSTS: path.join(fxd, 'posts.json'), QC_CHAIN_RPC: s2.url, QC_PRIVATE: path.join(fxd, 'private.json') });
        const LT = JSON.parse(tkHtml.toString().match(/const DATA = (\{.*?\});\n/s)[1]).latest;
        assert.deepEqual([LT.day, LT.caught.length, LT.away], ['2026-11-05', caught.length, away.length], 'the night, every caught net, how many got away');
        if (PRIV) assert.ok(!tkHtml.toString().toLowerCase().includes(PRIV.slice(2)), 'the household wallet is nowhere in the page');
        await scenario('s2-ticker', { width: 390, height: 844, at: Date.parse('2026-11-06T13:00:00Z'), page: tkHtml, results: NX.body, rpcUrl: s2.url }, async (p, { shot, noHScroll }) => {
          const W = caught.map(([a, r]) => ({ hex: BigInt(QC.netId(N5, a)).toString(16), tier: r.tier - 1, priv: a === PRIV }));
          const names = await p.evaluate((W) => W.map((w) => QCP.nameOf('v3:' + w.hex, w.tier)), W);
          const key = (x) => JSON.stringify(x);
          assert.deepEqual(LT.caught.map((x) => key([x.name, x.tier, x.id || null])).sort(), W.map((w, i) => key([names[i], w.tier, w.priv ? null : 'v3-' + w.hex])).sort(),
            "every caught net: the name its big card gives it (the page's own nameOf), its tier; the household's without an id");
          assert.ok(!(await hidden(p, '#ticker')) && (await box(p, '#ticker')).top > (await box(p, '#prizes')).bottom && (await box(p, '#ticker')).bottom < (await box(p, '#lore')).top, 'between the prizes and the story band');
          const shown = await p.$$eval('#tkl li:not(.dup)', (e) => e.map((x) => [x.textContent, !!x.querySelector('button')]));
          assert.deepEqual(shown, [...LT.caught.map((x) => [`${x.name} · ${['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'][x.tier]} · 5 Nov`, !!x.id]), ...(LT.away ? [[`${LT.away} got away · 5 Nov`, false]] : [])]);
          assert.equal(await p.$$eval('#tkl li.dup', (e) => e.length), shown.length, 'the list twice (a seamless loop)');
          assert.equal(await p.$eval('#tkl', (e) => getComputedStyle(e).animationName), 'tkmove', 'it scrolls by itself');
          await p.hover('#ticker'); assert.equal(await p.$eval('#tkl', (e) => getComputedStyle(e).animationPlayState), 'paused', 'still under the mouse');
          await noHScroll('ticker'); await p.evaluate(() => document.getElementById('ticker').scrollIntoView({ block: 'center' })); await sleep(200); await shot('1-ticker-390x844');
          const first = LT.caught.find((x) => x.id);
          await p.click(`#tkl li:not(.dup) button[data-id="${first.id}"]`);
          await p.waitForFunction((id) => QCP.big === id, { timeout: 20000 }, first.id);
          assert.equal(await txt(p, '#bigname'), first.name, 'a tap: its big card, the same name');
          await p.keyboard.press('Escape'); await p.waitForFunction(() => !QCP.big, { timeout: 5000 });
          await vp(p, 1280, 860); await sleep(300); await p.evaluate(() => document.getElementById('ticker').scrollIntoView({ block: 'center' })); await sleep(200); await shot('2-ticker-1280x860');
          await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]); await sleep(100);
          assert.equal(await p.$eval('#tkl', (e) => getComputedStyle(e).animationName), 'none', 'reduced motion: a still list');
          assert.ok(await hidden(p, '#tkl li.dup'), 'once');
        });
        fs.rmSync(fxd, { recursive: true, force: true });
      }
      // S2-4. caught: the result card and the podium show the chain's own picture (tokenURI, read once over the public RPC);
      //       My catches too; still "Pictures still changing"
      for (const [w, h] of [[390, 844], [1280, 860]]) {
        await scenario(`s2-caught-${w}`, { width: w, height: h, at: Date.parse('2026-11-06T13:00:00Z'), page: s2.html, results: NX.body, storage: PRESET({ '2026-11-05': DROP3('2026-11-05', CC) }), rpcUrl: s2.url }, async (p, { shot, noHScroll, rpcLog }) => {
          await p.waitForFunction((sp) => QCP.store().nets['2026-11-05'].spot === sp, { timeout: 15000 }, RC.spot); await sleep(300);
          assert.equal(await txt(p, '#prompt'), 'Your result is ready.');
          await p.click('#act'); await revealed(p);
          const tier = QW.TIER_NAMES[RC.tier - 1];
          await p.waitForFunction(() => document.getElementById('revimg').getAttribute('src'), { timeout: 20000 }); await sleep(200);
          assert.ok(await p.$eval('#reveal', (e) => e.classList.contains('s2')), 'the Season 2 result card');
          assert.equal(await p.$eval('#revimg', (e) => e.getAttribute('src')), want.image, 'the picture IS the chain\'s tokenURI image');
          assert.ok(await p.$eval('#revimg', (e) => e.complete && e.naturalWidth > 0 && e.getBoundingClientRect().width >= 90), 'and it draws');
          assert.equal(await txt(p, '#revt'), `${/^[AEIOU]/.test(tier) ? 'An' : 'A'} ${tier} ${MOCK_SKIN[RC.tier - 1]} hamster!`, 'its skin named by the chain\'s metadata');
          assert.ok(await p.$eval('#ham', (e) => e.classList.contains('s2')), 'the podium: the chain\'s own picture');
          assert.ok(await p.$eval('#ham', (e) => { const g = e.getContext('2d').getImageData(e.width / 2 - 2, e.height * 0.4, 4, 4).data; return g[3] > 0; }), 'painted');
          assert.deepEqual(await items(p, '#platew li'), [RC.dna.tiers[1] > 1 ? 'Wizard hat' : 'plain look'], 'what it wears, from the metadata');
          // the other 15 tiles: each tier's Season 2 skin (the prizes row's heads), never a Season 1 look; yours: your picture
          assert.deepEqual(await p.$$eval('.spot canvas', (e) => e.map((c) => c.dataset.want.split(':')[0])), [...Array(16).keys()].map((s) => (s === RC.spot ? 's2' : 't2')));
          await noHScroll('s2 caught'); await shot('1-caught');
          await openDetails(p, 'mine');
          await p.waitForFunction(() => document.querySelector('#mygrid img[src]'), { timeout: 20000 });
          assert.equal(await p.$eval('#mygrid img', (e) => e.getAttribute('src')), want.image, 'My catches: the same on-chain picture');
          assert.equal(rpcLog.filter((d) => d === QC.enc.tokenURI(QC.netId(N5, CC))).length, 1, 'the big read happens once (kept in memory)');
          assert.equal(JSON.stringify(await stored(p)).includes(want.image.slice(30, 90)), false, 'never in localStorage');
          await shot('2-my-catches');
          await backToMain(p); await scrollTo(p, '#gk'); await sleep(300);
          assert.equal(await txt(p, '#lockn'), 'Pictures still changing');
          await shot('3-gallery-not-locked');
        });
      }
      if (away.length) {
        await scenario('s2-away', { width: 360, height: 740, at: Date.parse('2026-11-06T13:00:00Z'), page: s2.html, results: NX.body, storage: PRESET({ '2026-11-05': DROP3('2026-11-05', away[0][0]) }), rpcUrl: s2.url }, async (p) => {
          await p.waitForFunction(() => QCP.store().nets['2026-11-05'].spot != null, { timeout: 15000 }); await sleep(300);
          await p.click('#act'); await revealed(p);
          assert.match(await txt(p, '#revt'), /^Your hamster got away\.$/);
          assert.ok(!(await p.$eval('#reveal', (e) => e.classList.contains('s2'))), 'no picture to show: got away');
        });
      } else results.push(['skip', 's2-away', 'none of the 20 casters got away']);
      // S2-4b. the REAL renderer (the painted Season 2 art, ~0.2 MB cards) set by the owner: the same net now shows the real
      //        card, straight from tokenURI, on the result card, the podium and its tile
      const real = await s2.realRenderer();
      if (!real) results.push([process.env.QW_NO_S2 === '1' ? 'skip' : 'FAIL', 's2-real', `no S2Renderer build next to ${QC3_JSON} (forge build in contracts/)`]);
      else {
        const big = await s2.meta(V3, QC.netId(N5, CC));
        const svg = Buffer.from(big.image.slice(26), 'base64').toString('utf8');
        assert.ok(big.image !== want.image && /<g id='painted'/.test(svg) && (svg.match(/href='data:image\/webp;base64,/g) || []).length >= 2, `the real painted card (${big.image.length} chars), not the stand-in's`);
        assert.equal((await s2.result(V3, QC.netId(N5, CC))).spot, RC.spot, 'a new renderer changes the picture, never the draw');
        for (const [w, h] of [[390, 844], [1280, 860]]) {
          await scenario(`s2-real-${w}`, { width: w, height: h, at: Date.parse('2026-11-06T13:00:00Z'), page: s2.html, results: NX.body, storage: PRESET({ '2026-11-05': DROP3('2026-11-05', CC) }), rpcUrl: s2.url }, async (p, { shot, noHScroll }) => {
            await p.waitForFunction((sp) => QCP.store().nets['2026-11-05'].spot === sp, { timeout: 15000 }, RC.spot); await sleep(300);
            await p.click('#act'); await revealed(p);
            await p.waitForFunction(() => document.getElementById('revimg').getAttribute('src'), { timeout: 30000 }); await sleep(600);
            assert.equal(await p.$eval('#revimg', (e) => e.getAttribute('src')), big.image, 'the real card, straight from tokenURI');
            assert.ok(await p.$eval('#revimg', (e) => e.complete && e.naturalWidth > 0), 'it draws');
            const tier = QW.TIER_NAMES[RC.tier - 1];
            assert.equal(await txt(p, '#revt'), `${/^[AEIOU]/.test(tier) ? 'An' : 'A'} ${tier} ${big.attr.Skin} hamster!`, 'the skin as the chain names it');
            assert.ok(await p.$eval(`.spot[data-spot="${RC.spot}"] canvas`, (e) => e.dataset.want.startsWith('s2:')), 'its tile: the chain\'s picture too');
            // the picture on the podium is whole on the first screen (a PC night view: the stage's floor is below the fold)
            await p.evaluate(() => window.scrollTo(0, 0)); await sleep(150);
            const cut = await p.evaluate(() => { const c = document.getElementById('ham'), r = c.getBoundingClientRect(), H = c.height, W = c.width, g = c.getContext('2d');
              const y = Math.floor((innerHeight - r.top) * H / r.height), row = (yy) => (yy >= 0 && yy < H ? g.getImageData(W / 2 - 60, yy, 120, 1).data.some((v, i) => i % 4 === 3 && v > 0) : false);
              return { below: row(y + 2), inside: row(Math.max(0, y - 60)) || y >= H }; });
            assert.deepEqual(cut, { below: false, inside: true }, 'nothing of the picture below the fold');
            await noHScroll('s2 real'); await shot('1-real-card');
            await scrollTo(p, '#reveal'); await sleep(200); await shot('2-real-card-result');
          });
        }
      }
      // ready: "Last night's catch is ready →" opens it (the result's replay and card). (On load a ready result comes first, as
      // before; tonight's screen keeps the line)
      await scenario('s2-prev-ready', { width: 390, height: 844, at: Date.parse('2026-11-06T13:00:00Z'), page: s2.html, results: NX.body, storage: NETS3(acc[4], V2), rpcUrl: s2.url }, async (p, { shot }) => {
        await p.waitForFunction(() => QCP.store().nets['2026-11-05'].spot != null, { timeout: 15000 }); await sleep(300);
        assert.equal(await p.evaluate(() => QCP.stage), '2026-11-05', 'a result waiting to be seen opens first');
        await p.evaluate(() => QCP.select('tonight')); await sleep(250);
        assert.equal(await txt(p, '#prevnet'), "Last night's catch is ready →");
        assert.ok(await visible(p, '#prevnet', 844), 'on the first screen');
        await shot('1-prev-ready');
        for (const [w, h] of [[360, 740], [1280, 860]]) { await vp(p, w, h); await sleep(300); await p.evaluate(() => window.scrollTo(0, 0)); await shot(`2-prev-ready-${w}x${h}`); }
        await vp(p, 390, 844); await sleep(200);
        await p.click('#prevnet .pready'); await revealed(p);
        assert.equal(await p.evaluate(() => QCP.stage), '2026-11-05', 'it opens that night');
        assert.match(await txt(p, '#revt'), /^(An? \w+ \w+ hamster!|Your hamster got away\.)$/, 'its result card');
        assert.equal((await stored(p)).nets['2026-11-05'].seen, true);
      });
      // the big card of a v3 catch from a shared link: the chain's own picture, the traits from its metadata, "Your drop" from dnaOf
      await scenario('s2-big', { width: 390, height: 844, at: Date.parse('2026-11-06T13:00:00Z'), page: s2.html, results: NX.body, rpcUrl: s2.url, hash: 'hamster-v3-' + BigInt(QC.netId(N5, CC)).toString(16) }, async (p, { shot, noHScroll }) => {
        await p.waitForFunction(() => QCP.big && document.getElementById('bigimg').getAttribute('src'), { timeout: 20000 }); await sleep(600);
        assert.equal(await p.$eval('#bigimg', (e) => e.getAttribute('src')), (await s2.meta(V3, QC.netId(N5, CC))).image, 'the chain\'s own picture');
        const tier = QW.TIER_NAMES[RC.tier - 1];
        assert.equal(await txt(p, '#bigtier'), `${tier} · from ${['the Home Burrow', 'the Wild Worlds', 'the Machine Worlds', 'the Dream Worlds', 'the Golden World'][RC.tier - 1]}`);
        const kv = Object.fromEntries(await p.$$eval('#bigkv dt', (e) => e.map((d) => [d.textContent, d.nextElementSibling.textContent])));
        assert.equal(kv['Your drop'], `${(Number(BigInt(RC.dna.word) % BigInt(RC.shots)) + 1).toLocaleString('en-US')} of 4,000`, 'the drop: dnaOf\'s word mod the shots');
        assert.ok((await items(p, '#bigtraits li')).length >= 1, 'traits from the metadata');
        await noHScroll('s2 big'); await shot('1-big-390x844');
        await vp(p, 1280, 860); await sleep(400); await shot('2-big-1280x860');
        // the overlay's own class (the twin test's big number is .big: it once turned that into a full-screen layer) and
        // a share button its own height on the PC (the PC .btn is 84 px tall)
        const [twinPos, shareH] = await p.evaluate(() => [getComputedStyle(document.getElementById('twinpct')).position, document.getElementById('bigshare').getBoundingClientRect().height]);
        assert.equal(twinPos, 'static', 'the twin test\'s number stays in its place'); assert.ok(shareH <= 64, `Share on X: ${shareH} px tall`);
      });
      // S2-5. Season 1 still shows: a v2 net of this wallet (this browser knew nothing): read from the Season 1 contract,
      //       its result and its old look, labelled "Season 1"
      await scenario('s2-season1', { width: 360, height: 740, at: Date.parse('2026-11-06T13:00:00Z'), page: s2.html, results: NX.body, storage: PRESET(), wallet: { account: acc[4], rpc: s2.url } }, async (p, { shot }) => {
        await p.waitForFunction(() => { const n = QCP.store().nets['2026-11-05']; return !!n && n.spot != null && QCP.stage === '2026-11-05'; }, { timeout: 20000 }); await sleep(300);
        const n = (await stored(p)).nets['2026-11-05'], r1 = await s2.result(V2, QC.netId(N5, acc[4]));
        assert.deepEqual([n.nft.contract, n.spot], [V2, r1.spot], 'the Season 1 net, from the Season 1 contract');
        assert.equal(await txt(p, '#stageh'), 'Your early net · Thu 5 Nov');
        await p.click('#act'); await revealed(p);
        assert.match(await txt(p, '#revs'), /^early net/, 'the result card says early net');
        assert.ok(!(await p.$eval('#reveal', (e) => e.classList.contains('s2'))), 'Season 1: its old look (no Season 2 picture)');
        await p.waitForFunction(() => !document.getElementById('nftnets').hidden, { timeout: 15000 });
        assert.match(await txt(p, '#nftgrid'), /5 Nov · #\d+early net$/, 'My net NFTs: labelled early net');
        assert.match(await txt(p, '#mygrid'), /early net/);
        assert.ok(!/season/i.test(await p.evaluate(() => document.body.innerText)), 'no season words');
        assert.deepEqual(await asked(p), [], 'reading asks nothing');
        await shot('1-season1'); await shots2(p, shot, '2-season1');
      });
      // My hamsters (owner 11-07): the connected wallet's nets under the prizes: an early (v2) catch, a v3 catch not seen yet
      // (Ready!), tonight's v3 net (waiting); newest first; a tap opens the result / goes to the deck
      const W = (await Promise.all(WH.map(async (a) => [a, await s2.result(V3, QC.netId(N5, a))]))).find(([, r]) => r.status === 1);
      assert.ok(W, 'a candidate whose v3 net caught');
      const [WA, WR] = W, WE = await s2.result(V2, QC.netId(N5, WA)), WIMG = (await s2.meta(V3, QC.netId(N5, WA))).image;
      assert.equal(WE.status, 1, 'its early net caught (picked with v2\'s drawOf)');
      await scenario('s2-myham', { width: 390, height: 844, at: Date.parse('2026-11-06T13:00:00Z'), page: s2.html, results: NX.body, storage: { practice: null, nets: {} }, wallet: { account: WA, rpc: s2.url }, rpcUrl: s2.url }, async (p, { shot, noHScroll }) => {
        await p.waitForFunction(() => !document.getElementById('myham').hidden && document.querySelectorAll('#mhrow .mhc').length === 3, { timeout: 20000 }); await sleep(400);
        const cards = () => p.$$eval('#mhrow .mhc', (e) => e.map((c) => [c.dataset.day, c.dataset.k, c.querySelector('.mt').textContent, c.querySelector('.md').textContent]));
        const c0 = await cards();
        assert.deepEqual(c0.map((c) => c.slice(0, 2)), [['2026-11-06', 'waiting'], ['2026-11-05', 'ready'], ['2026-11-05', 'caught']], 'newest first: tonight (waiting), 5 Nov v3 (not seen yet), 5 Nov early (caught)');
        assert.equal(c0[0][2], 'Result tomorrow at 13:00'); assert.match(c0[0][3], /^in \d+ h \d+ min$/);
        assert.deepEqual(c0[1].slice(2), ['Ready!', '5 Nov']);
        assert.deepEqual(c0[2].slice(2), [QW.TIER_NAMES[WE.tier - 1], '5 Nov'], 'the early catch: its tier and date');
        assert.equal(await txt(p, '#myhamh'), 'My hamsters'); assert.ok(await hidden(p, '#mhall'));
        assert.equal(await p.$eval('#mycountn', (e) => e.textContent), '2', 'My hamsters 2: the early catch + the v3 catch not revealed yet');
        assert.ok(await p.$eval('#mycount', (e) => e.classList.contains('ready')), 'the pulse: a result is ready');
        assert.equal(await p.$$eval('#myham p, #myham .small', (e) => e.length), 0, 'nothing but the heading and the cards');
        assert.ok((await box(p, '#myham')).top >= (await box(p, '#prizes')).bottom && (await box(p, '#myham')).bottom <= (await box(p, '#soon')).top + 1, 'under the prizes, above the battles band');
        // the header: "My hamsters n" (a hamster icon + the count on a phone): it scrolls to the window
        assert.ok(await p.$eval('#mycount svg.myshort', (e) => getComputedStyle(e).display !== 'none'), 'phones: the icon');
        await p.click('#mycount'); await sleep(600);
        assert.ok((await box(p, '#myham')).top >= -2 && (await box(p, '#myham')).top < 120, 'the header button brings the window up');
        for (const [w, h] of [[360, 740], [390, 844], [1280, 860]]) { await vp(p, w, h); await sleep(350); await scrollTo(p, '#myham'); await sleep(300); await noHScroll(`my hamsters ${w}`); await shot(`1-myham-${w}x${h}`); }
        await vp(p, 390, 844); await sleep(300);
        // the Ready! card: its night's replay and result; then the card is the chain's own picture
        await scrollTo(p, '#myham'); await p.click('#mhrow .mhc[data-k="ready"]'); await revealed(p);
        assert.equal(await p.evaluate(() => QCP.stage), '2026-11-05');
        await p.waitForFunction(() => document.getElementById('revimg').getAttribute('src'), { timeout: 20000 });
        assert.equal(await p.$eval('#revimg', (e) => e.getAttribute('src')), WIMG, 'the result card: the chain\'s picture');
        await scrollTo(p, '#myham'); await sleep(300);
        await p.waitForFunction(() => { const c = document.querySelectorAll('#mhrow .mhc')[1]; return c && c.dataset.k === 'caught' && c.querySelector('canvas').dataset.want.startsWith('s2:'); }, { timeout: 20000 });
        assert.equal((await cards())[1][2], QW.TIER_NAMES[WR.tier - 1], 'seen: its tier, its picture from the contract');
        await shot('2-myham-after');
        // a waiting card: tonight's deck (the net card), with the fuel line under it
        await p.click('#mhrow .mhc[data-k="waiting"]'); await sleep(500);
        assert.equal(await p.evaluate(() => QCP.stage), 'tonight');
        assert.ok(await visible(p, '#nftbox', 844), 'the deck: tonight\'s net card on screen');
        await p.waitForFunction(() => !document.getElementById('burnt').hidden, { timeout: 15000 });
        assert.match(await seenTxt(p, '#burn'), /^🔥 The door eats 0\.01 test SQK · \d+(\.\d+)? burned so far$/, '390 px: without "per net"');
        await shot('3-deck-fuel');
      });
      // a wallet with no net: no window; the header button opens Details › My catches
      await scenario('s2-myham-empty', { width: 360, height: 740, page: s2.html, storage: { practice: null, nets: {} }, wallet: { account: acc[2], rpc: s2.url } }, async (p) => {
        await p.waitForFunction(() => window.__walletLog.filter((m) => m === 'eth_call').length >= 16, { timeout: 15000 }); await sleep(500);
        assert.ok(await hidden(p, '#myham'), 'an empty wallet: no window');
        await p.click('#mycount'); await p.waitForFunction(() => QCP.route === 'details', { timeout: 5000 });
      });
      // S2-6. lock(): the owner gives up the renderer for good; the page says so
      await s2.lock();
      await scenario('s2-locked', { width: 390, height: 844, page: s2.html, rpcUrl: s2.url }, async (p, { shot }) => {
        await p.waitForFunction(() => !document.getElementById('lockn').hidden, { timeout: 15000 });
        assert.equal(await txt(p, '#lockn'), 'Locked forever ✓');
        await scrollTo(p, '#gk'); await sleep(300); await shot('1-locked'); await shots2(p, shot, '2-locked', '#gk');
      });
      // S2-7. a phone browser without a wallet: still the one MetaMask button (Season 2 build)
      await scenario('s2-wallet-app', { width: 390, height: 844, page: s2.html, ua: IPHONE }, async (p, { shot, noHScroll }) => {
        assert.equal(await txt(p, '#watch'), 'Open this page in your wallet app to cast a net. Open in MetaMask What you need');
        assert.ok((await p.$eval('#mmlink', (e) => e.getBoundingClientRect().bottom)) <= 844, 'the MetaMask button is on the first screen');
        await noHScroll('s2 wallet app'); await shot('1-wallet-app');
      });
    } finally { s2.proc.kill('SIGTERM'); }
  }

  // 15. fetch blocked (as in the claude.ai preview: no wallet either) AND no localStorage: watch mode, the practice works (here
  //     its drop is chip noise: got away), nothing live is shown
  await scenario('blocked', { width: 360, height: 740, scheme: 'light', api: 'abort', noStorage: true, results: null, random: NOISE4.random }, async (p, { shot, noHScroll }) => {
    await sleep(1200);
    assert.ok(await hidden(p, '#live'), 'ALIVE: his wheel hidden'); assert.ok(await hidden(p, '#sofar'), 'no live rounds');
    assert.ok(await hidden(p, '#netsn') && await hidden(p, '#alive'), 'no nets count, no ALIVE line at all');
    assert.equal(await p.evaluate(() => QCP.stage), 'tonight');
    await watchMode(p);
    await openPractice(p);
    const s = await practice(p);
    assert.equal(s, NOISE4.spot);
    assert.equal(await txt(p, '#revt'), 'Your hamster got away.');
    assert.match(await txt(p, '#revs'), new RegExp(`^practice ?Your drop hit No\\. ${s}, a spot he could not reach: chip noise\\.$`));
    assert.equal(await p.$eval('#mycountn', (e) => e.textContent), '0', 'got away: no catch (and no storage needed)');
    assert.equal(await txt(p, '#act'), "See tonight's net");
    await p.click('#act'); await sleep(200);
    await watchMode(p);
    assert.match(await txt(p, '#prompt'), /^Nets close 22:00 · /);
    await noHScroll('blocked'); await shot('1-blocked');
  });

  for (const r of results) console.log(r.join('  '));
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`${results.filter((r) => r[0] === 'ok').length}/${results.filter((r) => r[0] !== 'skip').length} scenarios passed${results.some((r) => r[0] === 'skip') ? ' (some SKIPPED, see above)' : ''}; screenshots in ${SHOTS}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
