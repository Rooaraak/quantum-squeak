// Browser tests of the built Quantum Catch page (puppeteer + Chrome, one short browser per scenario: a cron kills old Chrome
// processes).   node wheel/test/page.test.cjs [shots dir]      (on a shared box, run it under the heavy-job lock)
// Tool paths: PUPPETEER_PATH / CHROME / ANVIL, else wheel/test/local.json (not in git), else require('puppeteer') + PATH.
// Network: the page is served from 127.0.0.1 (with results.json next to it); Google Fonts are always aborted, the status API
// is mocked (RUNNING) or aborted, the Sepolia RPC is mocked (recorded-style answers) or aborted, like the claude.ai preview.
// Casting a net = minting its free test NFT (R6'): every scenario that casts uses a LOCAL anvil chain (chain id 11155111,
// never a public network) with the real QuantumCatch bytecode (QC_ARTIFACT, else contracts/out: run forge build first) and a
// minimal window.ethereum shim (an unlocked anvil test account). Without anvil or the artifact the run FAILS, unless
// QW_NO_CHAIN=1 is set on purpose (then every chain scenario is listed as skipped). Scenarios without a wallet check watch mode.
// Tiers on the page are checked against the Python reference wheel/test/tier_ref.py (the owner's rank rule). Console errors count as failures, except the
// "Failed to load resource" lines of the deliberately aborted requests; every page error is fatal.
// Clock: Date.now() starts at a fixed moment per scenario (default Thu 5 Nov 2026 17:30 UTC); time zone Europe/Ljubljana
// (UTC+1), locale en-GB, so "your time" is 22:00 for the 21:00 UTC lock.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const { execFileSync, spawn } = require('child_process');
const LOCAL = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'local.json'), 'utf8')); } catch (e) { return {}; } })();
const puppeteer = require(process.env.PUPPETEER_PATH || LOCAL.puppeteer || 'puppeteer');
const QW = require('../engine.js'), QC = require('../catch.js');

const ROOT = path.join(__dirname, '..', '..');
const REF = JSON.parse(execFileSync('python3', [path.join(__dirname, 'tier_ref.py')], { encoding: 'utf8', maxBuffer: 64 << 20 }));
const refOf = (job) => { const x = REF.real.find((r) => r.job_id === job); assert.ok(x, `${job} in the Python reference`); return x; };
// the ring tag of a spot after the reveal: the tier of a catch, the share of a spot in reach he got away from, 'out'
const tagOf = (x, s) => `${s} ${!x.reach[s] ? 'out' : x.tiers[s] ? QW.TIER_NAMES[x.tiers[s] - 1] : QW.pctText(x.counts[s] / x.shots)}`;
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

function serve(body, resultsBody) {
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
  const { width, height, scheme = 'light', api = 'mock', fast = true, noStorage = false, page = html, at = T0, storage = null, rpc = null, wallet = null } = o;
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
      if (u.startsWith('https://ethereum-sepolia-rpc.publicnode.com') && rpc) {
        if (r.method() === 'OPTIONS') return r.respond({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' } });
        const q = JSON.parse(r.postData()); rpcLog.push(q.params[0].data);
        let out; try { out = { jsonrpc: '2.0', id: q.id, result: rpc(q.params[0].to, q.params[0].data) }; } catch (e) { out = { jsonrpc: '2.0', id: q.id, error: { code: -32000, message: e.message } }; }
        return r.respond({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify(out) });
      }
      aborted.add(u.split('?')[0].replace(/[^/]*$/, '')); aborted.add(u); r.abort();
    });
    await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    await p.emulateTimezone('Europe/Ljubljana');
    await (await p.target().createCDPSession()).send('Emulation.setLocaleOverride', { locale: 'en-GB' });
    await p.setViewport({ width, height, deviceScaleFactor: 1 });
    await p.evaluateOnNewDocument((fast, noStorage, at, storage, KEY, wallet) => {
      if (fast) window.__QW_FAST = 1;
      const real = Date.now.bind(Date), off = at - real(); Date.now = () => real() + off;     // the fixed moment, then time flows
      if (noStorage) Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('storage blocked'); } });
      else if (storage && !sessionStorage.getItem('qc-preset')) { localStorage.setItem(KEY, JSON.stringify(storage)); sessionStorage.setItem('qc-preset', '1'); }
      if (wallet) {      // a browser wallet for the page: one anvil test account, Sepolia selected, everything else to the local node
        window.__walletLog = [];
        const script = (wallet.send || []).slice();      // how the user answers each castNet prompt: 'reject' | 'hold' (until __releaseSend()) | default yes
        window.ethereum = { request: async ({ method, params }) => {
          window.__walletLog.push(method);
          if (method === 'eth_sendTransaction' && script.length) {
            const k = script.shift();
            if (k === 'reject') { const e = new Error('User rejected the request.'); e.code = 4001; throw e; }
            if (k === 'hold') await new Promise((r) => { window.__releaseSend = r; });
          }
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [wallet.account];
          if (method === 'eth_chainId') return '0xaa36a7';
          if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
          const r = await fetch(wallet.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] }) });
          const j = await r.json(); if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; } return j.result;
        } };
      }
    }, fast, noStorage, at, storage, KEY, wallet);
    await p.goto(`http://127.0.0.1:${srv.address().port}/`, { waitUntil: 'load' });
    await p.waitForFunction(() => window.QCP && document.querySelectorAll('.spot').length === 16, { timeout: 15000 });
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
const txt = (p, sel) => p.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim());
const hidden = (p, sel) => p.$eval(sel, (e) => e.hidden || getComputedStyle(e).display === 'none');
const stored = (p) => p.evaluate((KEY) => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return 'blocked'; } }, KEY);
const scrollTo = (p, sel) => p.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'start' }), sel);
const box = (p, sel) => p.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, h: r.height, docTop: r.top + scrollY }; }, sel);
const best = (p) => p.evaluate(() => { let b = -1, bs = -1; for (let s = 0; s < 16; s++) { const h = QCP.spotResult(QCP.stage, s); if (h.reach && h.share > bs) { bs = h.share; b = s; } } return b; });
const outSpot = (p) => p.evaluate(() => { for (let s = 0; s < 16; s++) if (!QCP.spotResult(QCP.stage, s).reach) return s; return -1; });
const visible = async (p, sel, h) => { const b = await box(p, sel); return b.h > 0 && b.top >= 0 && b.bottom <= h; };
const revealed = (p, t = 40000) => p.waitForFunction(() => !QCP.playing && !document.getElementById('reveal').hidden, { timeout: t });
const firstScreenText = (p) => p.evaluate(() => document.querySelector('.hero').innerText + '\n' + document.getElementById('play').innerText);

// the practice flow up to the result (fast mode): returns the spot
async function practice(p) {
  const s = await best(p);
  await p.click(`.spot[data-spot="${s}"]`); await sleep(120);
  await p.click('#act'); await revealed(p); await sleep(300);
  return s;
}
// R6': casting tonight's net = minting its NFT through the (anvil) wallet, in one click; resolves once the net is recorded
async function castNft(p, s, day = '2026-11-05') {
  await p.click(`.spot[data-spot="${s}"]`); await sleep(120);
  assert.equal(await txt(p, '#act'), `Catch #${s} · free NFT`);
  await p.click('#act');
  await p.waitForFunction((day) => { try { const n = JSON.parse(localStorage.getItem('quantum-catch-v1')).nets[day]; return !!(n && n.nft); } catch (e) { return false; } }, { timeout: 30000 }, day);
  await sleep(200);
}
// watch mode (no wallet, or no contract in the build): one plain line and the faucet link instead of the cast button
const WATCH = 'To catch, open this page in a browser with a crypto wallet (e.g. MetaMask) on the free Sepolia test network. Get free test ETH';
const FAUCET = 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia';
async function watchMode(p) {
  assert.ok(await hidden(p, '#act'), 'no cast button without a wallet');
  assert.ok(!(await hidden(p, '#watch')), 'the watch line instead');
  assert.equal(await txt(p, '#watch'), WATCH);
  assert.equal(await p.$eval('#faucet', (e) => e.href), FAUCET);
}

