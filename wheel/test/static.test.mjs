// The built page's contract (artifact + standalone site), the Quantum Catch wording, honesty wording, results.json and the
// public export (tools/export-public.sh, when present).   python3 wheel/build.py && node --test wheel/test/static.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const here = new URL('.', import.meta.url).pathname;
const ROOT = path.resolve(here, '../..');
const OUT = process.env.QW_PAGE || path.join(ROOT, 'wheel/out/quantum-catch.html');
const QW = createRequire(import.meta.url)(path.join(ROOT, 'wheel/engine.js'));
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'wheel/config.json'), 'utf8'));
const TAGLINE = "Squeektoshi's run programs a real quantum computer. Catch the hamster it lands on.";
const html = fs.readFileSync(OUT, 'utf8');
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
const text = html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<script>[\s\S]*?<\/script>/g, '');   // the visible markup
const block = (start) => { const i = css.indexOf(start); assert.ok(i >= 0, `missing CSS block ${start}`); let d = 0, j = css.indexOf('{', i); for (let k = j; k < css.length; k++) { if (css[k] === '{') d++; else if (css[k] === '}' && --d === 0) return css.slice(j, k + 1); } return ''; };

test('page head: starts with <meta charset>, then the title and the viewport-fit meta; no document wrapper tags', () => {
  const lines = html.split('\n');
  assert.equal(lines[0], '<meta charset="utf-8">');
  assert.equal(lines[1], '<title>Quantum Catch</title>');
  assert.equal(lines[2], '<meta name="claude:viewport-fit-sides" content="cover">');
  assert.ok(!/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]|<\/body>|<\/html>/i.test(html), 'no doctype/html/head/body tags');
  assert.ok(!html.startsWith('\uFEFF'));
});

test('theme tokens in all three places, body has a token background', () => {
  const light = block(':root {'), media = block('@media (prefers-color-scheme: dark)'), forced = block(':root[data-theme="dark"]');
  assert.ok(media.includes(':root:not([data-theme="light"])'), 'dark media block guarded by :root:not([data-theme="light"])');
  assert.match(media, /color-scheme:\s*dark/);
  assert.match(forced, /color-scheme:\s*dark/);
  for (const tok of ['--bg', '--card', '--card2', '--ink', '--muted', '--line', '--line2', '--accent', '--violet', '--good', '--bad', '--t0', '--t4', '--stage-a']) {
    for (const [name, b] of [['light :root', light], ['dark media', media], ['[data-theme=dark]', forced]]) assert.ok(new RegExp(tok + '\\s*:').test(b), `${tok} in ${name}`);
  }
  assert.match(css, /body\s*\{[^}]*background:\s*var\(--bg\)/);
});

test('layout contract: side gutter on one outer wrapper, no transition: all', () => {
  assert.match(css, /\.page\s*\{[^}]*padding-left:\s*max\(16px,\s*env\(safe-area-inset-left,\s*0px\)\)[^}]*padding-right:\s*max\(16px,\s*env\(safe-area-inset-right,\s*0px\)\)[^}]*padding-block:/);
  assert.ok(!/transition\s*:\s*all\b/i.test(html), 'never transition: all');
});

test('everything inline: no external scripts; only Google Fonts links', () => {
  assert.ok(!/<script[^>]*\bsrc\s*=/i.test(html), 'no <script src>');
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) assert.match(m[0], /href="https:\/\/fonts\.(googleapis|gstatic)\.com[/"]/, m[0]);
  for (const m of html.matchAll(/@import/g)) assert.fail('no @import');
  assert.match(css, /font-family|font:/);
  assert.match(css, /--display:\s*"Anton",[^;]*sans-serif/, 'font fallbacks (display: Anton)');
  assert.match(css, /--body:\s*"Space Mono",[^;]*monospace/, 'font fallbacks (body: Space Mono)');
  assert.equal([...html.matchAll(/<link rel="stylesheet"[^>]*>/g)].length, 1, 'one Google Fonts stylesheet');
  assert.ok(!/Baloo/.test(html), 'the old display font is gone (canvas text too)');
});

