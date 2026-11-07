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
// the website is Quantum Squeak (owner 11-07 "B yes rename"; the contracts and their on-chain texts keep QuantumCatch)
const TAGLINE = "Catch a hamster from another universe. Every night Squeektoshi's run opens the door, and a real IBM quantum computer shakes it.";
const html = fs.readFileSync(OUT, 'utf8');
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
const text = html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<script>[\s\S]*?<\/script>/g, '');   // the visible markup
const block = (start) => { const i = css.indexOf(start); assert.ok(i >= 0, `missing CSS block ${start}`); let d = 0, j = css.indexOf('{', i); for (let k = j; k < css.length; k++) { if (css[k] === '{') d++; else if (css[k] === '}' && --d === 0) return css.slice(j, k + 1); } return ''; };

test('page head: starts with <meta charset>, then the title and the viewport-fit meta; no document wrapper tags', () => {
  const lines = html.split('\n');
  assert.equal(lines[0], '<meta charset="utf-8">');
  assert.equal(lines[1], '<title>Quantum Squeak</title>');
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
  const own = [CFG.catchAddress, CFG.sqkAddress, CFG.faucetAddress, CFG.season1Address, CFG.season2Address].filter(Boolean).map((a) => a.toLowerCase());      // (v2: the test SQK token + its faucet; Season 1 / 2)
  assert.deepEqual(leakHits(html, new Set([...CORES, ...own])), []);
  assert.ok(!html.split(CFG.repoUrl).join('').toLowerCase().includes(ACCOUNT.toLowerCase()), 'the account name appears nowhere but in the repo link');
  assert.ok(!/TESTFIXTURE/.test(html), 'no test fixture in the real build');
  if (WORDS.includes(ACCOUNT.toLowerCase())) assert.ok(leakHits(`see ${ACCOUNT.toLowerCase()} here`, new Set()).some((h) => /household word/.test(h)), 'the gate still catches the name outside the link');
});

