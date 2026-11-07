/* Quantum Catch: the night clock, nets, and the chain (plain JS, no libraries: in a browser window.QC, in node module.exports).
   - Night clock and net lock: the same rules as contracts/src/QuantumCatch.sol. A Squeek night runs 12:00 to 12:00 UTC,
     night(t) = (t - 43200) / 86400 (days since 1970); nets for night n close at 21:00 UTC (nightStart + 9 h), then new nets
     go to night n + 1. He usually starts running at 21:10-21:40 UTC.
   - Local nets: one per night, final once cast (the free NFT copy of a net cannot be moved either).
   - The NFT net (QuantumCatch v2, the owner's rule of 6 Nov: no picking): a net is a ticket for one of the chip's shots. The
     wallet casts it with NO spot; once the night's chip result is posted the contract draws the net's shot over all
     the night's landings (QuantumCatch.drawOf), and result() / readNet / myNets give the drawn spot and its tier (spot null
     until then). The live v1 contract (castNet(uint8 spot)) cannot be cast through this code: it stops with code 'config'.
   - Season 2 (QuantumCatchV3, the same cast and the same result()): once a night is posted it is SEALED by a later block's
     hash before anything is drawn (result() status 5 = drawing until then); a caught net has its raw draw (dnaOf: per
     trait slot the tier and landing its own drop hit) and its picture is the chain's own (tokenURI, read lazily: netMeta).
     The pictures may change until the owner calls lock() (lockedOf). myNets reads v3 and the Season 1 contract (v2).
   - ABI encoding/decoding by hand for the few calls the page makes: QuantumCatch castNet()/castNetWithPermit/result/tokenURI/
     NET_COST/SQK and the NetCast/NetPaid logs, the test SQK token (balanceOf/allowance/nonces/eip712Domain/name/approve), the
     SqkFaucet (claim/canClaim/remaining/DRIP/TOKEN and its Claimed log), SqueekCore state/roundPage (read-only, settled rounds
     only).
   - Wallet: plain EIP-1193 (window.ethereum). The page asks for accounts, Sepolia, and ONE transaction (castNet). When the
     contract charges for a net (NET_COST > 0: 0.01 Squeekchain TEST SQK, burned by the contract), the wallet also signs one
     EIP-2612 permit for exactly that amount (a signature, no transaction, no fee) and the one transaction is
     castNetWithPermit; with an allowance already in place it is plain castNet; only a wallet that cannot sign typed data
     gets a second transaction first: approve(contract, exactly the net's cost). Too little test SQK: it stops before any
     signature or transaction (code NO_SQK, the page offers the faucet). With no Sepolia test ETH it stops before the
     network prompt, after a read-only balance check. The faucet: one claim() transaction, once per wallet per net night
     (the night a net cast now goes to: it turns at 21:00 UTC). */
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
  function b32(x) {                                                   // a bytes32 argument (r, s of a signature)
    var h = strip(x).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(h)) throw new Error('not 32 bytes: ' + x);
    return h;
  }

  // selectors and topics (keccak256 of the signatures; checked against forge's methodIdentifiers and ethers in the tests)
  // QuantumCatch v2: castNet() (no spot), result(uint256), tokenURI(uint256); SqueekCore state(), roundPage(...)
  var SEL = { castNet: '0x0612a854', result: '0x3c594059', tokenURI: '0xc87b56dd', state: '0xc19d93fb', roundPage: '0xc8b9e08f',
    // QuantumCatch v2: castNetWithPermit(uint256,uint8,bytes32,bytes32), NET_COST(), SQK()
    castNetWithPermit: '0x266ab9cf', netCost: '0x8a45ab66', sqk: '0xf5c83edd',
    // the test SQK token (ERC-20 + EIP-2612 + EIP-5267): balanceOf, allowance, approve, nonces, eip712Domain, name
    balanceOf: '0x70a08231', allowance: '0xdd62ed3e', approve: '0x095ea7b3', nonces: '0x7ecebe00', eip712Domain: '0x84b0196e', name: '0x06fdde03',
    // SqkFaucet: claim(), canClaim(address), remaining(), DRIP(), TOKEN()
    claim: '0x4e71d92d', canClaim: '0xbf3506c1', remaining: '0x55234ec0', drip: '0xa437c45e', token: '0x82bfefc8',
    // Season 2 (QuantumCatchV3): dnaOf(uint256) (the raw draw of a net), locked() (true once its pictures are final),
    // traitsOf(uint256) (the S2 shape), sealOf(uint32) (the night's seal)
    dnaOf: '0x3e39d638', locked: '0xcf309012', traitsOf: '0x5efab6e4', sealOf: '0xd22a0c46' };
  var NO_SPOT = 255;                                                 // result().spot before the night's draw
  // result().status: 0 waiting, 1 caught, 2 got away, 3 he slept, 4 no chip result, and on QuantumCatchV3 (Season 2) also
  // 5 = DRAWING: the night is posted but not sealed yet (the draw waits for the next block's hash), spot NO_SPOT
  var DRAWING = 5, SLOTS = 10;
  var SLOT_NAMES = ['Face', 'Head', 'Eyes', 'Mouth', 'Neck', 'Hands', 'Back', 'Special', 'Aura', 'Background'];
  // (written in two halves so the publish leak gate's address / long-hex patterns do not take these public hashes for one)
  var TOPIC_NETCAST = '0x47da66d5fbdfcc6a510d1c24f7b43cac' + '0cb48668c47012e703f49818d22c157b';   // NetCast(uint32,address,uint256)
  var TOPIC_NETPAID = '0x100db5ea1f9223afdc01a632bcfeea16' + '5e5be9e69a705ff5a0f3602c4eb65ef0';   // NetPaid(uint32,address,uint256)
  var TOPIC_CLAIMED = '0xd8138f8a3f377c5259ca548e70e4c2de' + '94f129f5a11036a15b69513cba2b426a';   // Claimed(address,uint256)
  var ERR = { AlreadyCast: '0xb2354670', NonexistentToken: '0x2f4163e7',
    AlreadyClaimedTonight: '0x8c7044a7', FaucetEmpty: '0xc1336f85',                             // SqkFaucet
    InsufficientBalance: '0xe450d38c', InsufficientAllowance: '0xfb8f41b2' };                   // the token (OpenZeppelin 5 ERC20 errors)
  var enc = {
    castNet: function () { if (arguments.length) throw new Error('castNet takes no spot (the chip draws it)'); return SEL.castNet; },
    castNetWithPermit: function (deadline, v, r, s) {
      if (arguments.length !== 4) throw new Error('castNetWithPermit(deadline, v, r, s): no spot (the chip draws it)');
      if (v !== 27 && v !== 28) throw new Error('permit: v must be 27 or 28');
      return SEL.castNetWithPermit + u256(deadline) + u256(v) + b32(r) + b32(s);
    },
    netCost: function () { return SEL.netCost; },
    sqk: function () { return SEL.sqk; },
    balanceOf: function (a) { return SEL.balanceOf + u256(BigInt(addr(a))); },
    allowance: function (owner, spender) { return SEL.allowance + u256(BigInt(addr(owner))) + u256(BigInt(addr(spender))); },
    approve: function (spender, amount) { return SEL.approve + u256(BigInt(addr(spender))) + u256(amount); },
    nonces: function (a) { return SEL.nonces + u256(BigInt(addr(a))); },
    eip712Domain: function () { return SEL.eip712Domain; },
    name: function () { return SEL.name; },
    claim: function () { return SEL.claim; },
    canClaim: function (a) { return SEL.canClaim + u256(BigInt(addr(a))); },
    remaining: function () { return SEL.remaining; },
    drip: function () { return SEL.drip; },
    token: function () { return SEL.token; },
    result: function (id) { return SEL.result + u256(BigInt(id)); },
    dnaOf: function (id) { return SEL.dnaOf + u256(BigInt(id)); },
    locked: function () { return SEL.locked; },
    tokenURI: function (id) { return SEL.tokenURI + u256(BigInt(id)); },
    traitsOf: function (id) { return SEL.traitsOf + u256(BigInt(id)); },
    sealOf: function (n) { return SEL.sealOf + u256(n); },
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
    // Season 2 dnaOf(): one static struct, 45 words: status, tier, spot, shots, word, then per slot (Face, Head, Eyes, Mouth,
    // Neck, Hands, Back, Special, Aura, Background) 10 drawn tiers, 10 spots, 10 landings, 10 words. All 0 unless caught.
    dna: function (hex) {
      var w = words(hex);
      if (w.length < 45) throw new Error('dnaOf: data too short');
      var run = function (at, f) { var a = []; for (var k = 0; k < 10; k++) a.push(f(w[at + k])); return a; };
      var word = function (x) { return '0x' + x; };
      return { status: num(w[0]), tier: num(w[1]), spot: num(w[2]), shots: num(w[3]), word: word(w[4]),
        tiers: run(5, num), spots: run(15, num), landings: run(25, num), words: run(35, word) };
    },
    // result(): status 0 waiting, 1 caught, 2 got away, 3 he slept, 4 no chip result, 5 drawing (Season 2: posted, waiting
    // for the seal); spot = the spot of the net's drawn
    // shot, null until the night is posted (and when he slept / no result: NO_SPOT on chain); looks = the caught hamster's
    // 4 bits (0 unless caught)
    result: function (hex) {
      var w = words(hex);
      if (w.length < 7) throw new Error('result: data too short');
      var spot = num(w[2]);
      return { status: num(w[0]), night: num(w[1]), spot: spot === NO_SPOT ? null : spot, hits: num(w[3]), shots: num(w[4]), tier: num(w[5]), looks: num(w[6]) };
    },
    // QuantumCatchV3.traitsOf (the S2 shape): night, drawn, caught, spot, tier, skin, slots[10] (item ids from the renderer)
    traits: function (hex) {
      var w = words(hex);
      if (w.length < 16) throw new Error('traitsOf: data too short');
      var slots = []; for (var i = 0; i < SLOTS; i++) slots.push(num(w[6 + i]));
      return { night: num(w[0]), drawn: num(w[1]) === 1, caught: num(w[2]) === 1, spot: num(w[3]), tier: num(w[4]), skin: num(w[5]), slots: slots };
    },
    // QuantumCatchV3.sealOf(night): the post's block, the block whose hash sealed the draws (0 = not sealed yet), the seed
    seal: function (hex) {
      var w = words(hex);
      if (w.length < 3) throw new Error('sealOf: data too short');
      return { postBlock: num(w[0]), seedBlock: num(w[1]), seed: '0x' + w[2] };
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
    // NetCast(uint32 indexed night, address indexed catcher, uint256 tokenId): no spot (the night's result draws it)
    netCast: function (log) {
      if (!log || !log.topics || String(log.topics[0]).toLowerCase() !== TOPIC_NETCAST) return null;
      var d = words(log.data);
      if (d.length < 1) throw new Error('NetCast: data too short');
      return { night: num(strip(log.topics[1])), catcher: '0x' + strip(log.topics[2]).slice(24).toLowerCase(), tokenId: '0x' + d[0] };
    },
    // NetPaid(uint32 indexed night, address indexed catcher, uint256 burned): the test SQK the contract burned for a net
    netPaid: function (log) {
      if (!log || !log.topics || String(log.topics[0]).toLowerCase() !== TOPIC_NETPAID) return null;
      var d = words(log.data);
      return { night: num(strip(log.topics[1])), catcher: '0x' + strip(log.topics[2]).slice(24).toLowerCase(), burned: BigInt('0x' + d[0]) };
    },
    // Claimed(address indexed to, uint256 amount): the faucet's drip
    claimedLog: function (log) {
      if (!log || !log.topics || String(log.topics[0]).toLowerCase() !== TOPIC_CLAIMED) return null;
      var d = words(log.data);
      return { to: '0x' + strip(log.topics[1]).slice(24).toLowerCase(), amount: BigInt('0x' + d[0]) };
    },
    // one-word returns: uint256, address, bool (strict: anything else is an error, never a guess)
    uint: function (hex) { var w = words(hex); if (!w.length) throw new Error('uint: no data'); return BigInt('0x' + w[0]); },
    address: function (hex) {
      var w = words(hex);
      if (!w.length || !/^0{24}/.test(w[0])) throw new Error('address: not an address');
      return '0x' + w[0].slice(24);
    },
    bool: function (hex) { var v = dec.uint(hex); if (v > 1n) throw new Error('bool: not a bool'); return v === 1n; },
    // eip712Domain() (EIP-5267): (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract,
    // bytes32 salt, uint256[] extensions); fields bit 0 name, 1 version, 2 chainId, 3 verifyingContract, 4 salt
    eip712Domain: function (hex) {
      var h = strip(hex), w = words(h);
      if (w.length < 7) throw new Error('eip712Domain: data too short');
      var at = function (k) { var off = num(w[k]); if (off % 32 || off / 32 >= w.length) throw new Error('eip712Domain: bad offset'); return off / 32; };
      var str = function (k) {
        var i = at(k), len = num(w[i]);
        if (h.length < (i + 1) * 64 + len * 2) throw new Error('eip712Domain: data too short');
        return utf8(h.slice((i + 1) * 64, (i + 1) * 64 + len * 2));
      };
      return { fields: parseInt(w[0].slice(0, 2), 16), name: str(1), version: str(2), chainId: BigInt('0x' + w[3]),
        verifyingContract: '0x' + w[4].slice(24), salt: '0x' + w[5], extensions: num(w[at(6)]) };
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

  // token amounts in plain decimals: units(10n ** 16n) = '0.01' (18 decimals unless said), never rounded
  function units(x, decimals) {
    var d = decimals == null ? 18 : decimals, b = BigInt(x), neg = b < 0n;
    if (neg) b = -b;
    var s = b.toString().padStart(d + 1, '0'), i = s.slice(0, s.length - d), f = s.slice(s.length - d).replace(/0+$/, '');
    return (neg ? '-' : '') + i + (f ? '.' + f : '');
  }

  // ---------- errors in plain words ----------
  function errData(e, depth) {
    if (!e || depth > 4) return '';
    if (typeof e === 'string') return /^0x[0-9a-fA-F]{8}/.test(e) ? e : '';
    if (typeof e.data === 'string' && /^0x[0-9a-fA-F]{8}/.test(e.data)) return e.data;
    return errData(e.data, depth + 1) || errData(e.originalError, depth + 1) || errData(e.error, depth + 1) || errData(e.cause, depth + 1);
  }
  // a revert, also as wallets wrap it ({code: -32603, message: 'Internal JSON-RPC error.', data: {code: 3, message:
  // 'execution reverted', data: '0x'}}): the live v1 contract answers NET_COST() with an EMPTY revert, so the code / the
  // word must be found inside too, not only revert data
  function revertish(e, depth) {
    if (!e || typeof e !== 'object' || depth > 4) return false;
    if (e.code === 3 || /revert/i.test(String(e.message || ''))) return true;
    return revertish(e.data, depth + 1) || revertish(e.error, depth + 1) || revertish(e.originalError, depth + 1) || revertish(e.cause, depth + 1);
  }
  var isRevert = function (e) { return !!e && (revertish(e, 0) || !!errData(e, 0)); };
  function plainError(e) {
    var code = e && e.code, msg = String((e && e.message) || ''), data = errData(e, 0).toLowerCase(), what = e && e.what;
    if (code === 'already' || data.indexOf(ERR.AlreadyCast) === 0) return 'This wallet already has a net NFT for this night (one per wallet per night).';
    if (code === 'claimed' || data.indexOf(ERR.AlreadyClaimedTonight) === 0) return 'This wallet already got today\'s free test SQK from the faucet (one claim per wallet per night; the next one from 21:00 UTC). Nothing was sent.';
    if (code === 'empty' || data.indexOf(ERR.FaucetEmpty) === 0) return 'The test SQK faucet is empty right now. Nothing was sent; please try again later.';
    if (code === 4001 || /user (rejected|denied)|rejected by user|user cancel/i.test(msg)) return 'You said no in your wallet. Nothing was sent.';
    if (code === 'NO_SQK' || data.indexOf(ERR.InsufficientBalance) === 0) {
      var c = e && typeof e.cost === 'bigint' ? units(e.cost) + ' test SQK' : 'a little test SQK';
      return 'Casting a net costs ' + c + ' (it gets burned) and this wallet does not have enough. Get free test SQK from the faucet, then tap again. Nothing was sent.';
    }
    if (data.indexOf(ERR.InsufficientAllowance) === 0) return 'The test SQK for the net was not approved, so nothing was sent. You can try again.';
    if (code === 'config') return 'This page and its contract do not match (another test token, or the old pick-a-spot contract). Nothing was sent.';
    if (code === 'chain') return 'Please switch your wallet to the Sepolia test network, then tap again.';
    if (code === 'nofunds') return 'Your wallet has no Sepolia test ETH for the network fee. Get a little for free from any Sepolia faucet, then tap again. Nothing was sent.';
    if (code === -32002) return 'Your wallet is already asking you something: open it and answer there first.';
    if (/insufficient funds/i.test(msg)) return 'Your wallet needs a little free Sepolia test ETH for the network fee (from any Sepolia faucet). Then tap again.';
    if (code === 'failed') return 'The transaction did not go through. Nothing changed; you can try again.';
    if (code === 'timeout' && what === 'approve') return 'Sepolia is slow right now: your test SQK approval may still go through. Tap again in a minute.';
    if (code === 'timeout' && what === 'faucet') return 'Sepolia is slow right now: your test SQK may still arrive. Look again in a minute.';
    if (code === 'timeout') return 'Sepolia is slow right now: your NFT may still arrive. Look again in a minute.';
    if (code === 'nowallet') return 'No wallet found in this browser: casting a net needs a browser wallet on the Sepolia test network (the page still works for watching).';
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
  // a net's result() (null = no such net, or a burned one). opts.dna (v3 contracts only): a caught net also gets
  // .dna, its raw draw (dnaOf). Without opts the call is exactly v2's.
  async function readNet(call, contract, id, opts) {
    var r;
    try { r = dec.result(await call(contract, enc.result(id))); }
    catch (e) { if (isRevert(e)) return null; throw e; }
    if (opts && opts.dna && r.status === 1) r.dna = dec.dna(await call(contract, enc.dnaOf(id)));
    return r;
  }
  // locked() of QuantumCatchV3: true once its owner gave up the renderer for good (the pictures can never change again),
  // false while they still can; null = a contract without locked() (Season 1)
  async function lockedOf(call, contract) {
    try { return dec.bool(await call(addr(contract), enc.locked())); }
    catch (e) { if (isRevert(e)) return null; throw e; }
  }
  // a net's on-chain metadata (tokenURI, decoded: tokenMeta), the BIG read of Season 2 (a caught card is ~0.2-0.5 MB of
  // JSON-RPC answer, ~2M gas): tried on each call function in order (the page: its public read-only RPC first, the wallet's
  // provider only if that fails). null = no such net (NonexistentToken) or not on-chain JSON + SVG; any other failure
  // (a node's gas cap, RendererFailed, the network) goes on to the next source; every source failing = thrown
  async function netMeta(calls, contract, id) {
    var last = null, to = addr(contract);
    for (var i = 0; i < calls.length; i++) {
      if (!calls[i]) continue;
      try { return tokenMeta(dec.string(await calls[i](to, enc.tokenURI(id)))); }
      catch (e) { if (errData(e, 0).toLowerCase().indexOf(ERR.NonexistentToken) === 0) return null; last = e; }
    }
    throw last || new Error('netMeta: no way to read the chain');
  }
  // a transaction's receipt, polled; status 0x1 or the plain-word error. what = 'net' | 'approve' | 'faucet' (the timeout's words)
  async function waitReceipt(eth, hash, opts, what) {
    var now = opts.now || Date.now, sleep = opts.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var t0 = now(), rc = null, e;
    while (!rc) {
      rc = await eth.request({ method: 'eth_getTransactionReceipt', params: [hash] });
      if (rc) break;
      if (now() - t0 > (opts.timeoutMs || 180e3)) { e = fail('timeout'); e.what = what; e.txHash = hash; throw e; }
      await sleep(opts.pollMs || 2000);
    }
    if (String(rc.status) !== '0x1') { e = fail('failed'); e.what = what; e.txHash = hash; throw e; }
    return rc;
  }
  // connect, the Sepolia test ETH check (opts.balance = the public RPC, before any network prompt), Sepolia, the wallet's own
  // read-only balance check once it is on Sepolia (an unanswered check lets it go on)
  async function walletReady(eth, opts, step) {
    step('connect'); var me = await connect(eth);
    var bal = null;
    if (opts.balance) { try { bal = await opts.balance(me); } catch (e) { bal = null; } }
    if (bal === 0n) throw fail('nofunds');
    step('network'); await ensureSepolia(eth);
    if (bal === null) { try { bal = BigInt(await eth.request({ method: 'eth_getBalance', params: [me, 'latest'] })); } catch (e) { bal = null; } }
    if (bal === 0n) throw fail('nofunds');
    return me;
  }
  var sendTx = function (eth, from, to, data) { return eth.request({ method: 'eth_sendTransaction', params: [{ from: from, to: to, data: data, value: '0x0' }] }); };

  // ---------- the test SQK a net costs (QuantumCatch v2) ----------
  // NET_COST(): the live v1 contract has no NET_COST() and reverts, so its nets are free (and so is a v2 contract built
  // without SQK: NET_COST() = 0). A network error is NOT "free": it is thrown (castNet would go out unpaid and fail on chain).
  async function netCostOf(call, contract) {
    try { return dec.uint(await call(contract, enc.netCost())); }
    catch (e) { if (isRevert(e)) return 0n; throw e; }
  }
  var PERMIT_TTL = 3600;                                             // a permit is good for one hour of chain time
  var EIP712_FIELDS = [['name', 'string'], ['version', 'string'], ['chainId', 'uint256'], ['verifyingContract', 'address'], ['salt', 'bytes32']];
  var PERMIT_TYPE = [['owner', 'address'], ['spender', 'address'], ['value', 'uint256'], ['nonce', 'uint256'], ['deadline', 'uint256']];
  var typeList = function (l) { return l.map(function (x) { return { name: x[0], type: x[1] }; }); };
  // the token's EIP-712 domain: eip712Domain() (EIP-5267) when it has it, else name() + version "1" + chainId + the token.
  // null = no domain this code can build (EIP-5267 extensions or unknown fields): then the approve path
  async function tokenDomain(call, token, chainId) {
    var d = null, dom = {}, fields = [], i;
    try { d = dec.eip712Domain(await call(token, enc.eip712Domain())); } catch (e) { if (!isRevert(e)) throw e; }
    if (!d) d = { fields: 15, name: dec.string(await call(token, enc.name())), version: '1', chainId: BigInt(chainId), verifyingContract: token, salt: null, extensions: 0 };
    if (d.extensions || (d.fields & ~31)) return null;
    var val = { name: d.name, version: d.version, chainId: d.chainId <= 9007199254740991n ? Number(d.chainId) : d.chainId.toString(),
      verifyingContract: d.verifyingContract ? addr(d.verifyingContract) : null, salt: d.salt };
    for (i = 0; i < EIP712_FIELDS.length; i++) if (d.fields & (1 << i)) { fields.push(EIP712_FIELDS[i]); dom[EIP712_FIELDS[i][0]] = val[EIP712_FIELDS[i][0]]; }
    return { fields: fields, domain: dom };
  }
  // the EIP-2612 permit as eth_signTypedData_v4 typed data (uint256 values as decimal strings, chainId a number)
  function permitTypedData(dom, owner, spender, value, nonce, deadline) {
    return { types: { EIP712Domain: typeList(dom.fields), Permit: typeList(PERMIT_TYPE) }, primaryType: 'Permit', domain: Object.assign({}, dom.domain),
      message: { owner: addr(owner), spender: addr(spender), value: BigInt(value).toString(), nonce: BigInt(nonce).toString(), deadline: BigInt(deadline).toString() } };
  }
  // a 65-byte signature (v 27/28, or 0/1 from some wallets) or a 64-byte EIP-2098 one -> {v, r, s}
  function splitSig(sig) {
    var h = strip(sig).toLowerCase(), v, s;
    if (/^[0-9a-f]{130}$/.test(h)) { s = h.slice(64, 128); v = parseInt(h.slice(128), 16); if (v < 27) v += 27; }
    else if (/^[0-9a-f]{128}$/.test(h)) { var vs = BigInt('0x' + h.slice(64)); v = 27 + Number(vs >> 255n); s = u256(vs & ((1n << 255n) - 1n)); }
    else throw fail('sig', 'not a signature');
    if (v !== 27 && v !== 28) throw fail('sig', 'not a signature');
    return { v: v, r: '0x' + h.slice(0, 64), s: '0x' + s };
  }
  // the wallet cannot sign typed data at all (never a "no" from the person: that is 4001 and stays a no)
  var cannotSign = function (e) {
    return !!e && e.code !== 4001 && (e.code === 4200 || e.code === -32601 || e.code === -32004 ||
      /not supported|unsupported|method not found|does not exist|not available|not implemented/i.test(String(e.message || '')));
  };
  var noSqk = function (cost, balance, token) { var e = fail('NO_SQK', 'not enough test SQK for a net'); e.cost = cost; e.balance = balance; e.sqk = token; return e; };
  // pay for a net: returns the data of the ONE cast transaction (castNet with an allowance in place, else castNetWithPermit
  // with a fresh permit; a wallet that cannot sign typed data first sends approve(contract, exactly the cost))
  async function payForNet(eth, me, to, cost, tSec, opts, step) {
    var call = walletCall(eth);
    step('sqk-check');
    var token = dec.address(await call(to, enc.sqk()));
    if (BigInt(token) === 0n) throw fail('failed', 'NET_COST without SQK');
    if (opts.sqk && addr(opts.sqk) !== token) throw fail('config', 'the contract takes another token: ' + token);
    var bal = dec.uint(await call(token, enc.balanceOf(me)));
    if (bal < cost) throw noSqk(cost, bal, token);
    if (dec.uint(await call(token, enc.allowance(me, to))) >= cost) return enc.castNet();
    step('sqk-sign');
    var data = null;
    try {
      var cid = Number(BigInt(await eth.request({ method: 'eth_chainId' })));
      var dom = await tokenDomain(call, token, cid);
      if (dom) {
        var deadline = BigInt(tSec + PERMIT_TTL), nonce = dec.uint(await call(token, enc.nonces(me)));
        var sig = splitSig(await eth.request({ method: 'eth_signTypedData_v4', params: [me, JSON.stringify(permitTypedData(dom, me, to, cost, nonce, deadline))] }));
        data = enc.castNetWithPermit(deadline, sig.v, sig.r, sig.s);
      }
    } catch (e) { if (!cannotSign(e)) throw e; data = null; }
    if (data) {
      // the cast with this permit, simulated (no transaction): a token that did not take the signature shows up here as
      // an allowance revert (then the approve path); other reverts in plain words; an unanswered simulation lets it go on
      var sim = null;
      try { await eth.request({ method: 'eth_call', params: [{ from: me, to: to, data: data }, 'latest'] }); } catch (e) { sim = e; }
      if (!sim || !isRevert(sim)) return data;
      var rd = errData(sim, 0).toLowerCase();
      if (rd.indexOf(ERR.AlreadyCast) === 0) throw fail('already');
      if (rd.indexOf(ERR.InsufficientBalance) === 0) throw noSqk(cost, bal, token);
      if (rd.indexOf(ERR.InsufficientAllowance) !== 0) throw sim;
    }
    step('sqk-approve');
    await waitReceipt(eth, await sendTx(eth, me, token, enc.approve(to, cost)), opts, 'approve');
    return enc.castNet();
  }
  // NET_COST() of the v2 game the page casts on: a revert = not the v2 game (the live v1 contract has no NET_COST() and
  // takes a spot): code 'config', before anything is signed or sent. A network error is thrown as it is.
  async function v2CostOf(call, contract) {
    try { return dec.uint(await call(contract, enc.netCost())); }
    catch (e) { if (isRevert(e)) throw fail('config', 'not the v2 game: no NET_COST()'); throw e; }
  }
  // a transaction simulated from its sender right before it is sent (eth_call, no transaction): a revert this code can
  // name stops it with nothing sent (named(revertData) -> an error to throw, or null); a revert it cannot name is thrown
  // as it is (nothing sent) unless pass(revertData) lets it go on; no answer (not a revert) lets it go on, as before
  async function simulate(eth, me, to, data, named, pass) {
    var sim = null;
    try { await eth.request({ method: 'eth_call', params: [{ from: me, to: to, data: data }, 'latest'] }); } catch (e) { sim = e; }
    if (!sim || !isRevert(sim)) return;
    var rd = errData(sim, 0).toLowerCase(), e2 = named(rd);
    if (e2) throw e2;
    if (pass && pass(rd)) return;
    throw sim;
  }

  // the net NFT: castNet() on the QuantumCatch v2 contract (no spot: the night's chip result draws it), ONE cast
  // transaction (paid nets: see payForNet).
  // opts: now() ms, sleep(ms), pollMs, timeoutMs, onStep(name), balance(addr) (public RPC ETH check), sqk (the token the page
  // expects), netCost (what the page expects a net to cost, in wei: another NET_COST() = 'config', before anything is signed)
  // steps: connect, network, check, [sqk-check, sqk-sign, sqk-approve: paid nets only], send, wait, done
  // -> {txHash, night, day, tokenId, catcher} (the spot comes with the night's result: readNet / myNets)
  async function castNetNft(eth, contract, opts) {
    if (opts !== undefined && (opts === null || typeof opts !== 'object')) throw new Error('castNetNft(eth, contract, opts): no spot (the chip draws it)');
    opts = opts || {};
    var step = opts.onStep || function () {}, now = opts.now || Date.now;
    var to = addr(contract);
    var me = await walletReady(eth, opts, step);
    step('check');
    // which night a cast lands in is decided by the CHAIN's clock (block time), so ask the chain, not the viewer's clock
    var tSec = Math.floor(now() / 1000);
    try { var b = await eth.request({ method: 'eth_getBlockByNumber', params: ['latest', false] }); if (b && b.timestamp) tSec = Number(BigInt(b.timestamp)); } catch (e) { /* the viewer's clock then */ }
    var call = walletCall(eth);
    if (await readNet(call, to, netId(openNight(tSec), me))) throw fail('already');
    var cost = await v2CostOf(call, to);
    if (opts.netCost !== undefined && opts.netCost !== null && BigInt(opts.netCost) !== cost) throw fail('config', 'NET_COST() is ' + cost + ', the page expects ' + opts.netCost);
    var data = cost > 0n ? await payForNet(eth, me, to, cost, tSec, opts, step) : enc.castNet();
    // castNet() simulated right before it goes out (castNetWithPermit was simulated in payForNet): result() cannot see a
    // burned net, the cast can (AlreadyCast); an allowance revert right after our own approve (a node a block behind)
    // lets it go on
    if (data.indexOf(SEL.castNetWithPermit) !== 0) {
      await simulate(eth, me, to, data, function (rd) {
        if (rd.indexOf(ERR.AlreadyCast) === 0) return fail('already');
        if (rd.indexOf(ERR.InsufficientBalance) === 0) return noSqk(cost, null, null);
        return null;
      }, function (rd) { return rd.indexOf(ERR.InsufficientAllowance) === 0; });
    }
    step('send');
    var hash = await sendTx(eth, me, to, data);
    step('wait');
    var rc = await waitReceipt(eth, hash, opts, 'net');
    var ev = null;
    (rc.logs || []).forEach(function (l) { if (!ev && String(l.address).toLowerCase() === to) ev = dec.netCast(l); });
    if (!ev) throw fail('failed', 'no NetCast event');
    step('done');
    return { txHash: hash, night: ev.night, day: dayOf(ev.night), tokenId: ev.tokenId, catcher: ev.catcher };
  }

  // ---------- the test SQK faucet (SqkFaucet: DRIP once per address per net night) ----------
  // ONE transaction: claim(). Steps: connect, network, faucet, wait, done. Returns {txHash, to, amount}
  async function claimFaucet(eth, faucet, opts) {
    opts = opts || {};
    var step = opts.onStep || function () {}, to = addr(faucet);
    var me = await walletReady(eth, opts, step);
    step('faucet');
    var call = walletCall(eth);
    if (!dec.bool(await call(to, enc.canClaim(me)))) throw fail('claimed');           // already claimed this net night
    if (dec.uint(await call(to, enc.remaining())) < dec.uint(await call(to, enc.drip()))) throw fail('empty');
    await simulate(eth, me, to, enc.claim(), function (rd) {
      if (rd.indexOf(ERR.AlreadyClaimedTonight) === 0) return fail('claimed');
      if (rd.indexOf(ERR.FaucetEmpty) === 0) return fail('empty');
      return null;
    });
    var hash = await sendTx(eth, me, to, enc.claim());
    step('wait');
    var rc = await waitReceipt(eth, hash, opts, 'faucet'), ev = null;
    (rc.logs || []).forEach(function (l) { if (!ev && String(l.address).toLowerCase() === to) { var c = dec.claimedLog(l); if (c && c.to === me) ev = c; } });
    if (!ev) throw fail('failed', 'no Claimed event');
    step('done');
    return { txHash: hash, to: me, amount: ev.amount };
  }
  // read-only: what a net costs and what the wallet and the faucet hold. src = a call(to, data) function (QC.rpcCall on the
  // public Sepolia RPC, or QC.walletCall) or an EIP-1193 provider (then only while it is on Sepolia: else code 'chain', never
  // another network's numbers); faucet and who may be null. -> {cost, sqk, balance, faucetLeft, drip, claimed} (BigInt
  // amounts; sqk null = free nets; null = not asked; claimed = this wallet already claimed for the current net night).
  // A faucet for another token than the contract's is an error ('config').
  async function sqkInfo(src, contract, faucet, who) {
    if (typeof src !== 'function' && String(await src.request({ method: 'eth_chainId' })).toLowerCase() !== SEPOLIA.chainId) throw fail('chain');
    var call = typeof src === 'function' ? src : walletCall(src);
    var to = contract ? addr(contract) : null, f = faucet ? addr(faucet) : null, me = who ? addr(who) : null;
    var cost = to ? await netCostOf(call, to) : 0n, sqk = null;
    if (cost > 0n) { sqk = dec.address(await call(to, enc.sqk())); if (BigInt(sqk) === 0n) sqk = null; }
    var res = { cost: cost, sqk: sqk, balance: null, faucetLeft: null, drip: null, claimed: null };
    var jobs = [];
    if (sqk && me) jobs.push(call(sqk, enc.balanceOf(me)).then(function (h) { res.balance = dec.uint(h); }));
    if (f) {
      jobs.push(call(f, enc.token()).then(function (h) { var t = dec.address(h); if (sqk && t !== sqk) throw fail('config', 'the faucet hands out another token: ' + t); }));
      jobs.push(call(f, enc.remaining()).then(function (h) { res.faucetLeft = dec.uint(h); }));
      jobs.push(call(f, enc.drip()).then(function (h) { res.drip = dec.uint(h); }));
      if (me) jobs.push(call(f, enc.canClaim(me)).then(function (h) { res.claimed = !dec.bool(h); }));
    }
    await Promise.all(jobs);
    return res;
  }
  // a wallet's nets for the given nights (newest first as given): result() for each token id (spot = the drawn shot's spot,
  // null until the night is posted; tier); reverts = no net that night (or it was burned). Each net says its `contract`.
  // opts (Season 2, all optional): season1 = the Season 1 contract (QuantumCatch v2), read too, after `contract` (v3) for
  // each night: its nets come with season 1, the others with season 2 (the same wallet and night have the SAME token id
  // on both, so a night can have one of each); dna = read dnaOf() for caught nets of `contract`; images === false = no
  // tokenURI here (a caught Season 2 card is ~0.2-0.5 MB: the page reads each picture lazily, netMeta). Without opts:
  // exactly as before (v2: result() + tokenURI of each net, image/name from it).
  async function myNets(call, contract, catcher, nights, opts) {
    opts = opts || {};
    var out = [], me = addr(catcher), s1 = opts.season1 ? addr(opts.season1) : null;
    var games = [[addr(contract), s1 ? 2 : null]]; if (s1) games.push([s1, 1]);
    for (var i = 0; i < nights.length; i++) {
      var id = netId(nights[i], me);
      for (var g = 0; g < games.length; g++) {
        var to = games[g][0], r = await readNet(call, to, id, opts.dna && to !== s1 ? { dna: true } : undefined);
        if (!r) continue;
        var meta = null;
        if (opts.images !== false) { try { meta = tokenMeta(dec.string(await call(to, enc.tokenURI(id)))); } catch (e) { if (!isRevert(e)) throw e; } }
        out.push(Object.assign({ tokenId: id, day: dayOf(r.night), contract: to, image: meta ? meta.image : null, name: meta ? meta.name : '' },
          games[g][1] ? { season: games[g][1] } : {}, r));
      }
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

  return { DAY: DAY, OFFSET: OFFSET, LOCK: LOCK, POST_WINDOW: POST_WINDOW, postDeadline: postDeadline, noResult: noResult, SEPOLIA: SEPOLIA, SEL: SEL, ERR: ERR, NO_SPOT: NO_SPOT, TOPIC_NETCAST: TOPIC_NETCAST,
    DRAWING: DRAWING, SLOTS: SLOTS, SLOT_NAMES: SLOT_NAMES, lockedOf: lockedOf, netMeta: netMeta,
    TOPIC_NETPAID: TOPIC_NETPAID, TOPIC_CLAIMED: TOPIC_CLAIMED, PERMIT_TTL: PERMIT_TTL, units: units, netCostOf: netCostOf, tokenDomain: tokenDomain, permitTypedData: permitTypedData,
    splitSig: splitSig, claimFaucet: claimFaucet, sqkInfo: sqkInfo,
    nightOf: nightOf, nightStart: nightStart, startWindow: startWindow, closeAt: closeAt, openNight: openNight, dayOf: dayOf, nightOfDay: nightOfDay,
    netWindow: netWindow, countdown: countdown, castLocal: castLocal, ringDistance: ringDistance, inReach: inReach, tiersOf: tiersOf, outcome: outcome, netId: netId,
    enc: enc, dec: dec, tokenMeta: tokenMeta, plainError: plainError, isRevert: isRevert, connect: connect, ensureSepolia: ensureSepolia,
    walletCall: walletCall, readNet: readNet, castNetNft: castNetNft, myNets: myNets, rpcCall: rpcCall, rpcBalance: rpcBalance, tonightSoFar: tonightSoFar };
});