test('no alert/confirm/prompt dialogs, no window.open, no downloads; localStorage only inside try', () => {
  assert.ok(!/(^|[^\w.$'"-])(alert|confirm|prompt)\s*\(/.test(scripts), 'no alert/confirm/prompt calls');
  assert.ok(!/window\.(open|alert|confirm|prompt)\b/.test(scripts), 'no window.open/dialogs');
  assert.ok(!/\bdownload\s*=|\.download\b|createObjectURL/.test(scripts) && !/<a\b[^>]*\bdownload\b/i.test(html), 'no downloads');
  const uses = scripts.split('\n').filter((l) => l.includes('localStorage'));
  assert.ok(uses.length >= 2, 'reads and writes localStorage');
  for (const l of uses) assert.match(l, /try\s*\{[^}]*localStorage/, `localStorage outside try: ${l.trim().slice(0, 90)}`);
});

test('size under 5 MB', () => {
  const n = Buffer.byteLength(html);
  assert.ok(n < 5 * 1024 * 1024, `${n} bytes`);
  assert.ok(n > 300 * 1024, 'art is embedded');
});

// private words for the leak gate live in wheel/test/local.json {"leakWords": [...]}, which is not in git (a public copy of
// this test must not carry them); without it the gate still checks every other pattern and says so.
const LOCAL = (() => { try { return JSON.parse(fs.readFileSync(path.join(here, 'local.json'), 'utf8')); } catch (e) { return {}; } })();
const WORDS = (LOCAL.leakWords || []).filter((w) => /^[a-z0-9]+$/i.test(w));

// the owner's public GitHub account may appear ONLY inside the repo link (config repoUrl), never anywhere else. (The token
// patterns are written with [..] so that this file itself passes the same gate when the source is published.)
const ACCOUNT = new URL(CFG.repoUrl).pathname.split('/')[1];
const leakHits = (page, allowed0x) => {
  const PATS = { 'server path': /\/(root|home|tmp|etc|var|opt)\/[\w.-]+/g, ...(WORDS.length ? { 'household word': new RegExp(`\\b(${WORDS.join('|')})\\b`, 'gi') } : {}),
    email: /[\w.+-]+@[\w-]+\.[a-z]{2,}/g, ipv4: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, token: /(gh[p]_|github[_]pat_|sk[-]ant|xox[bp]-|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9])/g,
    'ibm account': /crn[:]v1|instance[_]id/g, 'long hex': /\b[a-fA-F0-9]{48,}\b/g };
  const t = page.replace(/[A-Za-z0-9+/=]{200,}/g, '').split(CFG.repoUrl).join('');
  const hits = [];
  for (const [k, re] of Object.entries(PATS)) for (const m of new Set(t.match(re) || [])) hits.push(`${k}: ${m}`);
  for (const a of new Set(t.match(/0x[a-fA-F0-9]{40}/g) || [])) if (!allowed0x.has(a.toLowerCase())) hits.push(`address: ${a}`);
  return hits;
};
const CORES = ['0x980b4424c007caf7a1f3670b48c8eaef7ebc3d44', '0xfd6c166d4b8e2962e65746a13e5a0797cd4de0c4'];

test('leak gate on the page (server paths, household words, emails, IPs, tokens, long hex, addresses: both SqueekCore addresses allowed; the GitHub account only in the repo link)', (ctx) => {
  if (!WORDS.length) ctx.diagnostic('no private leak words configured (wheel/test/local.json): household-word check skipped');
  assert.equal(CFG.repoUrl, 'https://github.com/Rooaraak/quantum-squeak');
  assert.ok(html.includes(CFG.repoUrl), 'the repo link is in the page');
  assert.deepEqual(leakHits(html, new Set([...CORES, ...(CFG.catchAddress ? [CFG.catchAddress.toLowerCase()] : [])])), []);
  assert.ok(!html.split(CFG.repoUrl).join('').toLowerCase().includes(ACCOUNT.toLowerCase()), 'the account name appears nowhere but in the repo link');
  assert.ok(!/TESTFIXTURE/.test(html), 'no test fixture in the real build');
  if (WORDS.includes(ACCOUNT.toLowerCase())) assert.ok(leakHits(`see ${ACCOUNT.toLowerCase()} here`, new Set()).some((h) => /household word/.test(h)), 'the gate still catches the name outside the link');
});

test('Quantum Catch: the name, the tagline verbatim, Powered by Squeekchain, GitHub links; no egg and no hatch anywhere', () => {
  assert.match(text, /<h1>.*<span>Quantum Catch<\/span><\/h1>/);
  assert.ok(text.includes(`<p class="lede">${TAGLINE}</p>`), 'the tagline, verbatim, under the name');
  assert.match(text, /Powered by Squeektoshi's real wheel on <b>Squeekchain<\/b>/);
  const plain = html.replace(/[A-Za-z0-9+/=]{200,}/g, '');               // base64 art can spell anything by chance
  assert.ok(!/hatch/i.test(plain), `no "hatch": ${(plain.match(/.{30}hatch.{30}/i) || [''])[0]}`);
  assert.ok(!/\beggs?\b/i.test(plain), 'no eggs');
  assert.ok(!/Quantum Wheel|quantum-wheel/.test(plain), 'the old name is gone');
  assert.match(text, /id="ghlink"[^>]*>[\s\S]*?Code on GitHub<\/a>/, 'Code on GitHub in Check it yourself');
  assert.match(text, /<footer>[\s\S]*id="ghfoot"[^>]*>Code on GitHub<\/a>[\s\S]*<\/footer>/, 'Code on GitHub in the footer');
  assert.match(scripts, /for \(const a of \[\$\('ghlink'\), \$\('ghfoot'\)\]\) a\.href = CFG\.repoUrl/);
});

test('simple first: the first screen (hero + stage) has no math; everything else sits in exactly two disclosures', () => {
  const hero = text.slice(text.indexOf('<header class="hero">'), text.indexOf('</header>'));
  const stage = text.slice(text.indexOf('<section class="card play"'), text.indexOf('<div class="story">'));
  for (const first of [hero, stage]) {
    const words = first.replace(/<[^>]+>/g, ' ');
    for (const bad of [/mod 16/i, /TVD|total variation/i, /ghost copies step/i, /\bdials?\b/i, /0x[0-9a-f]/i, /qubit/i, /\bRY\b/, /&pi;|π/]) assert.ok(!bad.test(words), `${bad} on the first screen`);
    assert.ok(!/class="(dials|tape|layers)"/.test(first), 'no dials, tape or layer switch on the first screen');
  }
  const more = [...text.matchAll(/<details class="card more" id="(\w+)">\s*<summary>([^<]+)<\/summary>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(more, [['how', 'How it works'], ['check', 'Check it yourself']]);
  assert.ok(text.indexOf('id="dials"') > text.indexOf('id="how"'), 'the coin tilts live in How it works');
  assert.ok(text.indexOf('id="checkkv"') > text.indexOf('id="check"'), 'addresses and jobs live in Check it yourself');
  assert.ok(text.indexOf('id="twinpct"') > text.indexOf('id="check"'), 'the twin test lives in Check it yourself');
});

test('honesty wording: no overclaims, "probably" first, the 75% line, the fine print, per-night quantumness, shorter program', () => {
  const all = (text + '\n' + scripts).replace(/\s+/g, ' ');
  for (const bad of [/certified/i, /proven quantum/i, /no normal computer could/i, /quantum advantage/i, /quantum supremacy/i, /impossible for a (normal|classical) computer/i,
    /(always|every night)[^.]{0,40}(keeps|kept|beats) (the quantum pattern|noise)/i, /chip (always|every night) differs/i,
    /each night (runs|ran) on real IBM/i, /every night (runs|ran) on real IBM/i, /in the morning/i]) assert.ok(!bad.test(all), String(bad));
  for (const m of all.matchAll(/first hamster/gi)) assert.match(all.slice(Math.max(0, m.index - 30), m.index), /probably\s*(the\s*)?$/i, 'every "first hamster" is preceded by "probably"');
  assert.match(text, /Probably the first hamster to program a quantum computer/);
  assert.match(text, /A demonstration on one chip, not a lab-grade test\./);
  assert.match(all, /beats the 75% limit any fixed plan can reach/);
  assert.match(all, /A normal computer can simulate this small walk/);
  // decision 5: the owner's two sentences (with how much closer) in How it works; the result card gets one plain line
  assert.match(scripts, /The chip kept the quantum pattern that night: its landings were \$\{q\.closer\.toFixed\(1\)\}&times; closer/);
  assert.match(scripts, /Noise washed out most of the quantum pattern that night: the ghost landed more like a normal hamster/);
  assert.match(scripts, /'That night the chip kept the quantum pattern\.'/);
  assert.match(scripts, /'That night noise washed out most of the quantum pattern\. Newer nights run a shorter program to keep it\.'/, 'a v1.1 noise night points to the shorter program');
  assert.match(scripts, /'That night noise washed out most of the quantum pattern, even with the shorter program\.'/, 'a v1.2 noise night does not');
  assert.match(text, /What is real is that every chip result shown here ran on real IBM hardware/);
  assert.match(text, /<footer>[\s\S]*<p>A community project\. Not made by the Squeekchain team\. <a class="ghf"[\s\S]*<\/footer>/, 'the footer line (the owner\'s words)');
  assert.ok(!/not affiliated/.test(text), 'one footer line about the team, not two');
  assert.match(scripts, /Newer nights use a shorter program \(recipe v1\.2: at most 10 steps, plus noise protection\) to keep the quantum pattern/);
  assert.match(scripts, /The chip does not beat noise every night\./);
  assert.ok(!/ghosts? (copies )?cancelled[^.]*out of reach|out of reach[^.]*cancel/i.test(all), 'the parity half is never "cancelled"');
});

// the owner's rarity rule (5 Nov): one short line under How it works, a rank grid (no share bands), the recipe line; nothing
// of it on the first screen
test('rarity rule: the one-line explanation and the rank grid in How it works, the rule in the recipe; no share bands', () => {
  const how = text.slice(text.indexOf('<details class="card more" id="how">'), text.indexOf('<details class="card more" id="check">'));
  const plain = (h) => h.replace(/<[^>]+>/g, '').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ');
  assert.ok(plain(how).includes("The least-visited spot he could reach is Epic; if the chip's very first look landed there, it is Legendary."), 'the owner\'s line');
  const grid = how.match(/<div class="tiers"[^>]*>([\s\S]*?)<\/div><\/div>/);
  assert.ok(grid, 'the rank grid');
  assert.deepEqual([...grid[1].matchAll(/<b>(\w+)<\/b>/g)].map((m) => m[1]), ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary']);
  assert.ok(!/\d(\.\d)?%\+|5-10%|2\.5-5%|1\.5-2\.5%|1-1\.5%/.test(text + scripts), 'no share bands left (10%+, 5-10%, ...)');
  assert.ok(!/share of the landings picks the rarity|The fewer looks there, the rarer the hamster\./i.test(text), 'the old share rule is gone');
  const check = text.slice(text.indexOf('<details class="card more" id="check">'), text.indexOf('</details>\n    </div>\n  </div>'));
  assert.match(plain(check), /at most as many spots from his start as he took steps/, 'the recipe: reach needs the ring distance');
  assert.match(plain(check), /the fewest is Epic \(Legendary if the chip's very first shot landed there\), the next Rare, the two after that Uncommon, the rest Common/, 'the recipe: the rank rule');
  const first = text.slice(text.indexOf('<header class="hero">'), text.indexOf('<div class="story">'));
  assert.ok(!/Legendary|Epic|least-visited/.test(first.replace(/<[^>]+>/g, ' ')), 'the first screen stays simple');
  // the ring shows the tiers after the reveal: Legendary gets the gold tag
  assert.match(css, /\.ring\.revealed \.spot\[data-tier="4"\] \.tag \{[^}]*background: var\(--r4\)/, 'a gold Legendary tag');
  assert.match(css, /--r4: #ffd66b/, 'gold');
});

const DATA_ = (() => { const m = scripts.match(/const DATA = (\{.*?\});\n/s); assert.ok(m, 'DATA literal'); return JSON.parse(m[1]); })();

test('recipe per night: the archive is v1.1 (up to 16 steps), each night\'s steps are what its recipe makes from his rounds', () => {
  const D = DATA_;
  assert.deepEqual(D.recipes, { 'v1.1': 16, 'v1.2': 10 }); assert.equal(D.archive_last, '2026-11-04');
  for (const [d, n] of Object.entries(D.nights)) {
    assert.equal(n.recipe, d <= D.archive_last ? 'v1.1' : 'v1.2', d);
    assert.deepEqual(n.steps, QW.steps(n.rounds.map((r) => r[1]), QW.capOf(n.recipe)), `${d} steps`);
    if (D.chips[d]) { assert.deepEqual(D.chips[d].steps, n.steps, `${d}: the night's result is a run of its own recipe`); assert.equal(D.chips[d].recipe, n.recipe); }
  }
  for (const r of D.reruns) { assert.notEqual(r.recipe, D.nights[r.night].recipe, 're-runs are the other recipe'); assert.deepEqual(r.steps, QW.steps(D.nights[r.night].rounds.map((x) => x[1]), QW.capOf(r.recipe))); }
  assert.deepEqual(D.config, { repoUrl: CFG.repoUrl, catchAddress: CFG.catchAddress, chainId: '0xaa36a7' }, 'config straight from wheel/config.json');
  // deployed on Sepolia 2026-11-06 (block 12072952): the real build carries that address, lower case
  assert.equal(D.config.catchAddress, '0xa0b3352b3a436c845e3bf2d251abeda3d474dfe0', 'the deployed QuantumCatch address');
  assert.deepEqual(D.core, { address: '0xfd6c166d4b8e2962e65746a13e5a0797cd4de0c4', genesis: 1793735400 });
});

test('results.json next to the page: the same nights and chip results (the standalone site reads it), nothing private', () => {
  const R = JSON.parse(fs.readFileSync(path.join(path.dirname(OUT), 'results.json'), 'utf8'));
  assert.equal(R.kind, 'quantum_catch_results'); assert.equal(R.v, 1);
  for (const k of ['nights', 'chips', 'reruns', 'not_shown', 'recipes', 'archive_last']) assert.deepEqual(R[k], DATA_[k], k);
  assert.deepEqual(leakHits(JSON.stringify(R), new Set(CORES)), []);
});

test('embedded data: 7 nights, every healthy chip run in quantum/ (the night\'s result or a re-run), every run NOT shown disclosed on its night, the twin job', () => {
  const D = DATA_;
  assert.equal(Object.keys(D.nights).length, 7);
  for (const n of Object.values(D.nights)) assert.ok(n.genesis && n.core && n.rounds.length && n.steps.length && !n.perfectTrace, 'walks are computed by the engine in the page');
  const healthy = fs.readdirSync(path.join(ROOT, 'quantum')).filter((f) => /^wheel-.*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'quantum', f), 'utf8')))
    .filter((r) => r.kind === 'quantum_wheel' && r.healthy !== false && r.twin.reduce((a, p) => a + p.wins, 0) / r.twin.reduce((a, p) => a + p.shots, 0) >= 0.79);
  for (const r of healthy) {
    const own = QW.capOf(r.recipe) === QW.capOf(D.nights[r.night].recipe);
    if (own) assert.ok(D.chips[r.night].job_id === r.job_id || D.not_shown.some((x) => x.job_id === r.job_id && x.why === 'replaced'), `chip run ${r.job_id} for ${r.night} embedded or listed as replaced`);
    else assert.ok(D.reruns.some((x) => x.job_id === r.job_id), `re-run ${r.job_id} (${r.recipe}) listed for comparison`);
  }
  assert.equal(Object.keys(D.chips).length, 7, 'all 7 archive nights have their v1.1 chip result');
  assert.deepEqual(D.reruns.map((r) => [r.night, r.recipe]), [['2026-11-01', 'v1.2'], ['2026-11-04', 'v1.2']]);
  // review fix (post-selection): the health gate used to drop runs silently. Now every rejected run is listed with its job id
  // and twin score, never as a night's result, and the page states the gate's number.
  const rejDir = path.join(ROOT, 'quantum', 'rejected');
  const rejected = fs.existsSync(rejDir) ? fs.readdirSync(rejDir).filter((f) => /^wheel-.*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(rejDir, f), 'utf8'))) : [];
  for (const j of rejected) {
    const x = (D.not_shown || []).find((r) => r.job_id === j.job_id);
    assert.ok(x, `rejected job ${j.job_id} listed in not_shown`);
    assert.equal(x.night, j.night); assert.equal(x.why, 'rejected');
    assert.equal(x.twin_wins, j.twin.reduce((a, p) => a + p.wins, 0));
    assert.ok(!Object.values(D.chips).some((c) => c.job_id === j.job_id), `rejected job ${j.job_id} is never a night's result`);
  }
  assert.equal(D.health_min, 0.79);
  assert.match(scripts, /thrown out and redone/);
  assert.ok(!scripts.includes('"perfectTrace"'), 'no precomputed walks in the data');
  assert.match(text, /scores under <span class="hmin">79%<\/span> are thrown out and redone/);
  assert.equal(D.twin.job_id, 'dblspcu74qds73dr42cg');
  assert.equal(D.twin.pairs.reduce((a, p) => a + p.wins, 0), 3372);
});

test('the first shot of every chip run (the night\'s result and the re-runs) is in the data: shots_in_order[0], turned onto the ring', () => {
  const D = DATA_, ref = JSON.parse(execFileSync('python3', [path.join(here, 'tier_ref.py')], { encoding: 'utf8', maxBuffer: 64 << 20 }));
  const files = Object.fromEntries(fs.readdirSync(path.join(ROOT, 'quantum')).filter((f) => /^wheel-2026-.*\.json$/.test(f)).map((f) => { const R = JSON.parse(fs.readFileSync(path.join(ROOT, 'quantum', f), 'utf8')); return [R.job_id, R]; }));
  const all = [...Object.values(D.chips), ...D.reruns];
  assert.equal(all.length, 9);
  for (const c of all) {
    const R = files[c.job_id], T = QW.ringTurn(R.rounds.map((r) => r[1]));
    assert.ok(Number.isInteger(c.first_shot), `${c.job_id}: first_shot`);
    assert.equal(c.first_shot, QW.spotOf(R.shots_in_order[0], T), `${c.job_id}: the result file's first shot, turned`);
    assert.equal(c.first_shot, ref.real.find((x) => x.job_id === c.job_id).first, `${c.job_id}: = the Python reference`);
    assert.ok(QW.turned(R.counts, T)[c.first_shot] > 0, 'the first shot is a landing');
    if (c.shots_in_order) assert.equal(c.first_shot, QW.spotOf(c.shots_in_order[0], T));
  }
});

test('build.py applies the twin-test health gate (a rejected run is skipped, the page still builds)', () => {
  const rej = path.join(ROOT, 'quantum', 'rejected');
  if (!fs.existsSync(rej) || !fs.readdirSync(rej).some((f) => /^wheel-.*\.json$/.test(f))) return;
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qw-')), 'gate.html');
  const log = execFileSync('python3', [path.join(ROOT, 'wheel/build.py'), '--chips', path.join(rej, 'wheel-*.json'), '--out', out], { encoding: 'utf8' });
  assert.match(log, /SKIPPED chip run .*health gate/);
  assert.match(log, /no night yet/);
  const g = fs.readFileSync(out, 'utf8'); assert.ok(g.startsWith('<meta charset="utf-8">\n'));
  fs.rmSync(path.dirname(out), { recursive: true });
});

test('a test build with the QuantumCatch address: the address is in the config (and allowed by the gate); the real build has none', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-addr-')), out = path.join(dir, 'nft.html'), A = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
  const log = execFileSync('python3', [path.join(ROOT, 'wheel/build.py'), '--catch-address', A, '--out', out], { encoding: 'utf8' });
  assert.match(log, /NFT button: on, 0x5FbDB/);
  const t = fs.readFileSync(out, 'utf8'), D = JSON.parse(t.match(/const DATA = (\{.*?\});\n/s)[1]);
  assert.equal(D.config.catchAddress, A.toLowerCase());
  assert.deepEqual(leakHits(t, new Set([...CORES, A.toLowerCase()])), []);
  assert.ok(leakHits(t, new Set(CORES)).some((h) => h.includes(A.toLowerCase())), 'without the config value the gate would stop it');
  assert.ok(fs.existsSync(path.join(dir, 'results.json')));
  const bad = spawnSync('python3', [path.join(ROOT, 'wheel/build.py'), '--catch-address', '0x1234', '--out', out], { encoding: 'utf8' });
  assert.notEqual(bad.status, 0); assert.match(bad.stderr, /catchAddress must be an address/);
  fs.rmSync(dir, { recursive: true });
});

// tools/export-public.sh is THE public export (the site repo the page links: wheel/config.json repoUrl). It is run on this
// working tree into a scratch staging dir (never the real site repo). It is not part of the public repo itself, so a
// public copy of this test skips these.
const EXPORTER = path.join(ROOT, 'tools/export-public.sh');
const NO_EXPORTER = !fs.existsSync(EXPORTER) && 'tools/export-public.sh is not in this copy (the public repo does not ship it)';
function runExport(env = {}, prepare = null) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qc-site-')), 'stage');
  if (prepare) prepare(dir);
  const r = spawnSync('bash', [EXPORTER, '--worktree', dir], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { dir, r, done: () => fs.rmSync(path.dirname(dir), { recursive: true, force: true }) };
}
const walk = (d, b = d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), b) : [path.relative(b, path.join(d, e.name))]));
test('export-public.sh: index.html + results.json (the site) + README.md + LICENSE + .gitignore + the source, by allowlist; meta description = the tagline; the leak gate passes on every file', { skip: NO_EXPORTER }, () => {
  const { dir, r, done } = runExport();
  try {
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /LEAK GATE CLEAN: no known leak pattern found/);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['.gitignore', 'LICENSE', 'README.md', 'contracts', 'data', 'index.html', 'quantum', 'results.json', 'wheel']);
    const files = walk(dir);
    for (const f of ['wheel/engine.js', 'wheel/catch.js', 'wheel/page.template.html', 'wheel/build.py', 'wheel/config.json', 'wheel/art/art.json', 'wheel/test/static.test.mjs',
      'quantum/wheel.py', 'quantum/wheel_spec.md', 'quantum/wheel-2026-10-31-ibm_marrakesh-dbmbiau74qds73ds0hug.json', 'data/chain-nights.json', 'contracts/src/QuantumCatch.sol',
      'wheel/out/quantum-catch.html', 'wheel/out/results.json']) assert.ok(files.includes(f), `exported: ${f}`);
    for (const f of files) assert.ok(!/(^|\/)local\.json$|\.log$|^tools\/|^prototype\/|^site\/|__pycache__/.test(f) || /^quantum\/rejected\/wheel-.*\.log$/.test(f), `never exported: ${f}`);
    assert.match(r.stdout, new RegExp(`FILES \\(${files.length}\\)`), 'the gate ran on every exported file');
    for (const f of ['wheel/engine.js', 'wheel/catch.js', 'wheel/art/art.json', 'quantum/wheel.py', 'wheel/out/results.json']) assert.equal(fs.readFileSync(path.join(dir, f), 'utf8'), fs.readFileSync(path.join(ROOT, f), 'utf8'), `${f}: a straight copy of the source`);
    assert.match(fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8'), /^MIT License/);
    const idx = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.ok(idx.includes(`<meta name="description" content="${TAGLINE}">`), 'meta description = the tagline');
    assert.ok(idx.includes(`<meta property="og:description" content="${TAGLINE}">`));
    assert.ok(idx.includes('<meta property="og:title" content="Quantum Catch">'));
    assert.match(idx, /^<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n/);
    assert.ok(idx.includes('<title>Quantum Catch</title>'));
    assert.equal(idx.slice(idx.indexOf('<title>')), html.slice(html.indexOf('<title>')), 'index.html = the built page under a standard head');
    assert.equal(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'), fs.readFileSync(path.join(path.dirname(OUT), 'results.json'), 'utf8'), 'results.json next to the page');
    const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
    const ln = (v) => (v ? `[\`${v}\`](https://sepolia.etherscan.io/address/${v})` : 'not deployed yet');
    assert.equal(readme, fs.readFileSync(path.join(ROOT, 'tools/public-README.md'), 'utf8').replace('{{REPO_URL}}', CFG.repoUrl).replace('{{QUANTUM_CATCH}}', ln(CFG.catchAddress)).replace('{{PAINTED_ART}}', ln(CFG.paintedArtAddress)), 'README.md = tools/public-README.md, filled');
    assert.match(readme, /^# Quantum Catch/); assert.ok(!/hatch(?!er\b)|\beggs?\b/i.test(readme), 'README: no hatch (only the contract\'s hatcher role), no eggs');
    assert.match(readme, /ranked by landings,\s+most\s+first/); assert.ok(!/10%\+ Common|1-1\.5 Legendary|>= 10 % Common/.test(readme), 'README: the rank rule, not the share tiers');
    assert.ok(!/squeekchain-project/.test(readme + idx), 'no project id configured: no tag, no line');
  } finally { done(); }
});
test('export-public.sh: the optional squeekchainProjectId (QC_PROJECT_ID) becomes the meta tag and the README line; a bad one is refused', { skip: NO_EXPORTER }, () => {
  let { dir, r, done } = runExport({ QC_PROJECT_ID: 'qc-test-1' });
  try {
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), /\n<meta name="squeekchain-project" content="qc-test-1">\n/);
    assert.match(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), /\nsqueekchain-project: qc-test-1\n$/);
  } finally { done(); }
  ({ dir, r, done } = runExport({ QC_PROJECT_ID: 'x"><script>' }));
  try { assert.equal(r.status, 2); assert.match(r.stderr, /squeekchainProjectId/); assert.ok(!fs.existsSync(dir), 'nothing written'); } finally { done(); }
});
test('export-public.sh refuses a staging dir that holds files outside the allowlist (an old nights.json), and writes and deletes nothing', { skip: NO_EXPORTER }, () => {
  const { dir, r, done } = runExport({}, (d) => { fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'nights.json'), '{"old": 1}\n'); });
  try {
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /outside the allowlist[\s\S]*nights\.json/);
    assert.deepEqual(fs.readdirSync(dir), ['nights.json'], 'nothing written, nothing removed');
  } finally { done(); }
});
test('export-public.sh --self-test: every planted leak shape is caught, every look-alike stays clean', { skip: NO_EXPORTER }, () => {
  const r = spawnSync('bash', [EXPORTER, '--self-test'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const m = r.stdout.match(/self-test: (\d+)\/(\d+) cases as expected/);
  assert.ok(m && m[1] === m[2] && Number(m[2]) >= 59, r.stdout.slice(-400));
});