test('Quantum Squeak: the name, the story (the h1 + one line), the tagline verbatim, Powered by Squeekchain, GitHub links; no egg, no hatch, no season, no old name anywhere a visitor sees', () => {
  assert.match(text, /<p class="wm"><span>Quantum Squeak<\/span><\/p>/);
  assert.ok(text.includes(`<p class="lede">${TAGLINE}</p>`), 'the tagline, verbatim, in the footer');
  assert.ok(text.includes('<h1 class="headline">Catch a hamster from <em>another universe</em>.</h1>'), 'the headline is the page\'s h1: the story (owner 11-07)');
  assert.ok(text.includes(`<p class="lede1" id="lede1">Every night Squeektoshi's run opens the door. At <span class="tend">13:00</span> a real IBM quantum computer shakes it.</p>`), 'one story line (13:00 = his night\'s end, in your time)');
  assert.equal((text.match(/<h1\b/g) || []).length, 1, 'one h1');
  const words = text.replace(/<[^>]+>/g, ' ').replace(/[A-Za-z0-9+/=]{200,}/g, '');
  assert.ok(!/quantum catch|quantumcatch/i.test(words), `the old name nowhere in the markup: ${(words.match(/.{30}quantum ?catch.{30}/i) || [''])[0]}`);
  assert.ok(!/season|\bS2\b/i.test(words), `no season words in the markup: ${(words.match(/.{30}season.{30}/i) || [''])[0]}`);
  for (const w of ["'Your Season", "'Season 1", '>Season 1', 'Season 2 contract', 'Season 2 hamsters', 'A first look at Season 2', 'a Season 2 example', 'Season 2 seals', '(Season 1 nets', 'QuantumCatch contract', '>QuantumCatch ${'])
    assert.ok(!scripts.includes(w), `no season or old-name words in what the scripts write: ${w}`);
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
  // the tiles say what each hamster was (a word from DATA, JS only); Legendary gets the gold word
  assert.match(css, /\.lnd\[data-t="4"\] b \{[^}]*background: var\(--r4\)/, 'a gold Legendary word');
  assert.match(css, /--r4: #ffd66b/, 'gold');
});

// the game since 6 Nov (owner): no picking; a net costs 0.01 test SQK (burned) when the contract says so; one of the chip's
// 4,000 drops is yours; chip noise = got away; a daily faucet. The words are the page's; tier words stay JS-only
test('no picking: the claw-machine words, the 4 steps of How it works, last night\'s odds, the draw in the recipe', () => {
  const plain = (h) => h.replace(/<[^>]+>/g, '').replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, ' ');
  assert.ok(!/Pick (your|a) hamster|Your pick|Choose tonight's spot|Catch #|aria-pressed', String\(!!\(m && m\.spot/.test(text + scripts), 'no picker left');
  const first = text.slice(text.indexOf('<section class="card play"'), text.indexOf('<div class="story">'));
  assert.match(first, /<h2 id="stageh">Tonight's net<\/h2>/);
  // the owner (6 Nov 15:25, "Why do we need this"): no tiles while nothing is known (tonight, a net waiting, a night not in
  // the page yet); the roster block is hidden on those flat views and comes back on a night with data
  assert.match(css, /#play\.flat \.pick \{ display: none \}/, 'no roster on the flat views');
  assert.ok(scripts.includes("$('play').classList.toggle('flat', flat);"), 'flat = tonight or a night not in the page yet');
  assert.ok(scripts.includes("const NOT_WIRED = () => `A net costs ${costLabel()} test SQK (burned). Casting opens soon; until then try a free practice net under Past nights.`;"), 'a build that says a net costs test SQK, on a contract that takes none (build.py checks this guard is here)');
  // the old game's words are gone from every screen (My catches said "put it on a hamster"; the footer said "A free game")
  assert.ok(!/put it on a hamster|on a spot|free game/i.test(plain(text)), `no pick-era or "free game" words: ${(plain(text).match(/.{30}(put it on a hamster|on a spot|free game).{30}/i) || [''])[0]}`);
  assert.ok(!/put it on a hamster|free game/i.test(scripts), 'nor in the page\'s scripts');
  assert.match(css, /@media \(hover: hover\) \{ \.spot:hover \{ border-color: var\(--cream\) \} \}/, 'no sticky hover frame on a tapped tile (touch screens)');
  assert.match(first, /<h2 class="prh" id="prizesh">The prizes<\/h2><div class="prow" id="prow" role="list" aria-labelledby="prizesh"><\/div>/, 'the prizes: drawn by JS (composite)');
  // v3 (owner, 6 Nov "make it simple"): one button + one short line per state; the faucet resets per NET NIGHT (SqkFaucet)
  for (const k of ["`Cast a net · ${costLabel()} test SQK`", "'Cast a net · free'", "'Get free test SQK'", "`Free test SQK already used. Next one from ${",
    "'Your hamster got away.'", "'He slept: no catch that night.'", "'test token · no money value'", "'✓ Your net is in'", "'Chances from last night.'",
    "'Squeektoshi is running right now'", "'Squeektoshi is resting'", "const OLD = 'old net (picked)'", "'Cast a practice net · free'"]) assert.ok(scripts.includes(k), `the words: ${k}`);
  const how = text.slice(text.indexOf('<details class="card more" id="how">'), text.indexOf('<details class="card more" id="check">'));
  const steps = how.match(/<ol class="steps4" id="howsteps">([\s\S]*?)<\/ol>/);
  assert.ok(steps, 'How it works: the steps');
  assert.deepEqual([...steps[1].matchAll(/<li><b>([^<]+)<\/b>/g)].map((m) => m[1]), ['The door.', 'The shake.', 'Your net.', 'Got away?', 'The fuel.'], 'How it works opens with the story (owner 11-07; the fuel: the door runs on SQK)');
  assert.match(plain(steps[1]), /The door only opens for SQK\. Every net burns 0\.01 test SQK forever\. So far the door has eaten 0 SQK\./, 'the fuel step (its total: JS, hidden unless complete)');
  assert.ok(how.includes('<span id="burnth" hidden>'), 'the total starts hidden');
  assert.ok(how.indexOf('id="howsteps"') < how.indexOf('id="needs"'), 'the story first, then what you need');
  assert.match(plain(steps[1]), /One of the 4,000 drops is yours\. The hamster it lands on is your catch\. The rarer the hamster, the stranger its universe\./);
  assert.match(plain(steps[1]), /Some drops land where no hamster can be\. Then your hamster slipped back through the door\./);
  assert.deepEqual([...how.matchAll(/<div><b>(\w+)<\/b> (the [\w ]+)<\/div>/g)].slice(0, 5).map((m) => `${m[1]} ${m[2]}`), ['Common the Home Burrow', 'Uncommon the Wild Worlds', 'Rare the Machine Worlds', 'Epic the Dream Worlds', 'Legendary the Golden World'], 'the universes per tier (How it works only)');
  assert.match(how, /Nobody can choose it or know it before\./, 'the draw stays unknowable (Which drop is mine?)');
  assert.match(how, /<h4 id="oddsh">Last night's odds<\/h4>[\s\S]*<tbody id="oddsrows"><\/tbody>/, 'last night\'s odds table (JS from DATA)');
  const check = text.slice(text.indexOf('<details class="card more" id="check">'), text.indexOf('</details>\n    </div>\n  </div>'));
  assert.match(plain(check), /Each net gets one of the night's landings: keccak256 of \(the night, the posted result's hash and job id, the net's token id\) modulo the number of landings/, 'the draw, in the recipe');
  assert.match(css, /\.spot\.net\.drop::after \{ content: "YOURS" \}/, 'your drop\'s tile, after the replay');
});

// v3 (owner, 6 Nov: "too much text under ... could be somewhere separated", "add awesome artwork", "game is coming soon"): the
// game view (#game: stage, deck, prizes, the art band + Season 2 gallery, one Details link) and a Details view in the same
// file (#details: Past nights, Tonight, My catches, How it works, Check it yourself), shown by an ASCII hash with a Back link
test('v3 structure: the game view and the Details view, the art band and the Season 2 gallery, no LCD, the faucet per night, reduced motion', () => {
  assert.ok(text.indexOf('<div class="view" id="game">') >= 0, 'the game view');
  assert.ok(text.indexOf('<div class="view" id="game">') < text.indexOf('<div class="ln view" id="details" hidden>'), 'then the Details view (hidden until its hash)');
  assert.ok(text.includes('<a class="back" id="back" href="#">'), 'a Back link');
  assert.ok(!/(href|id)="#?(settings|sidebar|customize|upgrade|downloads|comment-[^"]*)"/.test(text), 'no reserved hash names');
  for (const h of ['details', 'past', 'tonight', 'mine', 'how', 'check']) assert.ok(scripts.includes(`'${h}'`) && /^[a-z]+$/.test(h), `hash ${h}`);
  const first = text.slice(text.indexOf('<section class="card play"'), text.indexOf('<div class="story">'));
  const soon = first.indexOf('id="soon"'), gal = first.indexOf('id="gallery"'), bar = first.indexOf('id="castbar"'), endPlay = first.indexOf('</section>');
  assert.ok(soon > endPlay && gal > soon, 'the art band and the gallery under the game, before the Details stories');
  assert.ok(bar > endPlay, 'the sticky cast bar sits outside #play');
  assert.ok(!/class="spot"/.test(first), 'no tile markup in the slice');
  for (const id of ['lcd', 'nfthint', 'chipline', 'deckrow', 'watchsqk']) assert.ok(!text.includes(`id="${id}"`), `no #${id} (owner: "make it simple")`);
  assert.match(first, /<span class="chipsoon">Coming soon<\/span><h2 id="soonh">Hamster Battles<\/h2><p>Hamsters from different universes will fight\.<\/p>/, 'the art band words (the story)');
  assert.match(first, /<a class="morel" id="morelink" href="#details">How it works · Details/, 'one link to Details');
  const how = text.slice(text.indexOf('<details class="card more" id="how">'), text.indexOf('<details class="card more" id="check">'));
  assert.match(how, /<dl class="faq" id="faq">/, "the owner's plain answers in How it works");
  assert.ok(how.includes('4 qubits give exactly 16 different answers: one per hamster') && how.includes('runs the same program 4,000 times') && how.includes('Nobody can choose it or know it before.'));
  assert.match(how, /<p class="small" id="needs">What you need: /);
  // the Season 2 preview cards + the teaser: in the page (ART), names and traits drawn by JS only, nothing the gate refuses
  const SHOW = JSON.parse(fs.readFileSync(path.join(ROOT, 'wheel/art/showcase.json'), 'utf8')), TEASE = JSON.parse(fs.readFileSync(path.join(ROOT, 'wheel/art/teaser.json'), 'utf8'));
  assert.equal(Object.keys(SHOW).length, 12);
  for (const [name, v] of Object.entries(SHOW)) {
    assert.ok(html.includes(v.data.slice(0, 200)), `${name}: in the page`);
    assert.ok(v.traits.length && !v.traits.some((t) => /v[a]ult/i.test(t)), `${name}: traits (none the export gate refuses)`);
    assert.ok(!text.includes(name), `${name}: drawn by JS, not static markup`);
  }
  // owner 11-06: "use higgsfield to make a image here how they fight" + "some art from the hamster to make the page look better"
  assert.ok(html.includes(TEASE.data.slice(0, 200)) && TEASE.w === 1400 && TEASE.h === 781, 'the fight scene');
  const BAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'wheel/art/banners.json'), 'utf8'));
  for (const k of ['lab', 'podium']) assert.ok(html.includes(BAN[k].data.slice(0, 200)), `${k} art in the page`);
  assert.ok(/<footer>\s*<img class="fart" id="labart"/.test(html), 'the lab picture opens the footer');
  assert.ok(/<img class="podart" id="podart"[^>]*>\s*<dl class="faq"/.test(html), 'the prizes podium sits in How it works, before the questions');
  // the faucet resets per net night (SqkFaucet: one claim per wallet per open night), never "a day"
  assert.ok(!/once a day|free daily|per wallet per day|come back tomorrow/i.test(text + scripts), 'the faucet is per net night');
  const rm = block('@media (prefers-reduced-motion: reduce)');
  for (const k of ['.coreglow', '.nftbox.new', '.castbar', '.gcard', '.stage.cast .beam']) assert.ok(rm.includes(k), `reduced motion: ${k}`);
  assert.ok(!/\.chiptag span/.test(css), 'no .chiptag span rule (it would hide the ALIVE line)');
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
  // v2 keys (the test SQK token, its faucet, the cost label) only when wheel/config.json has them
  const v2 = Object.fromEntries(['sqkAddress', 'faucetAddress', 'netCost'].filter((k) => k in CFG).map((k) => [k, k === 'netCost' ? String(CFG[k]) : CFG[k] ? CFG[k].toLowerCase() : null]));
  // Season 2: ONE switch, season2Address (null until the deploy): then the page casts on it and reads season1Address too
  const S2 = CFG.season2Address ? CFG.season2Address.toLowerCase() : null;
  assert.deepEqual(D.config, { repoUrl: CFG.repoUrl, catchAddress: S2 || CFG.catchAddress, chainId: '0xaa36a7', ...v2, season2: !!S2, season1Address: S2 ? CFG.season1Address.toLowerCase() : null }, 'config straight from wheel/config.json');
  // v2 deployed on Sepolia 2026-11-06 (block 12077948; v1 0xa0b3…dfe0 at 12072952 is retired): the real build carries it, lower case
  // (Season 1 once Season 2 is live)
  assert.equal(CFG.season1Address, '0x151ec033c914252358bdcdba0548ac6a7b4f7f49', 'season1Address = the deployed QuantumCatch v2');
  assert.equal(S2 ? D.config.season1Address : D.config.catchAddress, '0x151ec033c914252358bdcdba0548ac6a7b4f7f49', 'the deployed QuantumCatch v2 address');
  assert.equal(D.config.faucetAddress, '0xf0a8e3ffc21377794d5e68bf5587ef96089135f3', 'the deployed SqkFaucet address');
  assert.deepEqual(D.core, { address: '0xfd6c166d4b8e2962e65746a13e5a0797cd4de0c4', genesis: 1793735400 });
});

test('results.json next to the page: the same nights and chip results (the standalone site reads it), nothing private', () => {
  const R = JSON.parse(fs.readFileSync(path.join(path.dirname(OUT), 'results.json'), 'utf8'));
  assert.equal(R.kind, 'quantum_catch_results'); assert.equal(R.v, 1);
  for (const k of ['nights', 'chips', 'reruns', 'not_shown', 'recipes', 'archive_last']) assert.deepEqual(R[k], DATA_[k], k);
  assert.deepEqual(leakHits(JSON.stringify(R), new Set(CORES)), []);
});

test('embedded data: every night (8+), every healthy chip run in quantum/ (the night\'s result or a re-run), every run NOT shown disclosed on its night, the twin job', () => {
  const D = DATA_;
  // grows by one every morning (7 on 11-06, 8 with the 6 Nov night on 11-07): every night in data/chain-nights.json that is complete
  const CN = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/chain-nights.json'), 'utf8'));
  assert.ok(Object.keys(D.nights).length >= 8, 'at least the 8 nights through 6 Nov');
  for (const d of Object.keys(D.nights)) assert.ok(JSON.stringify(CN).includes(d), `${d} comes from data/chain-nights.json`);
  for (const n of Object.values(D.nights)) assert.ok(n.genesis && n.core && n.rounds.length && n.steps.length && !n.perfectTrace, 'walks are computed by the engine in the page');
  const healthy = fs.readdirSync(path.join(ROOT, 'quantum')).filter((f) => /^wheel-.*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'quantum', f), 'utf8')))
    .filter((r) => r.kind === 'quantum_wheel' && r.healthy !== false && r.twin.reduce((a, p) => a + p.wins, 0) / r.twin.reduce((a, p) => a + p.shots, 0) >= 0.79);
  for (const r of healthy) {
    const own = QW.capOf(r.recipe) === QW.capOf(D.nights[r.night].recipe);
    if (own) assert.ok(D.chips[r.night].job_id === r.job_id || D.not_shown.some((x) => x.job_id === r.job_id && x.why === 'replaced'), `chip run ${r.job_id} for ${r.night} embedded or listed as replaced`);
    else assert.ok(D.reruns.some((x) => x.job_id === r.job_id), `re-run ${r.job_id} (${r.recipe}) listed for comparison`);
  }
  assert.ok(Object.keys(D.chips).length >= 8, 'every night through 6 Nov has its chip result (7 archive v1.1 + the v1.2 nights)');
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
  assert.ok(all.length >= 10, 'every shown chip run (10 through the 6 Nov night) carries its first shot');
  for (const c of all) assert.ok(files[c.job_id], `${c.job_id}: its result file is in quantum/`);
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
  // a Season 1 test build (--season2-address null): since the 7 Nov switch wheel/config.json names the Season 2 contract
  const log = execFileSync('python3', [path.join(ROOT, 'wheel/build.py'), '--catch-address', A, '--season2-address', 'null', '--out', out], { encoding: 'utf8' });
  assert.match(log, /NFT button: on, 0x5FbDB/);
  const t = fs.readFileSync(out, 'utf8'), D = JSON.parse(t.match(/const DATA = (\{.*?\});\n/s)[1]);
  assert.equal(D.config.catchAddress, A.toLowerCase());
  const v2 = [CFG.sqkAddress, CFG.faucetAddress].filter(Boolean).map((a) => a.toLowerCase());     // (the test SQK + its faucet: wheel/config.json)
  assert.deepEqual(leakHits(t, new Set([...CORES, ...v2, A.toLowerCase()])), []);
  assert.ok(leakHits(t, new Set([...CORES, ...v2])).some((h) => h.includes(A.toLowerCase())), 'without the config value the gate would stop it');
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
      'wheel/out/quantum-catch.html', 'wheel/out/results.json', 'wheel/art/s2/skins.json', 'wheel/art/s2/make_skins.py']) assert.ok(files.includes(f), `exported: ${f}`);
    for (const f of files) assert.ok(!/(^|\/)local\.json$|\.log$|^tools\/|^prototype\/|^site\/|__pycache__/.test(f) || /^quantum\/rejected\/wheel-.*\.log$/.test(f), `never exported: ${f}`);
    assert.match(r.stdout, new RegExp(`FILES \\(${files.length}\\)`), 'the gate ran on every exported file');
    for (const f of ['wheel/engine.js', 'wheel/catch.js', 'wheel/art/art.json', 'quantum/wheel.py', 'wheel/out/results.json']) assert.equal(fs.readFileSync(path.join(dir, f), 'utf8'), fs.readFileSync(path.join(ROOT, f), 'utf8'), `${f}: a straight copy of the source`);
    assert.match(fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8'), /^MIT License/);
    const idx = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.ok(idx.includes(`<meta name="description" content="${TAGLINE}">`), 'meta description = the tagline');
    assert.ok(idx.includes(`<meta property="og:description" content="${TAGLINE}">`));
    assert.ok(idx.includes('<meta property="og:title" content="Quantum Squeak">'));
    assert.match(idx, /^<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n/);
    assert.ok(idx.includes('<title>Quantum Squeak</title>'));
    assert.equal(idx.slice(idx.indexOf('<title>')), html.slice(html.indexOf('<title>')), 'index.html = the built page under a standard head');
    assert.equal(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'), fs.readFileSync(path.join(path.dirname(OUT), 'results.json'), 'utf8'), 'results.json next to the page');
    const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
    const ln = (v) => (v ? `[\`${v}\`](https://sepolia.etherscan.io/address/${v})` : 'not deployed yet');
    assert.equal(readme, fs.readFileSync(path.join(ROOT, 'tools/public-README.md'), 'utf8').replace('{{REPO_URL}}', CFG.repoUrl).replace('{{SEASON_2}}', ln(CFG.season2Address)).replace('{{QUANTUM_CATCH}}', ln(CFG.season1Address || CFG.catchAddress)).replace('{{PAINTED_ART}}', ln(CFG.paintedArtAddress)), 'README.md = tools/public-README.md, filled');
    assert.match(readme, /^# Quantum Squeak/); assert.ok(!/season/i.test(readme), 'README: no season words'); assert.ok(!/hatch(?!er\b)|\beggs?\b/i.test(readme), 'README: no hatch (only the contract\'s hatcher role), no eggs');
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

// ---------- Season 2 (QuantumCatchV3): ONE switch in wheel/config.json (season2Address); the page before it is Season 1
// only (the gallery says what is coming); a Season 2 build casts on v3, reads Season 1 (v2) nets too, shows the small
// "Season 2" tag (the only new first-screen text), the prizes as each tier's skins, How it works's three sentences + the
// one-line odds table, and Check it yourself's seal + trait-slot recipe ----------
const s2Build = (args, filterCfg) => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'qc-s2-')), out = path.join(dir, 's2.html');
  // build.py with wheel/config.json read through a filter (a config edit without touching the file)
  const pre = filterCfg ? ['-c', ['import builtins, io, json, runpy, sys', 'real = builtins.open', `F = json.loads(${JSON.stringify(JSON.stringify(filterCfg))})`,
    'def fake(p, *a, **k):', "    if str(p).endswith('config.json') and not (a and 'w' in a[0]):", "        c = json.load(real(p)); c.update(F); return io.StringIO(json.dumps(c))", '    return real(p, *a, **k)',
    'builtins.open = fake', 'sys.argv = sys.argv[1:]', 'runpy.run_path(sys.argv[0], run_name="__main__")'].join('\n')] : [];
  const r = spawnSync('python3', [...pre, path.join(ROOT, 'wheel/build.py'), ...args, '--out', out], { encoding: 'utf8' });
  return { r, dir, out, page: () => fs.readFileSync(out, 'utf8'), done: () => fs.rmSync(dir, { recursive: true, force: true }) };
};
const V2A = '0x151ec033c914252358bdcdba0548ac6a7b4f7f49', V3A = '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512';
test('Season 2 before the switch: config has season1Address (v2) and season2Address null; the page is Season 1 only, the gallery says what is coming', () => {
  assert.equal(CFG.season1Address, V2A);
  assert.ok('season2Address' in CFG, 'the one switch is in wheel/config.json');
  if (CFG.season2Address) return;                                          // (after the switch: the next test covers the page)
  assert.equal(DATA_.config.season2, false); assert.equal(DATA_.config.season1Address, null);
  assert.ok(text.includes('<p class="gk" id="gk">Coming next: crazy new hamsters</p>'), 'the gallery heading before Season 2');
  assert.ok(text.includes('<span class="s2tag" id="s2tag" hidden>Season 2</span>'), 'the tag waits, hidden');
  assert.ok(!scripts.includes('"s2skins"'), 'no Season 2 skins in a Season 1 page');
});
test('Season 2 build (one switch): casts on v3, Season 1 from v2, the tag, the skins, How it works + the recipe; the gate allows both addresses', () => {
  const b = s2Build([], { season2Address: V3A });
  try {
    assert.equal(b.r.status, 0, b.r.stdout + b.r.stderr);
    assert.match(b.r.stdout, new RegExp(`NFT button: on, ${V3A}; Season 2: on \\(casts to ${V3A}, Season 1 nets from ${V2A}\\)`));
    const t = b.page(), D = JSON.parse(t.match(/const DATA = (\{.*?\});\n/s)[1]), A = JSON.parse(t.match(/const ART = (\{.*?\});\n/s)[1]);
    assert.deepEqual([D.config.catchAddress, D.config.season1Address, D.config.season2], [V3A, V2A, true]);
    assert.deepEqual(A.s2skins.map((x) => x.map(([k]) => k)), [['plain'], ['tiger', 'calico', 'starry'], ['circuit', 'chrome'], ['crystal', 'galaxy', 'ghost'], ['gold', 'rainbow']]);
    const own = new Set([...CORES, ...[CFG.sqkAddress, CFG.faucetAddress, V2A, V3A].map((a) => a.toLowerCase())]);
    assert.deepEqual(leakHits(t, own), []);
    assert.ok(leakHits(t, new Set([...CORES, CFG.sqkAddress, CFG.faucetAddress, V2A])).some((h) => h.includes(V3A)), 'the gate would stop an address it does not know');
    const vis = t.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<script>[\s\S]*?<\/script>/g, '');
    const first = vis.slice(vis.indexOf('<section class="card play"'), vis.indexOf('<section class="soon"'));
    // no season words (owner 11-07); How it works's three sentences + the one-line odds table
    assert.ok(!/season/i.test(vis.replace(/<[^>]+>/g, ' ')), 'no season words anywhere in the markup');
    const how = vis.slice(vis.indexOf('<div class="s2how" id="s2how" hidden>'), vis.indexOf('<details class="card more" id="check">'));
    assert.equal((how.match(/<li>/g) || []).length, 3, 'three sentences');
    assert.match(how, /<tr><td>Chance<\/td><td>64 in 100<\/td><td>23 in 100<\/td><td>7 in 100<\/td><td>6 in 100<\/td><td>~1 in 260<\/td><\/tr>/, 'the one-line odds table');
    assert.ok(!/hatch/i.test(how) && !/qubit/i.test(how));
    assert.match(vis, /<li id="recipe7" hidden>Each trait slot k = 1 to 10 .*keccak256 of \(the night, the seed, the token id, k\)/, 'the 7th recipe line');
  } finally { b.done(); }
  // the switch also works with catchAddress moved to the v3 address; anything else is refused before a byte is written
  const c = s2Build([], { season2Address: V3A, catchAddress: V3A }); try { assert.equal(c.r.status, 0, c.r.stderr); } finally { c.done(); }
  for (const [cfg, why] of [[{ season2Address: V3A, season1Address: null }, /needs season1Address/], [{ season2Address: V2A }, /is a Season 1 contract/],
    [{ season2Address: V3A, catchAddress: '0x' + '12'.repeat(20) }, /neither season1Address nor season2Address/], [{ season1Address: '0x' + '12'.repeat(20) }, /season1Address must be the Season 1 contract/],
    [{ season2Address: '0x1234' }, /season2Address must be an address or null/]]) {
    const x = s2Build([], cfg);
    try { assert.notEqual(x.r.status, 0, JSON.stringify(cfg)); assert.match(x.r.stderr, why); assert.ok(!fs.existsSync(x.out), 'nothing written'); } finally { x.done(); }
  }
});

