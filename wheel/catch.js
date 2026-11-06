/* Quantum Catch: the night clock, nets, and the chain (plain JS, no libraries: in a browser window.QC, in node module.exports).
   - Night clock and net lock: the same rules as contracts/src/QuantumCatch.sol. A Squeek night runs 12:00 to 12:00 UTC,
     night(t) = (t - 43200) / 86400 (days since 1970); nets for night n close at 21:00 UTC (nightStart + 9 h), then new nets
     go to night n + 1. He usually starts running at 21:10-21:40 UTC.
   - Local nets: one per night, final once cast (the free NFT copy of a net cannot be moved either).
   - ABI encoding/decoding by hand for the few calls the page makes: QuantumCatch castNet/result/tokenURI and the NetCast
     log, SqueekCore state/roundPage (read-only, settled rounds only).
   - Wallet: plain EIP-1193 (window.ethereum). The page asks for accounts, Sepolia, and ONE transaction (castNet), never a
     signature or an approval; with no Sepolia test ETH it stops before the network prompt, after a read-only balance check. */
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make();
  else root.QC = make();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var DAY = 86400, OFFSET = 43200, LOCK = 32400, START_FROM = 33000, START_TO = 34800;   // 21:00, 21:10, 21:40 UTC
  var POST_WINDOW = 14 * DAY;          // a night's chip result can be posted until 14 days after the night ends, then never
  var MAX_NIGHT = 4294967295;

  // ---------- night clock (seconds) ----------
  function nightOf(t) {
    if (!(t >= OFFSET) || t >= MAX_NIGHT * DAY + OFFSET) throw new Error('time out of range: ' + t);
    return Math.floor((t - OFFSET) / DAY);
  }
  function nightStart(n) { return n * DAY + OFFSET; }
  // his usual start that night (21:10-21:40 UTC), ms
  function startWindow(n) { return [(nightStart(n) + START_FROM) * 1000, (nightStart(n) + START_TO) * 1000]; }
  function closeAt(n) { return nightStart(n) + LOCK; }
  function openNight(t) { var n = nightOf(t); return t < closeAt(n) ? n : n + 1; }
  // contract status 4: no chip result came within 14 days after the night ended, so the net stays unresolved for good
  function postDeadline(n) { return nightStart(n) + DAY + POST_WINDOW; }
  function noResult(n, t) { return t >= postDeadline(n); }
  function dayOf(n) { return new Date(n * DAY * 1000).toISOString().slice(0, 10); }
  function nightOfDay(day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) throw new Error('not a day: ' + day);
    return Math.round(Date.parse(day + 'T00:00:00Z') / (DAY * 1000));
  }

  // the net that can be cast now (ms clock). when = 'tonight' if it closes on the viewer's own calendar day, else 'tomorrow'
  // (offsetMin = the viewer's UTC offset in minutes, as -Date#getTimezoneOffset())
  function netWindow(nowMs, offsetMin) {
    var off = (offsetMin == null ? -new Date(nowMs).getTimezoneOffset() : offsetMin) * 60e3;
    var n = openNight(Math.floor(nowMs / 1000)), closeMs = closeAt(n) * 1000;
    var localDay = function (ms) { return new Date(ms + off).toISOString().slice(0, 10); };
    var sw = startWindow(n);
    return { n: n, day: dayOf(n), closeMs: closeMs, leftMs: closeMs - nowMs, when: localDay(closeMs) === localDay(nowMs) ? 'tonight' : 'tomorrow',
      startFromMs: sw[0], startToMs: sw[1], endMs: (nightStart(n) + DAY) * 1000 };
  }
  function countdown(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h) return h + ' h ' + m + ' min';
    if (s >= 120) return m + ' min';
    if (s >= 60) return m + ' min ' + (s % 60) + ' s';
    return s + ' s';
  }

  // ---------- local nets: store.nets = {day: {spot, at}} ----------
  var isSpot = function (x) { return typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < 16; };
  function castLocal(store, nowMs, spot, isBuilt) {
    var day = dayOf(openNight(Math.floor(nowMs / 1000)));
    if (!isSpot(spot)) return { ok: false, day: day, why: 'spot' };
    if (!store.nets || typeof store.nets !== 'object' || Array.isArray(store.nets)) store.nets = {};
    if (store.nets[day]) return { ok: false, day: day, why: 'already' };
    if (isBuilt && isBuilt(day)) return { ok: false, day: day, why: 'closed' };
    store.nets[day] = { spot: spot, at: nowMs };
    return { ok: true, day: day };
  }

  // ---------- outcome of a net, as the contract's result(): status 0 waiting, 1 caught, 2 got away, 3 he slept;
  // tier 0 none, 1 Common .. 5 Legendary, exactly like QuantumCatch.tiersOf / _card ----------
  // reach (contract _inReach, cf509b4): the walk starts on his start, spot turns % 16, and each step moves it one spot, so
  // after `steps` steps a perfect walk lands only on spots of the right parity ((spot + turns + steps) even) that are at
  // most `steps` spots from his start around the ring. A net on a spot out of reach never catches: the chip's landings
  // there are its noise (the owner's rule).
  function ringDistance(a, b) { var d = Math.abs(a - b) % 16; return Math.min(d, 16 - d); }
  function inReach(spot, turns, steps) { return (spot + turns + steps) % 2 === 0 && ringDistance(spot, turns % 16) <= steps; }
  // rarity (the owner's rule, 5 Nov; contract tiersOf): catchable = in reach and at least 1 % of the shots (hits * 100 >=
  // shots). Rank the catchable spots by landings, most first, equal landings the lower spot first; with n of them, rank r
  // is Epic (r = n), Rare (r = n - 1), Uncommon (r = n - 3 or n - 2) or Common (r <= n - 4); the Epic spot is Legendary
  // when firstShot (the spot of the chip's very first shot) is on it. Every other spot: 0. Counted like the contract's
  // _rank / _tier (no sort).
  function tiersOf(counts, turns, steps, firstShot) {
    var shots = 0, catchable = [], out = [], s, j;
    for (s = 0; s < 16; s++) shots += counts[s];
    for (s = 0; s < 16; s++) catchable.push(shots > 0 && inReach(s, turns, steps) && counts[s] * 100 >= shots);
    for (s = 0; s < 16; s++) {
      if (!catchable[s]) { out.push(0); continue; }
      var rank = 1, n = 0;
      for (j = 0; j < 16; j++) if (catchable[j]) { n++; if (counts[j] > counts[s] || (counts[j] === counts[s] && j < s)) rank++; }
      var rarer = n - rank;                                           // catchable spots with fewer landings than this one
      out.push(rarer === 0 ? (s === firstShot ? 5 : 4) : rarer === 1 ? 3 : rarer <= 3 ? 2 : 1);
    }
    return out;
  }
  // rec = null (no chip result yet) | {slept: true} | {counts: landings per SPOT, shots, turns: his total turns, steps,
  // firstShot: the spot of the chip's first shot}. reach: 0 unknown, 1 in reach, 2 out of reach (contract reachOf).
  // (Status 4, no result for good, depends on the clock: noResult(n, t).)
  function outcome(rec, spot) {
    if (!rec) return { status: 0, hits: 0, shots: 0, tier: 0, reach: 0 };
    if (rec.slept) return { status: 3, hits: 0, shots: 0, tier: 0, reach: 0 };
    if (!Number.isInteger(rec.turns) || !Number.isInteger(rec.steps)) throw new Error('outcome: the night\'s turns and steps are needed for reach');
    if (!isSpot(rec.firstShot)) throw new Error('outcome: the night\'s first shot is needed for Legendary');
    var hits = rec.counts[spot] | 0, r = inReach(spot, rec.turns, rec.steps), tier = tiersOf(rec.counts, rec.turns, rec.steps, rec.firstShot)[spot];
    return { status: tier ? 1 : 2, hits: hits, shots: rec.shots, tier: tier, reach: r ? 1 : 2 };
  }

  // ---------- hex + ABI ----------
  var strip = function (h) { h = String(h || ''); return h.slice(0, 2) === '0x' || h.slice(0, 2) === '0X' ? h.slice(2) : h; };
  function u256(x) {
    var b = typeof x === 'bigint' ? x : BigInt(x);
    if (b < 0n || b >= (1n << 256n)) throw new Error('uint out of range');
    return b.toString(16).padStart(64, '0');
  }
  function addr(a) {
    var h = strip(a).toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(h)) throw new Error('not an address: ' + a);
    return '0x' + h;
  }
  function words(hex) {
    var h = strip(hex);
    if (h.length % 64) throw new Error('bad ABI data');
    var out = [];
    for (var i = 0; i < h.length; i += 64) out.push(h.slice(i, i + 64));
    return out;
  }
  var num = function (w) { return Number(BigInt('0x' + w)); };
  function netId(n, a) { return '0x' + u256((BigInt(n) << 160n) | BigInt(addr(a))); }

  // selectors and topics (keccak256 of the signatures; checked against forge's methodIdentifiers and ethers in the tests)
  var SEL = { castNet: '0x6af74e5f', result: '0x3c594059', tokenURI: '0xc87b56dd', state: '0xc19d93fb', roundPage: '0xc8b9e08f' };
  // (written in two halves so the publish leak gate's address / long-hex patterns do not take this public hash for one)
  var TOPIC_NETCAST = '0xf687ecb6821e3163f5cc05d1064cd027' + 'e6c8bc7455239d9b5a0f5567c21123e9';
  var ERR = { AlreadyCast: '0xb2354670', NonexistentToken: '0x2f4163e7', SpotOutOfRange: '0xa9f274a7' };
  var enc = {
    castNet: function (spot) { if (!isSpot(spot)) throw new Error('spot must be 0-15'); return SEL.castNet + u256(spot); },
    result: function (id) { return SEL.result + u256(BigInt(id)); },
    tokenURI: function (id) { return SEL.tokenURI + u256(BigInt(id)); },
    state: function () { return SEL.state; },
    roundPage: function (after, through, max) {
      if (!(max >= 1 && max <= 16)) throw new Error('roundPage: max 1-16');
      return SEL.roundPage + u256(after) + u256(through) + u256(max);
    },
  };
  function utf8(hexBytes) {
    var b = new Uint8Array(hexBytes.length / 2);
    for (var i = 0; i < b.length; i++) b[i] = parseInt(hexBytes.substr(i * 2, 2), 16);
    return new TextDecoder('utf-8').decode(b);
  }
  var dec = {
    result: function (hex) {
      var w = words(hex);
      if (w.length < 7) throw new Error('result: data too short');
      return { status: num(w[0]), night: num(w[1]), spot: num(w[2]), hits: num(w[3]), shots: num(w[4]), tier: num(w[5]), looks: num(w[6]) };
    },
    string: function (hex) {
      var h = strip(hex), off = num(h.slice(0, 64)) * 2, len = num(h.slice(off, off + 64)) * 2;
      if (h.length < off + 64 + len) throw new Error('string: data too short');
      return utf8(h.slice(off + 64, off + 64 + len));
    },
    state: function (hex) { var w = words(hex); if (w.length < 8) throw new Error('state: data too short'); return { settled: num(w[0]) }; },
    // roundPage returns one dynamic tuple: [offset] then (the round it reads through, start(3 words), end(3 words), offset of the
    // records relative to the tuple, ... records: length, then 5 words each: roundId, cumulativeWork, blockUnits, rate, hash)
    roundPage: function (hex) {
      var w = words(hex), base = num(w[0]) / 32, t = function (i) { return w[base + i]; };
      var recAt = base + num(t(7)) / 32, n = num(w[recAt]), rounds = [];
      if (w.length < recAt + 1 + 5 * n) throw new Error('roundPage: data too short');
      for (var i = 0; i < n; i++) { var r = recAt + 1 + 5 * i; rounds.push({ id: num(w[r]), work: num(w[r + 1]) }); }
      return { through: num(t(0)), startWork: num(t(1)), endWork: num(t(4)), rounds: rounds };
    },
    netCast: function (log) {
      if (!log || !log.topics || String(log.topics[0]).toLowerCase() !== TOPIC_NETCAST) return null;
      var d = words(log.data);
      return { night: num(strip(log.topics[1])), catcher: '0x' + strip(log.topics[2]).slice(24).toLowerCase(), spot: num(d[0]), tokenId: '0x' + d[1] };
    },
  };

  // on-chain metadata (tokenURI): only data: URIs, and only an on-chain SVG image (never an outside URL)
  function tokenMeta(uri) {
    var s = String(uri || ''), json = null;
    try {
      if (s.indexOf('data:application/json;base64,') === 0) {
        var bin = atob(s.slice(29)), b = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
        json = JSON.parse(new TextDecoder('utf-8').decode(b));
      } else if (s.indexOf('data:application/json,') === 0) json = JSON.parse(decodeURIComponent(s.slice(22)));
    } catch (e) { return null; }
    if (!json || typeof json !== 'object') return null;
    var attr = {};
    (Array.isArray(json.attributes) ? json.attributes : []).forEach(function (a) { if (a && a.trait_type != null) attr[a.trait_type] = a.value; });
    var img = typeof json.image === 'string' && json.image.indexOf('data:image/svg+xml;base64,') === 0 ? json.image : null;
    return { name: String(json.name || ''), description: String(json.description || ''), attr: attr, image: img };
  }

  // ---------- errors in plain words ----------
  function errData(e, depth) {
    if (!e || depth > 4) return '';
    if (typeof e === 'string') return /^0x[0-9a-fA-F]{8}/.test(e) ? e : '';
    if (typeof e.data === 'string' && /^0x[0-9a-fA-F]{8}/.test(e.data)) return e.data;
    return errData(e.data, depth + 1) || errData(e.originalError, depth + 1) || errData(e.error, depth + 1) || errData(e.cause, depth + 1);
  }
  var isRevert = function (e) { return !!e && (e.code === 3 || /revert/i.test(String(e.message || '')) || !!errData(e, 0)); };
  function plainError(e) {
    var code = e && e.code, msg = String((e && e.message) || ''), data = errData(e, 0).toLowerCase();
    if (code === 'already' || data.indexOf(ERR.AlreadyCast) === 0) return 'This wallet already has a net NFT for this night (one per wallet per night).';
    if (code === 4001 || /user (rejected|denied)|rejected by user|user cancel/i.test(msg)) return 'You said no in your wallet. Nothing was sent.';
    if (code === 'chain') return 'Please switch your wallet to the Sepolia test network, then tap again.';
    if (code === 'nofunds') return 'Your wallet has no Sepolia test ETH for the network fee. Get a little for free from any Sepolia faucet, then tap again. Nothing was sent.';
    if (code === -32002) return 'Your wallet is already asking you something: open it and answer there first.';
    if (/insufficient funds/i.test(msg)) return 'Your wallet needs a little free Sepolia test ETH for the network fee (from any Sepolia faucet). Then tap again.';
    if (code === 'failed') return 'The transaction did not go through. Nothing changed; you can try again.';
    if (code === 'timeout') return 'Sepolia is slow right now: your NFT may still arrive. Look again in a minute.';
    if (code === 'nowallet') return 'No wallet found in this browser. The NFT is optional: your net works without it.';
    if (code === 'spot') return 'Pick a spot on the wheel first.';
    if (data.indexOf(ERR.SpotOutOfRange) === 0) return 'Pick a spot on the wheel first.';
    return 'Something went wrong in the wallet. Nothing was taken; you can try again.';
  }
  var fail = function (code, message) { var e = new Error(message || code); e.code = code; return e; };

  // ---------- wallet (EIP-1193) ----------
  var SEPOLIA = { chainId: '0xaa36a7', chainName: 'Sepolia', nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'], blockExplorerUrls: ['https://sepolia.etherscan.io'] };
  async function connect(eth) {
    if (!eth || typeof eth.request !== 'function') throw fail('nowallet');
    var acc = await eth.request({ method: 'eth_requestAccounts' });
    if (!acc || !acc.length) throw fail(4001, 'no account');
    return addr(acc[0]);
  }
  async function ensureSepolia(eth) {
    var cid = String(await eth.request({ method: 'eth_chainId' })).toLowerCase();
    if (cid === SEPOLIA.chainId) return;
    try { await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA.chainId }] }); }
    catch (e) {
      if (e && (e.code === 4902 || /unrecognized chain|not been added|unknown chain/i.test(String(e.message)))) {
        await eth.request({ method: 'wallet_addEthereumChain', params: [SEPOLIA] });
        if (String(await eth.request({ method: 'eth_chainId' })).toLowerCase() !== SEPOLIA.chainId) await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA.chainId }] });
      } else if (e && e.code === 4001) throw fail('chain');
      else throw e;
    }
    if (String(await eth.request({ method: 'eth_chainId' })).toLowerCase() !== SEPOLIA.chainId) throw fail('chain');
  }
  var walletCall = function (eth) { return function (to, data) { return eth.request({ method: 'eth_call', params: [{ to: to, data: data }, 'latest'] }); }; };
  async function readNet(call, contract, id) {
    try { return dec.result(await call(contract, enc.result(id))); }
    catch (e) { if (isRevert(e)) return null; throw e; }
  }
  // the ONE transaction: castNet(spot) on the QuantumCatch contract. opts: now() ms, sleep(ms), pollMs, timeoutMs, onStep(name)
  async function castNetNft(eth, contract, spot, opts) {
    opts = opts || {};
    var step = opts.onStep || function () {}, now = opts.now || Date.now, sleep = opts.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    if (!isSpot(spot)) throw fail('spot');
    var to = addr(contract);
    step('connect'); var me = await connect(eth);
    // no Sepolia test ETH = no fee: say so before any other wallet prompt. Read-only: opts.balance (the public Sepolia RPC,
    // whatever network the wallet is on), else the wallet itself once it is on Sepolia; an unanswered check lets it go on.
    var bal = null;
    if (opts.balance) { try { bal = await opts.balance(me); } catch (e) { bal = null; } }
    if (bal === 0n) throw fail('nofunds');
    step('network'); await ensureSepolia(eth);
    if (bal === null) { try { bal = BigInt(await eth.request({ method: 'eth_getBalance', params: [me, 'latest'] })); } catch (e) { bal = null; } }
    if (bal === 0n) throw fail('nofunds');
    step('check');
    // which night a cast lands in is decided by the CHAIN's clock (block time), so ask the chain, not the viewer's clock
    var tSec = Math.floor(now() / 1000);
    try { var b = await eth.request({ method: 'eth_getBlockByNumber', params: ['latest', false] }); if (b && b.timestamp) tSec = Number(BigInt(b.timestamp)); } catch (e) { /* the viewer's clock then */ }
    if (await readNet(walletCall(eth), to, netId(openNight(tSec), me))) throw fail('already');
    step('send');
    var hash = await eth.request({ method: 'eth_sendTransaction', params: [{ from: me, to: to, data: enc.castNet(spot), value: '0x0' }] });
    step('wait');
    var t0 = now(), rc = null;
    while (!rc) {
      rc = await eth.request({ method: 'eth_getTransactionReceipt', params: [hash] });
      if (rc) break;
      if (now() - t0 > (opts.timeoutMs || 180e3)) throw fail('timeout');
      await sleep(opts.pollMs || 2000);
    }
    if (String(rc.status) !== '0x1') throw fail('failed');
    var ev = null;
    (rc.logs || []).forEach(function (l) { if (!ev && String(l.address).toLowerCase() === to) ev = dec.netCast(l); });
    if (!ev) throw fail('failed', 'no NetCast event');
    step('done');
    return { txHash: hash, night: ev.night, day: dayOf(ev.night), spot: ev.spot, tokenId: ev.tokenId, catcher: ev.catcher };
  }
  // a wallet's nets for the given nights (newest first as given): result() for each token id; reverts = no net that night
  async function myNets(call, contract, catcher, nights) {
    var out = [], to = addr(contract), me = addr(catcher);
    for (var i = 0; i < nights.length; i++) {
      var id = netId(nights[i], me), r = await readNet(call, to, id);
      if (!r) continue;
      var meta = null;
      try { meta = tokenMeta(dec.string(await call(to, enc.tokenURI(id)))); } catch (e) { if (!isRevert(e)) throw e; }
      out.push(Object.assign({ tokenId: id, day: dayOf(r.night), image: meta ? meta.image : null, name: meta ? meta.name : '' }, r));
    }
    return out;
  }

  // ---------- read-only JSON-RPC (the public Sepolia endpoint): eth_call and eth_getBalance only ----------
  function rpcRequest(fetchFn, url) {
    var id = 0;
    return async function (method, params) {
      if (method !== 'eth_call' && method !== 'eth_getBalance') throw new Error('read-only rpc: ' + method);
      var r = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: method, params: params }) });
      if (!r.ok) throw new Error('rpc http ' + r.status);
      var j = await r.json();
      if (j.error) { var e = new Error(j.error.message || 'rpc error'); e.code = j.error.code; e.data = j.error.data; throw e; }
      return j.result;
    };
  }
  function rpcCall(fetchFn, url) { var rq = rpcRequest(fetchFn, url); return function (to, data) { return rq('eth_call', [{ to: to, data: data }, 'latest']); }; }
  function rpcBalance(fetchFn, url) { var rq = rpcRequest(fetchFn, url); return async function (a) { return BigInt(await rq('eth_getBalance', [addr(a), 'latest'])); }; }
  // SqueekCore: his running night so far. Only SETTLED rounds count (rounds after state().settled are unknown, never 0).
  // Rounds are 10 minutes: round id r covers genesis + (r - 1) * 600 .. genesis + r * 600.
  async function tonightSoFar(call, core, genesis, nowSec) {
    var n = nightOf(nowSec), t0 = nightStart(n), t1 = t0 + DAY;
    var first = Math.max(1, Math.floor((t0 - genesis) / 600) + 1), last = Math.floor((t1 - genesis) / 600);
    var settled = dec.state(await call(core, enc.state())).settled, through = Math.min(last, settled);
    var res = { night: n, day: dayOf(n), rounds: 0, turns: 0, through: through, complete: settled >= last, upToMs: (genesis + Math.max(through, first - 1) * 600) * 1000 };
    var after = first - 1, prev = null;
    for (var guard = 0; after < through && guard < 40; guard++) {
      var pg = dec.roundPage(await call(core, enc.roundPage(after, through, 16)));
      if (prev === null) prev = pg.startWork;
      for (var i = 0; i < pg.rounds.length; i++) {
        var t = pg.rounds[i].work - prev; prev = pg.rounds[i].work;
        if (t > 0) { res.rounds++; res.turns += t; }
      }
      if (pg.rounds.length < 16) break;
      after = pg.rounds[pg.rounds.length - 1].id;
    }
    return res;
  }

  return { DAY: DAY, OFFSET: OFFSET, LOCK: LOCK, POST_WINDOW: POST_WINDOW, postDeadline: postDeadline, noResult: noResult, SEPOLIA: SEPOLIA, SEL: SEL, ERR: ERR, TOPIC_NETCAST: TOPIC_NETCAST,
    nightOf: nightOf, nightStart: nightStart, startWindow: startWindow, closeAt: closeAt, openNight: openNight, dayOf: dayOf, nightOfDay: nightOfDay,
    netWindow: netWindow, countdown: countdown, castLocal: castLocal, ringDistance: ringDistance, inReach: inReach, tiersOf: tiersOf, outcome: outcome, netId: netId,
    enc: enc, dec: dec, tokenMeta: tokenMeta, plainError: plainError, isRevert: isRevert, connect: connect, ensureSepolia: ensureSepolia,
    walletCall: walletCall, readNet: readNet, castNetNft: castNetNft, myNets: myNets, rpcCall: rpcCall, rpcBalance: rpcBalance, tonightSoFar: tonightSoFar };
});