// the free practice: under Past nights, on the newest night the chip has looked at (R3: no longer the first screen)
async function openPractice(p) {
  await p.click(`#nights button[data-day="${NEWEST}"]`); await sleep(250);
  assert.equal(await p.evaluate(() => QCP.stage), NEWEST, 'Past nights opens the practice night');
}
// a 4-step tour for the screenshots (no wallet: watch mode): first screen, practice result, tonight's net with the countdown,
// How it works open
async function tour(p, { shot, noHScroll }, checks) {
  await noHScroll('first screen');
  assert.equal(await p.evaluate(() => QCP.stage), 'tonight', "a first visit opens on tonight's pick screen (R3)");
  await watchMode(p);
  await shot('1-first-screen');
  await openPractice(p);
  const s = await practice(p);
  await p.evaluate(() => document.getElementById('play').scrollIntoView({ block: 'start' })); await sleep(250);
  await shot('2-practice-result');
  if (checks) await checks.afterPractice(s);
  assert.equal(await txt(p, '#act'), "See tonight's net", 'no wallet: nothing to cast, so the next step only shows tonight');
  await p.click('#act'); await sleep(300);
  assert.equal(await p.evaluate(() => QCP.stage), 'tonight');
  await p.click('.spot[data-spot="6"]'); await sleep(150);
  await watchMode(p);
  await p.evaluate(() => document.getElementById('play').scrollIntoView({ block: 'start' })); await sleep(250);
  await shot('3-tonight-watch');
  await p.click('#how > summary'); await sleep(200);
  await scrollTo(p, '#how'); await sleep(250);
  await shot('4-how-it-works');
  await noHScroll('how it works open');
  return s;
}

// a synthetic "next night" for the results.json tests: his 4 Nov rounds + the real v1.2 re-run of 4 Nov, relabelled 5 Nov.
// tamper: 'counts' (counts that do not match the shots), 'first' (first_shot claims the Epic spot, the shots say otherwise),
// 'legendary' (a valid night whose first shot IS on the Epic spot 7: the order of the shots changed, nothing else)
function nextNightResults(tamper) {
  const R = JSON.parse(fs.readFileSync(path.join(ROOT, 'quantum', 'wheel-2026-11-04-ibm_marrakesh-dbmbr0hkbkrc73cp7u8g.json'), 'utf8'));
  const n4 = DATA.nights['2026-11-04'];
  const night = { core: n4.core, genesis: n4.genesis, firstRound: n4.firstRound + 144, lastRound: n4.lastRound + 144, rounds: n4.rounds, recipe: 'v1.2', steps: R.steps };
  const chip = { night: '2026-11-05', core: n4.core, rounds: n4.rounds, steps: R.steps, backend: R.backend, job_id: R.job_id, wheel_shots: R.wheel_shots, wheel_2q_gates: R.wheel_2q_gates,
    counts: R.counts.slice(), shots_in_order: R.shots_in_order.slice(), twin: R.twin, quantum_seconds: null, dd_twirl: true, created: '2026-11-06T08:00:00Z', recipe: 'v1.2' };
  const T = QW.ringTurn(n4.rounds.map((r) => r[1]));                     // 9: the Epic spot 7 is position 14
  if (tamper === 'legendary') { const i = chip.shots_in_order.indexOf(14); [chip.shots_in_order[0], chip.shots_in_order[i]] = [chip.shots_in_order[i], chip.shots_in_order[0]]; }
  chip.first_shot = QW.spotOf(chip.shots_in_order[0], T);
  if (tamper === 'counts' || tamper === true) chip.counts[0] += 5;
  if (tamper === 'first') chip.first_shot = 7;
  const J = JSON.parse(RESULTS.toString());
  J.nights['2026-11-05'] = night; J.chips['2026-11-05'] = chip;
  const perSpot = QW.turned(chip.counts, T), turns = n4.rounds.reduce((a, r) => a + r[1], 0);
  return { body: JSON.stringify(J), night, chip, perSpot, turns, tiers: QW.tiers(perSpot, turns, chip.steps.length, chip.first_shot) };
}

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

// ---------- a local anvil chain with the real QuantumCatch, for the NFT scenarios ----------
const ACCOUNTS = { a: null, list: [] };
let anvilSkip = 'no anvil or contracts/out';
async function startAnvil() {
  const OUTJ = process.env.QC_ARTIFACT || path.join(ROOT, 'contracts/out/QuantumCatch.sol/QuantumCatch.json');
  try { execFileSync(ANVIL, ['--version'], { stdio: 'ignore' }); } catch (e) { return null; }
  if (!fs.existsSync(OUTJ)) return null;
  const port = 19000 + (process.pid % 1000), url = `http://127.0.0.1:${port}`;
  const proc = spawn(ANVIL, ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '11155111', '--timestamp', String(T0 / 1000), '--silent'], { stdio: 'ignore' });
  let id = 0;
  const rpc = async (method, params = []) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) }); const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result; };
  for (let i = 0; ; i++) { try { await rpc('eth_chainId'); break; } catch (e) { if (i > 100) { proc.kill(); return null; } await sleep(100); } }
  const acc = (await rpc('eth_accounts')).map((a) => a.toLowerCase());
  const bytecode = JSON.parse(fs.readFileSync(OUTJ, 'utf8')).bytecode.object;
  const h = await rpc('eth_sendTransaction', [{ from: acc[9], data: bytecode + pad(acc[0]) + pad(0), gas: '0x1c9c380' }]);   // (hatcher, no painted art)
  let rc = null; for (let i = 0; i < 100 && !rc; i++) { rc = await rpc('eth_getTransactionReceipt', [h]); if (!rc) await sleep(50); }
  if (!rc || rc.status !== '0x1' || (await rpc('eth_getCode', [rc.contractAddress, 'latest'])) === '0x') {    // e.g. a build over EIP-170
    const runtime = (JSON.parse(fs.readFileSync(OUTJ, 'utf8')).deployedBytecode.object.length - 2) / 2;
    anvilSkip = `the QuantumCatch deploy failed on anvil (runtime ${runtime} bytes; the EIP-170 limit is 24,576)`;
    proc.kill('SIGTERM'); return null;
  }
  const address = rc.contractAddress.toLowerCase(), page = path.join(tmp, 'nft.html');
  execFileSync('python3', [path.join(ROOT, 'wheel/build.py'), '--catch-address', address, '--out', page], { encoding: 'utf8' });
  return { proc, url, rpc, address, accounts: acc, html: fs.readFileSync(page) };
}

const ALLOWED_WALLET = ['eth_requestAccounts', 'eth_accounts', 'eth_chainId', 'eth_call', 'eth_getBalance', 'eth_getBlockByNumber', 'eth_sendTransaction', 'eth_getTransactionReceipt', 'wallet_switchEthereumChain'];
const PRESET = (nets = {}) => ({ practice: { day: NEWEST, spot: 15, at: 1, seen: true }, nets });
const asked = (p) => p.evaluate(() => window.__walletLog.filter((m) => m === 'eth_sendTransaction' || m === 'eth_requestAccounts'));