// the door's fuel (owner 11-07): the deck's line and How it works' step; the total burned so far is COMPLETE or absent: the real
// build counts every NetPaid since the deploys (data/burned.json, incremental), a test build never reads the chain, QC_BURNED
// injects a fixed value
test('the fuel: the deck line, the build\'s burned total (complete or none), QC_BURNED for tests; My hamsters under the prizes', () => {
  assert.ok(text.includes('<p class="burn" id="burn" hidden>🔥 The door eats <span class="ncost">0.01</span> test SQK<span class="pn"> per net</span><span id="burnt" hidden> · <span class="bsum">0</span> burned so far</span></p>'), 'the deck line (hidden until a state where you can cast or your net is in)');
  const B = DATA_.burned;
  assert.ok(B === null || (/^\d+$/.test(B.wei) && Number.isInteger(B.asOfBlock) && BigInt(B.wei) % 10n ** 16n === 0n), `DATA.burned: null or a whole number of nets (${JSON.stringify(B)})`);
  if (B && fs.existsSync(path.join(ROOT, 'data/burned.json'))) {
    const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/burned.json'), 'utf8'));
    assert.equal(String(Object.values(c.games).reduce((a, g) => a + BigInt(g.wei), 0n)), B.wei, 'the page\'s total = the cache\'s sum');
    for (const [a, g] of Object.entries(c.games)) assert.ok(g.toBlock >= g.deployBlock && BigInt(g.wei) === BigInt(g.nets) * 10n ** 16n, `${a}: counted from its deploy block, 0.01 a net`);
  }
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'qc-burn-')), out = path.join(dir, 'b.html');
  const D = (env) => { execFileSync('python3', [path.join(ROOT, 'wheel/build.py'), '--out', out], { encoding: 'utf8', env: { ...process.env, ...env } });
    return JSON.parse(fs.readFileSync(out, 'utf8').match(/const DATA = (\{.*?\});\n/s)[1]).burned; };
  try {
    assert.deepEqual(D({ QC_BURNED: '1.37@12090000' }), { wei: '1370000000000000000', asOfBlock: 12090000 }, 'a fixed value for tests');
    assert.equal(D({ QC_BURNED: 'none' }), null);
    const env = { ...process.env }; delete env.QC_BURNED;
    execFileSync('python3', [path.join(ROOT, 'wheel/build.py'), '--out', out], { encoding: 'utf8', env });
    assert.equal(JSON.parse(fs.readFileSync(out, 'utf8').match(/const DATA = (\{.*?\});\n/s)[1]).burned, null, 'a test build (--out) never reads the chain');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  // My hamsters: the window between the first screen and the battles band, hidden until a connected wallet has a net
  const g = text.indexOf('<section class="myham" id="myham" hidden aria-labelledby="myhamh"><h2 class="mhh" id="myhamh">My hamsters</h2>');
  assert.ok(g > text.indexOf('id="prizes"') && g < text.indexOf('<section class="soon"'), 'under the prizes, above the battles band');
  assert.match(text, /<button class="navl" id="mycount" type="button"><span class="navt">My hamsters<\/span><svg class="myshort"/, 'the header button: My hamsters (an icon on phones)');
});