// R6': casting = minting the net's NFT, in ONE click (the main cast path): the R12 fit with a wallet (the cast button), one
// transaction, the net recorded under the chain's night, can't be moved, survives a reload, and comes back from the chain when
// this browser forgot it
async function nftCastScenario(chain, name, viewport, account) {
  await scenario(name, { ...viewport, page: chain.html, storage: PRESET(), wallet: { account, rpc: chain.url } }, async (p, { shot, noHScroll }) => {
    assert.equal(await p.evaluate(() => QCP.stage), 'tonight', 'a seen practice: the first screen is tonight');
    assert.ok(await hidden(p, '#watch'), 'a wallet and the contract: no watch line');
    assert.deepEqual(await p.$eval('#act', (e) => [e.hidden, e.disabled, e.textContent, e.dataset.sub]), [false, true, 'Pick a hamster first', 'Sepolia test network · worth nothing']);
    assert.equal(await txt(p, '#nfthint'), 'Free on the Sepolia test network · you only pay test gas, worth nothing. One net per wallet per night.');
    assert.equal(await p.$('#nftsw'), null, 'no NFT switch any more');
    await p.click('.spot[data-spot="6"]'); await sleep(150);
    assert.equal(await txt(p, '#act'), 'Catch #6 · free NFT');
    assert.equal(await p.$eval('.spot[data-spot="6"]', (e) => e.getAttribute('aria-pressed')), 'true', 'the pick is pressed (screen readers)');
    if (viewport.width <= 400) {       // R12 with a wallet: the computer, the picked hamster, all 16 hamsters and the cast button fit, no scrolling
      assert.equal(await p.evaluate(() => window.scrollY), 0, 'nothing scrolled');
      const fit = await p.evaluate(() => ['#core', '#ham', '#ring', '#act'].map((q) => { const r = document.querySelector(q).getBoundingClientRect(); return [q, Math.round(r.top), Math.round(r.bottom)]; }));
      for (const [q, t, b] of fit) assert.ok(t >= 0 && b <= viewport.height, `${q} on the first screen (${t}-${b})`);
      assert.ok(fit[2][2] <= fit[3][1], 'the roster above the action');
    }
    assert.deepEqual(await asked(p), [], 'choosing asks the wallet nothing');
    assert.equal((await stored(p)).nets['2026-11-05'], undefined, 'choosing saves nothing');
    await noHScroll('nft pick'); await shot('1-pick');
    await p.click('#act');
    await p.waitForFunction(() => !document.getElementById('nftbox').hidden, { timeout: 30000 });
    const want = QC.netId(QC.nightOfDay('2026-11-05'), account), st = await stored(p);
    assert.equal(st.nets['2026-11-05'].spot, 6);
    assert.equal(st.nets['2026-11-05'].nft.tokenId, want, 'token id = (night << 160) | wallet, from the NetCast log');
    assert.equal(st.nets['2026-11-05'].nft.day, '2026-11-05');
    assert.match(await p.$eval('#nftimg', (e) => e.src), /^data:image\/svg\+xml;base64,/);
    assert.match(await txt(p, '#nfttext'), /Your net is an NFT on Sepolia \(free test, no value\): night of Thu 5 Nov, spot 6/);
    assert.ok(await hidden(p, '#act') && await hidden(p, '#nfthint'), 'nothing more to press for this net');
    assert.ok(await p.$eval('#nftbox', (e) => !!e.closest('#actions')), 'the minted net sits where the button was');
    const log = await p.evaluate(() => window.__walletLog);
    for (const m of log) assert.ok(ALLOWED_WALLET.includes(m), `never asks for ${m}`);
    assert.ok(log.includes('eth_getBalance'), 'the public RPC is blocked here: the wallet\'s own read-only balance check');
    assert.equal(log.filter((m) => m === 'eth_sendTransaction').length, 1, 'one click, exactly one transaction');
    assert.match(await txt(p, '#prompt'), /^Your net is on spot 6\.Nets close at 22:00 your time .*He usually starts between 22:10 and 22:40\. His night ends Fri 13:00 your time, then IBM's chip looks: come back after that/);
    await p.click('.spot[data-spot="9"]'); await sleep(120);
    assert.match(await txt(p, '#caption'), /already on spot 6 for this night: nets can't be moved/);
    assert.equal((await stored(p)).nets['2026-11-05'].spot, 6);
    assert.match(await txt(p, '#tnstate'), /^Your net: spot 6 \(glasses \+ scarf, calm face\)\. A free test NFT on Sepolia\.$/);
    await p.waitForFunction(() => !document.getElementById('nftnets').hidden, { timeout: 15000 });
    assert.match(await txt(p, '#nftgrid'), /waiting for the chip/);
    await p.evaluate(() => document.getElementById('play').scrollIntoView({ block: 'start' })); await sleep(200);
    await noHScroll('nft minted'); await shot('2-minted');
    // remembered after a reload; and when this browser forgot it, the chain gives it back
    await p.reload({ waitUntil: 'load' }); await p.waitForFunction(() => window.QCP, { timeout: 15000 }); await sleep(400);
    assert.equal(await p.evaluate(() => QCP.stage), 'tonight');
    assert.match(await txt(p, '#prompt'), /^Your net is on spot 6\./);
    assert.equal(await p.$eval('#mycountn', (e) => e.textContent), '1');
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'load' }); await p.waitForFunction(() => window.QCP, { timeout: 15000 });
    await p.waitForFunction(() => /^Your net is on spot 6\./.test(document.getElementById('prompt').textContent), { timeout: 15000 });
    assert.equal((await stored(p)).nets['2026-11-05'].nft.tokenId, want, 'read back from the chain (QuantumCatch result + tokenURI)');
    assert.ok(!(await hidden(p, '#nftbox')), 'with its picture');
    assert.deepEqual(await asked(p), [], 'reading it back asks nothing');
  });
}

// R6' errors: the wallet says no (plain line, the button and the pick come back, nothing stored), then yes; while the wallet
// is asking, the pick is locked
async function nftErrorScenario(chain, name, viewport, account) {
  await scenario(name, { ...viewport, page: chain.html, storage: PRESET(), wallet: { account, rpc: chain.url, send: ['reject', 'hold'] } }, async (p, { shot }) => {
    await p.click('.spot[data-spot="5"]'); await sleep(120);
    await p.click('#act');
    await p.waitForFunction(() => document.getElementById('nftmsg').classList.contains('err'), { timeout: 30000 });
    assert.equal(await txt(p, '#nftmsg'), 'You said no in your wallet. Nothing was sent.');
    assert.deepEqual(await p.$eval('#act', (e) => [e.hidden, e.disabled, e.textContent]), [false, false, 'Catch #5 · free NFT'], 'the button is usable again');
    assert.equal(await p.evaluate(() => QCP.sel), 5, 'the pick is kept');
    assert.equal((await stored(p)).nets['2026-11-05'], undefined, 'no transaction, no net (no local-only nets)');
    assert.ok((await box(p, '#nftmsg')).top >= (await box(p, '#act')).bottom, 'the wallet line right under the button');
    await shot('1-said-no');
    await p.click('#act');
    await p.waitForFunction(() => typeof window.__releaseSend === 'function', { timeout: 30000 }); await sleep(100);
    assert.deepEqual(await p.$eval('#act', (e) => [e.disabled, e.textContent]), [true, 'Catching #5…'], 'busy');
    assert.equal(await txt(p, '#nftmsg'), 'Confirm the one transaction in your wallet: a free net, only the Sepolia test fee.');
    await p.click('.spot[data-spot="9"]'); await sleep(150);
    assert.equal(await p.evaluate(() => QCP.sel), 5, 'a tap cannot change the pick while the wallet is asking');
    assert.equal(await txt(p, '#lcdn'), '#05');
    await shot('2-wallet-asking');
    await p.evaluate(() => window.__releaseSend());
    await p.waitForFunction(() => !document.getElementById('nftbox').hidden, { timeout: 30000 });
    const st = await stored(p);
    assert.equal(st.nets['2026-11-05'].spot, 5);
    assert.equal(st.nets['2026-11-05'].nft.tokenId, QC.netId(QC.nightOfDay('2026-11-05'), account));
    assert.ok(await hidden(p, '#nftmsg'), 'the error is gone');
    assert.equal(await p.evaluate(() => window.__walletLog.filter((m) => m === 'eth_sendTransaction').length), 2, 'the refused prompt and the real one');
  });
}

(async () => {
  // 1. phone, light, no wallet (watch mode, R6'): the first screen, the practice catch at REAL speed, tonight's net with the
  //    countdown, How it works
  await scenario('phone-light', { width: 360, height: 740, scheme: 'light', fast: false }, async (p, { shot, noHScroll }) => {
    await noHScroll('start');
    await p.waitForFunction(() => !document.getElementById('live').hidden, { timeout: 10000 });
    assert.match(await txt(p, '#live'), /LIVE · RUNNING/);
    assert.equal(await p.title(), 'Quantum Catch');
    assert.equal(await txt(p, '.hero h1'), 'Quantum Catch');
    assert.equal(await txt(p, '.lede'), "Squeektoshi's run programs a real quantum computer. Catch the hamster it lands on.");
    const pw = await p.evaluate(() => { const b = document.getElementById('powered'), r = b.getBoundingClientRect(); return { t: b.textContent.trim(), href: b.getAttribute('href'), top: r.top, shown: r.height > 0 }; });
    assert.equal(pw.t, "Powered by Squeektoshi's real wheel on Squeekchain"); assert.equal(pw.href, 'https://squeekchain.com'); assert.ok(pw.shown && pw.top < 60, 'near the top');
    // first screen (R3): tonight's pick screen: the quantum computer over the stage, the 16 hamsters, the deck; no math
    const dl = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    assert.equal(await p.evaluate(() => QCP.stage), 'tonight', "a first visit opens on tonight's net");
    assert.equal(await txt(p, '#stageh'), "Tonight's net · Thu 5 Nov");
    assert.equal(await txt(p, '#srcbadge'), 'not run yet');
    assert.match(await txt(p, '#prompt'), /^Nets close 22:00 tonight · result tomorrow after 13:00He usually starts 22:10–22:40 · closes in 3 h (29|30) min$/, 'R9: the clock line');
    assert.ok(!BANNED_FIRST.test(await firstScreenText(p)), 'no math words on the first screen');
    assert.equal(await txt(p, '.headline'), 'A real quantum computer decides who gets caught.Pick your hamster.');
    await watchMode(p);                                        // the real build has the contract; this browser has no wallet
    assert.ok(await hidden(p, '#reveal'));
    assert.equal(await p.$$eval('.spot.out', (e) => e.length), 0, "nobody knows tonight's out-of-reach half yet");
    // R7: the strips show last night's landings (4 Nov, the official v1.1 run), 'out' where he could not land that night
    const ref4 = refOf(DATA.chips[NEWEST].job_id);
    assert.equal(await txt(p, '#legend'), `Landings last night (${dl(NEWEST).replace(/^\w+ /, '')}), of 4,000`);
    assert.deepEqual(await p.$$eval('.spot .lnd b', (e) => e.map((b) => b.textContent)), ref4.counts.map((c, i) => (ref4.reach[i] ? c.toLocaleString('en-US') : 'out')));
    assert.equal(await txt(p, '#chipline'), `Last night's chip: ${DATA.chips[NEWEST].backend}`);
    assert.equal(await p.$eval('#mycountn', (e) => e.textContent), '0');
    await shot('1-first-screen');
    // R12 without a wallet: tap a hamster: the computer, the picked hamster, all 16 hamsters and the watch line fit 360x740,
    // no scrolling (the cast-button branch is in nft-phone-light)
    await p.click('.spot[data-spot="7"]'); await sleep(150);
    await watchMode(p);
    assert.equal(await p.$eval('.spot[data-spot="7"]', (e) => e.getAttribute('aria-pressed')), 'true');
    assert.equal(await p.evaluate(() => window.scrollY), 0, 'nothing scrolled');
    const fit = await p.evaluate(() => ['#core', '#ham', '#ring', '#watch'].map((q) => { const r = document.querySelector(q).getBoundingClientRect(); return [q, Math.round(r.top), Math.round(r.bottom)]; }));
    for (const [q, t, b] of fit) assert.ok(t >= 0 && b <= 740, `${q} on the first screen (${t}-${b})`);
    assert.ok(fit[2][2] <= fit[3][1], 'the roster above the watch line');
    assert.deepEqual([await txt(p, '#platek'), await txt(p, '#platen'), await txt(p, '#lcdn')], ['Your pick', '7', '#07'], 'the name plate and the LCD show the pick');
    const r7 = await p.evaluate((d) => QCP.spotResult(d, 7), NEWEST);
    assert.equal(await txt(p, '#plateb'), `Last night, ${dl(NEWEST).replace(/^\w+ /, '')}${r7.tier >= 0 ? `${r7.name} · ${r7.hits.toLocaleString('en-US')} landings` : r7.reach ? `got away · ${r7.hits.toLocaleString('en-US')} landings` : 'out of reach'}`);
    assert.equal((await stored(p)), null, 'choosing saves nothing');
    await shot('1b-chosen');
    await p.click('.spot[data-spot="7"]'); await sleep(120);
    assert.equal(await p.evaluate(() => QCP.sel), null, 'a second tap takes the pick back');
    // the free practice, under Past nights: the newest chip night, its out-of-reach half greyed
    await openPractice(p);
    assert.equal(await txt(p, '#stageh'), `Practice catch · night of ${dl(NEWEST)}`);
    assert.equal(await txt(p, '#srcbadge'), 'practice');
    assert.match(await txt(p, '#prompt'), /^Put your net on a hamster\./);
    assert.equal(await p.$$eval('.spot.out', (e) => e.length), 8, 'the out-of-reach half is greyed (a past night is known)');
    // an out-of-reach spot cannot take the practice net
    const o = await outSpot(p);
    await p.click(`.spot[data-spot="${o}"]`); await sleep(120);
    assert.match(await txt(p, '#caption'), new RegExp(`Spot ${o} was out of reach that night: he could not land there`));
    assert.equal(await p.evaluate(() => QCP.sel), null); assert.ok(await p.$eval('#act', (e) => e.disabled));
    const s = await best(p);
    await p.click(`.spot[data-spot="${s}"]`); await sleep(150);
    assert.equal(await txt(p, '#act'), `Cast practice net on #${s}`);
    assert.ok(await visible(p, '#act', 740), `the one action is on screen (${Math.round((await box(p, '#act')).bottom)})`);
    assert.equal((await stored(p)), null, 'choosing saves nothing');
    await shot('1c-practice-chosen');
    await p.click('#act'); await sleep(2600);
    assert.ok(await p.evaluate(() => QCP.playing), 'his night is playing');
    assert.ok(!(await hidden(p, '#skip')), 'Skip shown while playing');
    assert.match(await txt(p, '#caption'), /\d\d:\d\d · [\d,]+ turns: a (sprint|steady run|lazy round)/);
    await shot('2a-replay');
    await p.click('#skip'); await revealed(p);
    const night = DATA.chips[NEWEST], counts = QW.turned(night.counts, QW.ringTurn(DATA.nights[NEWEST].rounds.map((r) => r[1]))), ref = refOf(night.job_id);
    assert.deepEqual(ref.counts, counts);
    const tier = QW.TIER_NAMES[ref.tiers[s] - 1];
    assert.equal(tier, 'Common', 'the brightest reachable spot is the top of the ranking: Common');
    assert.match(await txt(p, '#revt'), new RegExp(`^An? ${tier} (Honey|Tiger|Circuit|Crystal|Gold) hamster!$`));
    assert.match(await txt(p, '#prompt'), new RegExp(`^You caught an? ${tier} hamster!`));
    assert.match(await txt(p, '#revs'), new RegExp(`^practice ?Spot ${s} .*found him there in ${QW.pctText(counts[s] / night.wheel_shots).replace('.', '\\.')} of its 4,000 looks\\.`));
    assert.equal(await txt(p, '#revq'), 'That night the chip kept the quantum pattern.');
    assert.ok(!BANNED_REVEAL.test(await txt(p, '#reveal')), `no math or jargon on the result card: ${await txt(p, '#reveal')}`);
    assert.equal(await p.$eval('#mycountn', (e) => e.textContent), '1');
    // the ring after the reveal: every spot's tier (Python), the tier colour, and a narrow ring keeps only the number on 'out'
    const tags = await p.$$eval('.spot', (e) => e.map((b) => [b.dataset.spot, b.dataset.tier, b.querySelector('.tag').textContent.trim(), b.querySelector('.tag').innerText.trim()]));
    tags.forEach(([sp, t, tag, shown], i) => {
      assert.equal(+sp, i); assert.equal(+t, ref.tiers[i] - 1, `spot ${i}: data-tier`); assert.equal(tag, tagOf(ref, i), `spot ${i}: tag`);
      assert.equal(shown, ref.reach[i] ? tagOf(ref, i) : String(i), `spot ${i}: shown on a 360 px ring`);
    });
    assert.deepEqual(tags.filter((r) => r[1] === '3').map((r) => r[0]), ['11'], '4 Nov: spot 11 (the fewest of the 8 catches) is Epic; the first shot was on 15: no Legendary');
    const tagBox = await p.$$eval('.spot .tag', (e) => e.map((t) => { const r = t.getBoundingClientRect(); return [r.left, r.right]; }));
    const [cl, cr] = await p.evaluate(() => { const r = document.getElementById('play').getBoundingClientRect(); return [r.left, r.right]; });
    tagBox.forEach(([l, r], i) => assert.ok(l >= cl && r <= cr, `tag ${i} inside the card (${l}-${r} in ${cl}-${cr})`));
    await p.click('.spot[data-spot="11"]'); await sleep(100);
    assert.match(await txt(p, '#caption'), /^Spot 11: Epic, the chip found him here in 7\.2% of its looks\. The rarest catch of the night\./);
    await p.click('.spot[data-spot="15"]'); await sleep(100);
    assert.match(await txt(p, '#caption'), /^Spot 15: Common, .* The chip's very first look landed here\./);
    const st = await stored(p); assert.deepEqual([st.practice.day, st.practice.spot, st.practice.seen], [NEWEST, s, true]);
    assert.equal(await txt(p, '#act'), "See tonight's net", 'no wallet: the next step only shows tonight (casting needs a wallet)');
    await noHScroll('practice result'); await shot('2-practice-result');
    // tonight's net: closes 21:00 UTC = 22:00 in Ljubljana, 3 h 30 min from 17:30 UTC; without a wallet nothing can be cast
    await p.click('#act'); await sleep(300);
    assert.equal(await p.evaluate(() => QCP.stage), 'tonight');
    assert.equal(await txt(p, '#stageh'), "Tonight's net · Thu 5 Nov");
    assert.match(await txt(p, '#prompt'), /^Nets close 22:00 tonight · result tomorrow after 13:00He usually starts 22:10–22:40 · closes in 3 h (29|30) min$/);
    assert.equal(await p.$$eval('.spot.out', (e) => e.length), 0, 'nobody knows tonight\'s out-of-reach half yet');
    await p.click('.spot[data-spot="6"]'); await sleep(150);
    await watchMode(p);
    assert.equal((await stored(p)).nets['2026-11-05'], undefined, 'no local-only nets any more (R6\')');
    assert.match(await txt(p, '#tnclose'), /^Nets close at 22:00 your time · in 3 h (29|30) min\. He usually starts between 22:10 and 22:40\.$/);
    assert.equal(await txt(p, '#tnstate'), 'No net yet for this night.');
    await p.evaluate(() => document.getElementById('play').scrollIntoView({ block: 'start' })); await sleep(200);
    await shot('3-tonight-watch');
    // How it works: one disclosure; the per-night quantumness, honestly
    await p.click('#how > summary'); await sleep(200);
    assert.equal(await txt(p, '#rarityline'), "The least-visited spot he could reach is Epic; if the chip's very first look landed there, it is Legendary.");
    assert.equal(await p.$$eval('#cmp rect', (e) => e.length), 48, 'chip / ghost / normal bars for 16 spots');
    const rows = await p.$$eval('#qrows tr', (e) => e.map((r) => r.lastElementChild.textContent));
    assert.deepEqual(rows.slice(0, 7), ['quantum', 'noise', 'noise', 'noise', 'noise', 'quantum', 'quantum']);
    assert.deepEqual(rows.slice(7), ['quantum', 'quantum'], 'the two v1.2 re-runs');
    assert.match(await txt(p, '#qnote'), /^The chip does not beat noise every night\. On 4 of the 7 first nights \(recipe v1\.1, up to 16 steps\) noise won.*Newer nights use a shorter program \(recipe v1\.2: at most 10 steps, plus noise protection\) to keep the quantum pattern\./);
    assert.match(await txt(p, '#cmptext'), /^The chip kept the quantum pattern that night: its landings were 2\.7× closer to the perfect quantum ghost than to a normal hamster\./, 'how much closer: in How it works');
    assert.match(await txt(p, '#checkkv'), /ran on IBM on 5 Nov 2026/, 'the run date of the chip job');
    assert.match(await txt(p, '#howrules'), /^One net per wallet per night, cast before he runs: nets close at 21:00 UTC \(22:00 your time\).*Each net is a free NFT on the Sepolia test network/);
    assert.match(await txt(p, '#contract'), /^Each net is a free test NFT: QuantumCatch contract 0x[0-9a-f]{40} on Sepolia \(no money value; one net per wallet per night\)\.$/);
    await scrollTo(p, '#how'); await sleep(200); await shot('4-how-it-works');
    // Check it yourself: the GitHub link (also in the footer)
    assert.equal(await p.$eval('#ghlink', (e) => e.href), DATA.config.repoUrl);
    assert.equal(await p.$eval('#ghfoot', (e) => e.href), DATA.config.repoUrl);
    // remembered after a reload: practice used: the wheel opens on tonight's net (a cast net's reload: nft-phone-light)
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
    await p.setViewport({ width: 400, height: 800, deviceScaleFactor: 1 }); await sleep(300); await ctx.noHScroll('400 px');
    await p.setViewport({ width: 375, height: 667, deviceScaleFactor: 1 }); await sleep(300); await ctx.noHScroll('375 px');
  });

  // 3. desktop, light: the four screens; the Twin Lab inside Check it yourself
  await scenario('desktop-light', { width: 1280, height: 800, scheme: 'light' }, async (p, ctx) => {
    await tour(p, ctx);
    await p.click('#nights button[data-day="' + NEWEST + '"]'); await sleep(200);
    const shown = await p.$$eval('.spot .tag', (e) => e.map((t) => t.innerText.trim())), ref = refOf(DATA.chips[NEWEST].job_id);
    assert.deepEqual(shown, [...Array(16).keys()].map((s) => tagOf(ref, s)), 'a wide ring shows every tag in full, "out" too');
    await p.evaluate(() => window.scrollTo(0, 0)); await sleep(150);
    const [stageR, ringL, pwL, stageT] = await p.evaluate(() => [document.getElementById('stage').getBoundingClientRect().right, document.getElementById('ring').getBoundingClientRect().left,
      document.getElementById('powered').getBoundingClientRect().left, document.getElementById('stage').getBoundingClientRect().top]);
    assert.ok(stageR <= ringL && stageR <= pwL, `the machine on the left, the header and the roster on the right (${stageR} | ${ringL}, ${pwL})`);
    assert.ok(stageT <= 0.5, 'the computer hangs from the top edge');
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
      await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 }); await p.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
      await ctx.noHScroll(`${w} px`);
      const r = await p.evaluate(() => { const b = document.getElementById('sound').getBoundingClientRect(); return [b.left, b.right, document.documentElement.clientWidth]; });
      assert.ok(r[0] >= 0 && r[1] <= r[2], `${w} px: the sound switch inside the window (${r})`);
      await ctx.shot(`7-${w}`);
    }
  });

  // 4. desktop, dark: the first screen
  await scenario('desktop-dark', { width: 1280, height: 800, scheme: 'dark' }, async (p, { shot, noHScroll }) => { await noHScroll('desktop dark'); await shot('1-first-screen'); });

  // the local anvil chain with the real QuantumCatch: every cast goes through it (R6'). Missing = a failed run, unless opted out
  const chain = await startAnvil();
  const NO_CHAIN = !chain && process.env.QW_NO_CHAIN === '1';
  if (!chain) results.push([NO_CHAIN ? 'skip' : 'FAIL', 'chain', `${anvilSkip}: the cast scenarios cannot run${NO_CHAIN ? ' (QW_NO_CHAIN=1)' : ' (set QC_ARTIFACT, or QW_NO_CHAIN=1 to skip them on purpose)'}`]);

  // 6. a net resolves when its night's chip result arrives in results.json next to the page (no rebuild); a tampered file is refused
  const NX = nextNightResults(false);
  const S5 = NX.perSpot.indexOf(Math.max(...NX.perSpot));
  await scenario('resolve', { width: 375, height: 667, at: Date.parse('2026-11-06T13:00:00Z'), results: NX.body, storage: { practice: { day: NEWEST, spot: 15, at: 1, seen: true }, nets: { '2026-11-05': { spot: S5, at: 1 } } } }, async (p, { shot }) => {
    await p.waitForFunction(() => QCP.stage === '2026-11-05' && !!QCP.data.chips['2026-11-05'], { timeout: 10000 }); await sleep(300);
    assert.equal(await txt(p, '#stageh'), 'Your net · night of Thu 5 Nov');
    assert.match(await txt(p, '#prompt'), new RegExp(`^Your net is on spot ${S5}\\. Did the chip find him there\\?`));
    assert.equal(await txt(p, '#act'), 'See if you caught him');
    assert.equal(await p.$$eval('.spot.out', (e) => e.length), 0, 'no out-of-reach marks before the replay: the result is not spoiled');
    assert.ok(!/out/.test(await p.$eval(`.spot[data-spot="${S5}"] .tag`, (e) => e.textContent)));
    assert.ok(await visible(p, '#act', 667), 'See if you caught him: on screen at 375x667');
    assert.equal(await p.$$eval('#nights button', (e) => e.length), 8, '7 nights shown + tomorrow (the strip keeps the last 7)');
    await p.click('#act'); await revealed(p);
    const ref = refOf(NX.chip.job_id), tier = QW.TIER_NAMES[ref.tiers[S5] - 1];
    assert.deepEqual(NX.tiers, ref.tiers.map((c) => c - 1), 'the relabelled night ranks as its run');
    assert.equal(tier, 'Common');
    assert.match(await txt(p, '#prompt'), new RegExp(`^You caught an? ${tier} hamster!`));
    assert.equal(await p.$eval('.spot[data-spot="7"] .tag', (e) => e.textContent.trim()), '7 Epic', 'its first shot landed on spot 3: the Epic spot 7 stays Epic');
    assert.equal(await p.$eval('.spot[data-spot="7"]', (e) => e.dataset.tier), '3');
    assert.equal(await txt(p, '#revq'), 'That night the chip kept the quantum pattern.', 'the v1.2 night kept the pattern');
    assert.equal(await p.$$eval('.spot.out', (e) => e.length), 8, 'after the replay the out-of-reach half is shown');
    assert.equal((await stored(p)).nets['2026-11-05'].seen, true);
    assert.equal(await p.$eval('#mycountn', (e) => e.textContent), '2', 'practice + the real catch');
    await shot('1-resolved');
  });
  await scenario('resolve-tampered', { width: 360, height: 740, at: Date.parse('2026-11-06T13:00:00Z'), results: nextNightResults(true).body, storage: { practice: { day: NEWEST, spot: 15, at: 1, seen: true }, nets: { '2026-11-05': { spot: S5, at: 1 } } } }, async (p) => {
    await sleep(800);
    assert.equal(await p.evaluate(() => Object.keys(QCP.data.chips).length), 7, 'a chip result whose counts do not match its shots is refused');
    assert.equal(await p.evaluate(() => QCP.stage), '2026-11-05', 'the net\'s night (his run is in) stays on the first screen');
    assert.match(await txt(p, '#prompt'), new RegExp(`^Your net is on spot ${S5}\\.His run is in\\. IBM's chip has not looked yet: come back later`));
    assert.match(await txt(p, '#waiting'), new RegExp(`Thu 5 Nov: your net on spot ${S5}, waiting for the chip\\.`));
  });

  await scenario('resolve-tampered-first', { width: 360, height: 740, at: Date.parse('2026-11-06T13:00:00Z'), results: nextNightResults('first').body, storage: { practice: { day: NEWEST, spot: 15, at: 1, seen: true }, nets: { '2026-11-05': { spot: 7, at: 1 } } } }, async (p) => {
    await sleep(800);
    assert.equal(await p.evaluate(() => Object.keys(QCP.data.chips).length), 7, 'a first_shot that is not the file\'s own first shot (a faked Legendary) is refused');
    assert.match(await txt(p, '#prompt'), /^Your net is on spot 7\.His run is in\./);
  });

  // 6b. Legendary: the same night, but the chip's very first shot landed on the Epic spot 7; a net there is Legendary (gold)
  const LG = nextNightResults('legendary');
  await scenario('legendary', { width: 360, height: 740, at: Date.parse('2026-11-06T13:00:00Z'), results: LG.body, storage: { practice: { day: NEWEST, spot: 15, at: 1, seen: true }, nets: { '2026-11-05': { spot: 7, at: 1 } } } }, async (p, { shot, noHScroll }) => {
    await p.waitForFunction(() => QCP.stage === '2026-11-05' && !!QCP.data.chips['2026-11-05'], { timeout: 10000 }); await sleep(300);
    assert.equal(LG.chip.first_shot, 7);
    assert.deepEqual(LG.tiers, refOf(LG.chip.job_id).tiers.map((c, s) => (s === 7 ? 4 : c - 1)), 'only the Epic spot changes: Legendary');
    await p.click('#act'); await revealed(p);
    assert.equal(await txt(p, '#revt'), 'A Legendary Gold hamster!');
    assert.match(await txt(p, '#prompt'), /^You caught a Legendary hamster!/);
    assert.match(await txt(p, '#revs'), /^Spot 7 \(.*\): the chip found him there in 6\.3% of its 4,000 looks\. The rarest catch of the night, and the chip's very first look landed there\.$/);
    assert.deepEqual(await p.$eval('.spot[data-spot="7"]', (e) => [e.dataset.tier, e.querySelector('.tag').innerText.trim(), getComputedStyle(e.querySelector('.tag')).backgroundColor]), ['4', '7 Legendary', 'rgb(255, 214, 107)'], 'a gold Legendary tag on the ring');
    assert.equal(await p.$$eval('.spot[data-tier="4"]', (e) => e.length), 1, 'one Legendary');
    assert.equal(await p.$$eval('.spot[data-tier="3"]', (e) => e.length), 0, 'and so no Epic that night');
    assert.deepEqual(await p.evaluate(() => { const r = QCP.netResult('2026-11-05', 7); return [r.status, r.h.tier, r.o.tier, r.o.status]; }), ['caught', 4, 5, 1], 'page = contract rule (tier 5)');
    assert.match(await txt(p, '#mygrid'), /Legendary/);
    assert.match(await txt(p, '#mystats'), /rarest: Legendary/);
    await noHScroll('legendary'); await shot('1-legendary');
  });

  // 7. SqueekCore live: "Tonight so far" from settled rounds only (state() then roundPage up to the settled round)
  await scenario('sofar', { width: 360, height: 740, at: Date.parse('2026-11-05T22:30:00Z'), rpc: fakeCore, storage: { practice: { day: NEWEST, spot: 15, at: 1, seen: true }, nets: {} } }, async (p, { shot, rpcLog }) => {
    await p.waitForFunction(() => !document.getElementById('sofar').hidden, { timeout: 10000 });
    assert.match(await txt(p, '#sofar'), /^Tonight so far: 3 rounds, 870 turns \(his night of Thu 5 Nov, settled on-chain up to 23:20 your time\)$/);
    assert.deepEqual(rpcLog, [QC.enc.state(), QC.enc.roundPage(241, 303, 16)], 'only settled rounds are asked for');
    assert.equal(await txt(p, '#stageh'), "Tomorrow's net · Fri 6 Nov");
    await scrollTo(p, '#tonight'); await sleep(150); await shot('1-tonight-so-far');
  });

  // 7b. the viewer's net between the 21:00 UTC lock and the chip: his run so far next to the net, tomorrow's net one tap away
  await scenario('running', { width: 360, height: 740, at: Date.parse('2026-11-05T22:30:00Z'), rpc: fakeCore, storage: { practice: { day: NEWEST, spot: 15, at: 1, seen: true }, nets: { '2026-11-05': { spot: 6, at: 1 } } } }, async (p, { shot }) => {
    assert.equal(await p.evaluate(() => QCP.stage), '2026-11-05', 'the running night with the viewer\'s net is the first screen');
    await p.waitForFunction(() => /Tonight so far/.test(document.getElementById('prompt').textContent), { timeout: 10000 });
    assert.equal(await txt(p, '#stageh'), 'Your net · night of Thu 5 Nov');
    assert.equal(await txt(p, '#srcbadge'), 'his night is on');
    assert.match(await txt(p, '#prompt'), /^Your net is on spot 6\.Tonight so far: 3 rounds, 870 turns \(settled on-chain up to 23:20 your time\)\. It ends Fri 13:00 your time, then IBM's chip looks\.$/);
    assert.equal(await txt(p, '#alt'), "See tomorrow's net", 'an old local net, no wallet: tomorrow\'s net can be seen, not cast'); assert.ok(await hidden(p, '#act'));
    assert.deepEqual(await p.$$eval('#nights button', (e) => e.map((b) => b.dataset.day)).then((x) => x.slice(-2)), ['2026-11-05', 'tonight'], 'a strip button for the running night');
    assert.match(await txt(p, '#sofar'), /^Tonight so far: 3 rounds, 870 turns \(his night of Thu 5 Nov, settled on-chain up to 23:20 your time\) · your net there: spot 6$/);
    assert.ok((await box(p, '#sofar')).top < (await box(p, '#tnh')).top, 'his run so far sits above the next night\'s heading');
    assert.equal(await p.$$eval('.spot.out', (e) => e.length), 0);
    await shot('1-running');
  });
  await scenario('morning', { width: 360, height: 740, at: Date.parse('2026-11-06T07:30:00Z'), storage: { practice: { day: NEWEST, spot: 15, at: 1, seen: true }, nets: { '2026-11-05': { spot: 6, at: 1 } } } }, async (p) => {
    assert.equal(await p.evaluate(() => QCP.stage), '2026-11-05');
    assert.match(await txt(p, '#prompt'), /^Your net is on spot 6\.His night is on\. It ends Fri 13:00 your time, then IBM's chip looks\.$/);
    assert.equal(await txt(p, '#alt'), "See tonight's net");
  });
  await scenario('over-stale', { width: 360, height: 740, at: Date.parse('2026-11-07T19:00:00Z'), storage: { practice: { day: NEWEST, spot: 15, at: 1, seen: true }, nets: { '2026-11-05': { spot: 6, at: 1 } } } }, async (p, { shot }) => {
    assert.equal(await p.evaluate(() => QCP.stage), '2026-11-05');
    assert.equal(await txt(p, '#srcbadge'), 'waiting for the chip');
    assert.match(await txt(p, '#prompt'), /^Your net is on spot 6\.His night is over\. IBM's chip has not looked at a night since Wed 4 Nov: nets wait until it does\.$/, 'stale: no "come back later" promise');
    assert.match(await txt(p, '#waiting'), /IBM's chip has not looked at a night since Wed 4 Nov/);
    await shot('1-over-stale');
  });
  await scenario('over-fresh', { width: 360, height: 740, at: Date.parse('2026-11-06T13:00:00Z'), results: null, storage: { practice: { day: NEWEST, spot: 15, at: 1, seen: true }, nets: { '2026-11-05': { spot: 6, at: 1 } } } }, async (p) => {
    assert.match(await txt(p, '#prompt'), /^Your net is on spot 6\.His night is over\. IBM's chip has not looked yet: come back later to see if you caught him\.$/, 'no stale note 25 h after the newest chip night');
  });

  // 7c. a real net on a spot OUT OF REACH that night with 1.4 % of the landings (Legendary by share): he got away, as the
  //     contract's result() says (the owner's reach rule); My catches does not count it
  const OUT5 = 2;
  await scenario('resolve-out', { width: 360, height: 740, at: Date.parse('2026-11-06T13:00:00Z'), results: NX.body, storage: { practice: { day: NEWEST, spot: 15, at: 1, seen: true }, nets: { '2026-11-05': { spot: OUT5, at: 1 } } } }, async (p, { shot }) => {
    await p.waitForFunction(() => QCP.stage === '2026-11-05' && !!QCP.data.chips['2026-11-05'], { timeout: 10000 }); await sleep(300);
    assert.equal(NX.perSpot[OUT5], 55); assert.ok(55 * 100 >= 4000, 'by share alone (1.4 %): catchable');
    const rec = { counts: NX.perSpot, shots: 4000, turns: NX.turns, steps: NX.night.steps.length, firstShot: NX.chip.first_shot };
    assert.deepEqual(QC.outcome(rec, OUT5), { status: 2, hits: 55, shots: 4000, tier: 0, reach: 2 }, 'the contract rule: got away');
    assert.equal(await p.$$eval('.spot.out', (e) => e.length), 0, 'no spoiler before the replay');
    await p.click('#act'); await revealed(p);
    assert.match(await txt(p, '#prompt'), /^He got away\./);
    assert.equal(await txt(p, '#revt'), 'He got away.');
    assert.match(await txt(p, '#revs'), new RegExp(`^Spot ${OUT5} was out of reach that night: he could not land there\\. The chip's 55 landings there are its noise\\.$`));
    assert.deepEqual(await p.evaluate((s) => { const r = QCP.netResult('2026-11-05', s); return [r.status, r.o.status, r.o.tier, r.o.reach, r.h.tier]; }, OUT5), ['away', 2, 0, 2, -1]);
    assert.equal(await p.$eval('#mycountn', (e) => e.textContent), '1', 'only the practice catch counts');
    assert.match(await txt(p, '#mygrid'), /Got away.*out of reach/);
    assert.ok(!/Legendary/.test(await txt(p, '#mygrid')));
    await shot('1-got-away-out-of-reach');
  });

  // 7d. short phones with a wallet: after a tap the ONE action is fully on screen (practice and tonight's net)
  const SHORT = [[375, 667, 6], [390, 664, 7], [360, 640, 8]];
  for (const [w, h, acc] of chain ? SHORT : []) {
    await scenario(`short-${w}x${h}`, { width: w, height: h, page: chain.html, wallet: { account: chain.accounts[acc], rpc: chain.url } }, async (p, { shot, noHScroll }) => {
      assert.equal(await p.evaluate(() => QCP.stage), 'tonight');
      for (const t of [1, 14]) {                       // a top-row and a bottom-row hamster: the action and the tapped one on screen
        await p.evaluate(() => window.scrollTo(0, 0)); await sleep(100);
        await p.click(`.spot[data-spot="${t}"]`); await sleep(200);
        assert.equal(await txt(p, '#act'), `Catch #${t} · free NFT`);
        assert.ok(await visible(p, '#act', h), `tonight: Cast button on screen after the tap (${JSON.stringify(await box(p, '#act'))})`);
        assert.ok(await visible(p, `.spot[data-spot="${t}"]`, h), `the tapped hamster ${t} has not scrolled away`);
        await p.click(`.spot[data-spot="${t}"]`); await sleep(120);
      }
      await openPractice(p);
      const s = await best(p);
      await p.click(`.spot[data-spot="${s}"]`); await sleep(200);
      assert.equal(await txt(p, '#act'), `Cast practice net on #${s}`);
      assert.ok(await visible(p, '#act', h), `practice: Cast button on screen after the tap (${JSON.stringify(await box(p, '#act'))})`);
      assert.ok(await visible(p, `.spot[data-spot="${s}"]`, h), 'the tapped hamster has not scrolled away');
      await shot('1-chosen');
      await p.click('#act'); await revealed(p); await sleep(200);
      assert.ok(await visible(p, '#act', h), 'after the result: Now cast tonight\'s net on screen');
      await p.click('#act'); await sleep(300);
      await p.evaluate(() => window.scrollTo(0, 0)); await sleep(100);
      await p.click('.spot[data-spot="6"]'); await sleep(200);
      assert.equal(await txt(p, '#act'), 'Catch #6 · free NFT');
      assert.ok(await visible(p, '#act', h), 'tonight: Cast button on screen after the tap');
      assert.deepEqual(await asked(p), [], 'choosing asks the wallet nothing');
      await noHScroll('short'); await shot('2-tonight-chosen');
    });
  }

  // 8. casting = minting with a wallet (local anvil, the real contract): phone, the wallet's errors, an old local net, desktop,
  //    no contract in the build; then the 21:00 UTC lock (it moves the chain's clock, so it runs last)
  if (chain) {
    try {
      await nftCastScenario(chain, 'nft-phone-light', { width: 360, height: 740, scheme: 'light' }, chain.accounts[1]);
      await nftErrorScenario(chain, 'nft-errors', { width: 360, height: 740, scheme: 'light' }, chain.accounts[4]);
      // an old visitor's net, cast locally before R6': still shown (and resolved, see resolve*), no second step, nothing sent
      await scenario('nft-phone-dark', { width: 360, height: 740, scheme: 'dark', page: chain.html, storage: PRESET({ '2026-11-05': { spot: 6, at: T0 - 60e3 } }), wallet: { account: chain.accounts[2], rpc: chain.url } }, async (p, { shot, noHScroll }) => {
        assert.equal(await p.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(7, 11, 26)');
        assert.equal(await p.evaluate(() => QCP.stage), 'tonight');
        assert.match(await txt(p, '#prompt'), /^Your net is on spot 6\./, 'the old local net still shows');
        assert.equal(await p.$eval('.spot.net', (e) => e.dataset.spot), '6');
        for (const q of ['#act', '#watch', '#nftbox', '#nfthint']) assert.ok(await hidden(p, q), `${q}: no "make it an NFT" step any more, no second net`);
        assert.ok(await p.$eval('#deckrow', (e) => e.classList.contains('solo')), 'the LCD takes the whole row');
        assert.equal(await txt(p, '#tnstate'), 'Your net: spot 6 (glasses + scarf, calm face).');
        assert.deepEqual(await asked(p), [], 'nothing asked');
        await noHScroll('old net'); await shot('1-old-local-net');
      });
      await nftCastScenario(chain, 'nft-desktop', { width: 1280, height: 800, scheme: 'light' }, chain.accounts[3]);
      // a build without the contract address: watch mode even with a wallet, and the wallet is never asked anything
      const noAddr = Buffer.from(chain.html.toString().replace(/"catchAddress":"0x[0-9a-f]{40}"/, '"catchAddress":null'));
      assert.ok(!noAddr.equals(chain.html), 'the address was in the config');
      await scenario('no-address', { width: 360, height: 740, page: noAddr, storage: PRESET(), wallet: { account: chain.accounts[8], rpc: chain.url } }, async (p) => {
        await watchMode(p);
        await p.click('.spot[data-spot="7"]'); await sleep(150);
        await watchMode(p);
        assert.ok(await hidden(p, '#contract'), 'no contract line in Check it yourself');
        assert.deepEqual(await p.evaluate(() => window.__walletLog), [], 'the wallet is never touched');
      });
      // 9. the 21:00 UTC lock: a net cast at 20:59:5x stays on 5 Nov; from 21:00 the open net is tomorrow's (6 Nov). The night
      //    a cast lands in is the CHAIN's (block time): its clock is set next to the page's, then past 21:00 for tomorrow's net
      const at = Date.parse('2026-11-05T20:59:50Z');
      await chain.rpc('evm_setNextBlockTimestamp', ['0x' + (at / 1000 - 10).toString(16)]); await chain.rpc('evm_mine');
      await scenario('lock', { width: 360, height: 740, at, page: chain.html, storage: PRESET(), wallet: { account: chain.accounts[5], rpc: chain.url } }, async (p, { shot }) => {
        assert.equal(await p.evaluate(() => QCP.stage), 'tonight');
        assert.equal(await txt(p, '#stageh'), "Tonight's net · Thu 5 Nov");
        await castNft(p, 3);
        assert.ok(await hidden(p, '#act'), 'cast: nothing more to press');
        await p.waitForFunction(() => QCP.win().day === '2026-11-06', { timeout: 15000 }); await sleep(1300);
        assert.equal(await p.evaluate(() => QCP.stage), '2026-11-05', 'after 21:00 UTC the net just locked stays on the first screen');
        assert.equal(await txt(p, '#stageh'), 'Your net · night of Thu 5 Nov');
        assert.match(await txt(p, '#prompt'), /^Your net is on spot 3\.Nets are closed\. He usually starts between 22:10 and 22:40 your time\. It ends Fri 13:00 your time, then IBM's chip looks\.$/);
        assert.equal(await p.$eval('#nights button[aria-pressed="true"]', (e) => e.dataset.day), '2026-11-05', 'a strip button for the net\'s night (not in the page yet)');
        assert.equal(await p.$eval('.spot.net', (e) => e.dataset.spot), '3');
        assert.match(await txt(p, '#waiting'), /Thu 5 Nov: your net on spot 3, waiting for the chip\./);
        assert.ok(!(await hidden(p, '#nftbox')), 'the locked net\'s NFT in the deck');
        await shot('0-net-locked');
        assert.equal(await txt(p, '#alt'), "Cast tomorrow's net");
        await p.click('#alt'); await sleep(200);
        assert.equal(await txt(p, '#stageh'), "Tomorrow's net · Fri 6 Nov", 'tomorrow\'s net behind the secondary button');
        assert.match(await txt(p, '#prompt'), /^Nets close 22:00 tomorrow · result Sat after 13:00He usually starts 22:10–22:40 · closes in 23 h 59 min$/);
        await chain.rpc('evm_setNextBlockTimestamp', ['0x' + (Date.parse('2026-11-05T21:00:30Z') / 1000).toString(16)]); await chain.rpc('evm_mine');
        await castNft(p, 9, '2026-11-06');
        const st = await stored(p); assert.equal(st.nets['2026-11-05'].spot, 3); assert.equal(st.nets['2026-11-06'].spot, 9);
        assert.equal(st.nets['2026-11-06'].nft.tokenId, QC.netId(QC.nightOfDay('2026-11-06'), chain.accounts[5]), 'the chain put it on 6 Nov');
        await shot('1-after-lock');
      });
    } finally { chain.proc.kill('SIGTERM'); }
  } else results.push(['skip', 'short-*, nft-*, no-address, lock', 'no chain']);

  // 10. fetch blocked (as in the claude.ai preview: no wallet either) AND no localStorage: watch mode, the practice works,
  //     nothing live is shown
  await scenario('blocked', { width: 360, height: 740, scheme: 'light', api: 'abort', noStorage: true, results: null }, async (p, { shot, noHScroll }) => {
    await sleep(1200);
    assert.ok(await hidden(p, '#live'), 'LIVE badge hidden'); assert.ok(await hidden(p, '#sofar'), 'no live rounds');
    assert.equal(await p.evaluate(() => QCP.stage), 'tonight');
    await watchMode(p);
    await openPractice(p);
    await practice(p);
    assert.match(await txt(p, '#revt'), /hamster!$|^He got away\.$/);
    assert.equal(await p.$eval('#mycountn', (e) => e.textContent), '1', 'works without storage');
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