// the story band (owner 11-07: "some kind of lore on the first site"): under the prizes, before My hamsters and the battles
// band; 4 painted panels with ONE sentence each, then the line that leads into the battles
test('the story band: How Squeektoshi opened the door, 5 panels + one sentence each, its art in the page (lazy, by JS)', () => {
  const at = text.indexOf('<section class="lore" id="lore" aria-labelledby="loreh">');
  assert.ok(at > text.indexOf('id="prizes"') && at < text.indexOf('<section class="myham"') && at < text.indexOf('<section class="soon"'), 'under the prizes, above My hamsters and the battles band');
  const band = text.slice(at, text.indexOf('</section>', at));
  assert.match(band, /<h2 class="mhh" id="loreh">How Squeektoshi opened the door<\/h2>/);
  assert.deepEqual([...band.matchAll(/<figcaption>([^<]+)<\/figcaption>/g)].map((m) => m[1]), [
    'Squeektoshi is a real hamster. Every night he runs his wheel, and Squeekchain writes down every turn.',
    'One night he ran so fast that his turns reached a real IBM quantum computer. The chip opened a door.',
    'Behind it: other universes. Tigers in the Wild Worlds, chrome in the Machine Worlds, ghosts in the Dream Worlds, and far away, the Golden World.',
    'Now every night he runs, the door opens again. At 13:00 the quantum computer shakes it, hamsters tumble through, and your net catches one.',
    "Why wait until 13:00? While he runs, every turn adds to the door's map. When his night ends, the quantum computer shakes it. Until then your hamster is in every universe at once."]);
  assert.ok(band.includes('<p class="lnext">Some say the door is getting wider. Some say the hamsters on the other side are getting ready to fight…</p>'));
  assert.equal((band.match(/<img [^>]*data-k="panel-\d"/g) || []).length, 5, 'five pictures, loaded by JS');
  assert.ok(!/<img [^>]*\bsrc=/.test(band), 'no picture in the markup: lazy');
  const L = JSON.parse(fs.readFileSync(path.join(ROOT, 'wheel/art/lore.json'), 'utf8'));
  for (const [k, v] of Object.entries(L)) { assert.ok(html.includes(v.data.slice(0, 200)), `${k} in the page`); assert.deepEqual([v.w, v.h], [900, 672]); }
});
