"""Builds the Quantum Catch page: wheel/page.template.html + engine.js + catch.js + his real nights + the IBM chip results +
the twin-test summary + the reused v9 hamster art -> wheel/out/quantum-catch.html (one self-contained file, works offline),
and wheel/out/results.json next to it (the same nights and chip results: the standalone site reads it, so a new night's
result reaches the page without a rebuild of the page; the claude.ai preview blocks fetches, the built-in data always works).
  python3 wheel/build.py                          (chip results: quantum/wheel-*.json)
  python3 wheel/build.py --chips 'wheel/test/fixtures/wheel-*.json' --out /some/scratch/test-page.html   (tests only)
  python3 wheel/build.py --catch-address 0x...    (the QuantumCatch contract: test builds only until it is deployed;
                                                   the real value lives in wheel/config.json, null = no NFT button)
  python3 wheel/build.py --sqk-address 0x... --faucet-address 0x...   (the test SQK and its faucet: test builds on a
                                                   local anvil only; else wheel/config.json sqkAddress / faucetAddress)
  python3 wheel/build.py --repo-url https://github.com/<owner>/<repo>   (else wheel/config.json repoUrl)
  python3 wheel/build.py --season1-address 0x... --season2-address 0x...   (Season 2 test builds on a local anvil: casts
                                                   to the v3 game, Season 1 nets read from v2; else wheel/config.json
                                                   season1Address / season2Address: the switch is season2Address)
Recipe per night (quantum/wheel_spec.md): the 29 Oct - 4 Nov archive is v1.1 (up to 16 steps), nights from 5 Nov are v1.2
(at most 10 steps). A night's chip result must be a run of the night's own recipe, with exactly the steps that recipe
makes from his rounds; runs of the other recipe (the v1.2 re-runs of archive nights) are kept as comparisons, never as
the night's result. Every chip run carries `first_shot`: the SPOT of the chip's very first shot (shots_in_order[0], a
position, turned onto the ring by wheel.py spot_of), which makes the night's Epic spot Legendary when it lands there (the
owner's rarity rule, contracts/src/QuantumCatch.sol tiersOf; the page ranks with wheel/engine.js tiers)."""
import base64, glob, importlib.util, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
arg = lambda k, d=None: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
CHIPS = arg('--chips', os.path.join(ROOT, 'quantum', 'wheel-*.json'))
OUT = arg('--out', os.path.join(HERE, 'out', 'quantum-catch.html'))
TWIN = os.path.join(ROOT, 'quantum', 'twin-ibm_fez-dblspcu74qds73dr42cg.json')
rd = lambda p: open(p, encoding='utf-8').read()
jdump = lambda o: json.dumps(o, separators=(',', ':'), ensure_ascii=False)

_spec = importlib.util.spec_from_file_location('qwheel', os.path.join(ROOT, 'quantum', 'wheel.py'))
wheel = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(wheel)   # steps_from_w(w, cap), HEALTH_MIN

# ---- config: the public repo link and the QuantumCatch contract (null until it is deployed: then no NFT button)
CFG = json.load(open(os.path.join(HERE, 'config.json')))
REPO = arg('--repo-url', os.environ.get('QC_REPO_URL') or CFG.get('repoUrl') or '')
CATCH = arg('--catch-address', CFG.get('catchAddress'))
CATCH = None if CATCH in (None, '', 'null') else CATCH
assert re.fullmatch(r'https://github\.com/[\w.-]+/[\w.-]+', REPO), 'repoUrl must be a plain https://github.com/<owner>/<repo> link'
assert CATCH is None or re.fullmatch(r'0x[0-9a-fA-F]{40}', CATCH), 'catchAddress must be an address or null'
# QuantumCatch v2 (a net costs test SQK): the token, the daily faucet and the cost label, passed to the page only when
# wheel/config.json has them (the page reads the real cost from the contract; these are labels and the faucet's address)
SQK_CFG = {}
for k, flag in (('sqkAddress', '--sqk-address'), ('faucetAddress', '--faucet-address')):   # flags: test builds (local anvil)
    if k in CFG or flag in sys.argv:
        v = arg(flag, CFG.get(k))
        v = None if v in (None, '', 'null') else v
        assert v is None or re.fullmatch(r'0x[0-9a-fA-F]{40}', v), f'{k} must be an address or null'
        SQK_CFG[k] = v.lower() if v else None
if 'netCost' in CFG:
    assert re.fullmatch(r'\d+(\.\d+)?', str(CFG['netCost'])), 'netCost must be a decimal string like "0.01"'
    SQK_CFG['netCost'] = str(CFG['netCost'])

# ---- Season 2 (QuantumCatchV3): ONE switch, wheel/config.json season2Address (null until the deploy). Set to the v3
# address, the page casts on v3 only and still shows the nets of season1Address (QuantumCatch v2, labelled "Season 1"; the
# v1 picked nets stay as they are in each browser). catchAddress may stay the v2 address or become the v3 one; anything else
# is refused, as is a v3 address without season1Address (Season 1 nets would vanish from the page).
#   test builds: --season1-address / --season2-address (a local anvil chain; then no check against the live addresses)
V1_CATCH = '0xa0b3352b3a436c845e3bf2d251abeda3d474dfe0'   # QuantumCatch v1 (Sepolia, 6 Nov 2026: castNet(uint8 spot), free)
V2_CATCH = '0x151ec033c914252358bdcdba0548ac6a7b4f7f49'   # QuantumCatch v2 (Sepolia, 6 Nov 2026: Season 1, test SQK, no picking)
def opt_addr(key, flag):
    v = arg(flag, CFG.get(key))
    v = None if v in (None, '', 'null') else v
    assert v is None or re.fullmatch(r'0x[0-9a-fA-F]{40}', v), f'{key} must be an address or null'
    return v.lower() if v else None
S1 = opt_addr('season1Address', '--season1-address')
S2 = opt_addr('season2Address', '--season2-address')
if S1 and '--season1-address' not in sys.argv:
    assert S1 == V2_CATCH, f'season1Address must be the Season 1 contract (QuantumCatch v2) {V2_CATCH}, not {S1}'
SEASON2 = bool(S2)
if SEASON2:
    assert S1, 'season2Address (the Season 2 contract) needs season1Address (the Season 1 contract whose nets the page still shows)'
    assert S2 not in (S1, V1_CATCH, V2_CATCH), f'season2Address {S2} is a Season 1 contract'
    if '--season2-address' not in sys.argv and '--catch-address' not in sys.argv:
        assert CATCH and CATCH.lower() in (S1, S2), f'catchAddress {CATCH} is neither season1Address nor season2Address'
    CATCH = S2                                            # casts go to v3 only
S2_SKINS = None
if SEASON2:   # the prizes row: each tier's Season 2 skins (wheel/art/s2/make_skins.py)
    S2_SKINS = json.load(open(os.path.join(HERE, 'art', 's2', 'skins.json')))
    assert [len(t) for t in S2_SKINS] == [1, 3, 2, 3, 2], 'skins.json: Common 1, Uncommon 3, Rare 2, Epic 3, Legendary 2'
    assert all(re.fullmatch(r'[a-z]+', n) and base64.b64decode(d[:16])[:4] == b'RIFF' for t in S2_SKINS for n, d in t)

RECIPES = {'v1.1': 16, 'v1.2': 10}
ARCHIVE_LAST = '2026-11-04'           # nights up to here are recipe v1.1; from 5 Nov on, v1.2
def recipe_of(s):
    m = re.search(r'(?:^|\s)(v1(?:\.\d+)?)$', str(s).strip())
    v = m and ('v1.1' if m.group(1) == 'v1' else m.group(1))   # the archive files say 'wheel_spec.md v1' (= v1.1)
    assert v in RECIPES, f'unknown recipe {s!r}'
    return v
night_recipe = lambda day: 'v1.1' if day <= ARCHIVE_LAST else 'v1.2'

# ---- his nights, straight from the chain (data/chain-nights.json, complete nights only). The engine's test fixture
# data/wheel-vectors.json (recipe v1.1) must agree on every night it has.
V = json.load(open(os.path.join(ROOT, 'data', 'wheel-vectors.json')))
assert recipe_of(V['recipe']) == 'v1.1', V['recipe']
C = json.load(open(os.path.join(ROOT, 'data', 'chain-nights.json')))['nights']
nights = {}
for day, c in sorted(C.items()):
    if not c.get('complete'): continue
    rounds = [[r['id'], r['turns']] for r in c['rounds']]
    rec = night_recipe(day)
    steps = wheel.steps_from_w([t for _, t in rounds], RECIPES[rec])
    if day in V['nights']:
        v = V['nights'][day]
        assert v['core'] == c['core'] and v['rounds'] == rounds, f'{day}: vectors and chain disagree'
        if rec == 'v1.1': assert v['steps'] == steps, f'{day}: v1.1 steps differ from the vectors'
    nights[day] = {'core': c['core'], 'genesis': c['genesis'], 'firstRound': c['firstRound'], 'lastRound': c['lastRound'],
                   'rounds': rounds, 'recipe': rec, 'steps': steps, **({'slept': True} if not rounds else {})}
assert nights, 'no complete night in data/chain-nights.json'

# ---- IBM chip results: newest healthy run of the night's recipe per night. Health gate = wheel.py chip_healthy (twin test
# under HEALTH_MIN: the chip misbehaved, the run is thrown out and redone). Nothing is hidden: every run NOT shown as a
# night's result (under the gate / in quantum/rejected/, or an older healthy run replaced by a newer one) goes into the
# data as `not_shown`; healthy runs of the OTHER recipe go into `reruns` (the page compares them with the night's result).
HEALTH_MIN = wheel.HEALTH_MIN
REJECTED = arg('--rejected', os.path.join(ROOT, 'quantum', 'rejected', 'wheel-*.json'))
REJECT_NOTES = {'dbma7apkbkrc73cp4vo0': 'after a chip recalibration'}   # one line per thrown-out job (quantum/rejected/README.md)
chips, skipped, not_shown, reruns, seen = {}, [], [], [], set()
CHIP_KEYS = ('night', 'core', 'rounds', 'steps', 'backend', 'job_id', 'wheel_shots', 'wheel_2q_gates', 'counts',
             'shots_in_order', 'twin', 'quantum_seconds', 'dd_twirl')
def note(R, why, tw):
    return {'night': R['night'], 'job_id': R['job_id'], 'backend': R['backend'], 'recipe': recipe_of(R['recipe']),
            'created': (R.get('timestamps') or {}).get('created') or '',
            'twin_wins': sum(p['wins'] for p in R['twin']), 'twin_shots': sum(p['shots'] for p in R['twin']), 'twin_pct': round(100 * tw, 1),
            'why': why, 'note': REJECT_NOTES.get(R['job_id'], '')}
runs = [(f, False) for f in sorted(glob.glob(CHIPS))] + [(f, True) for f in sorted(glob.glob(REJECTED))]
for f, rejected_dir in runs:
    R = json.load(open(f))
    if R.get('kind') != 'quantum_wheel' or R['job_id'] in seen: continue
    seen.add(R['job_id'])
    day, name = R['night'], os.path.basename(f)
    assert day in nights, f'{name}: night {day} is not a complete night in data/chain-nights.json'
    n, rr = nights[day], recipe_of(R['recipe'])
    assert R['core'] == n['core'] and R['rounds'] == n['rounds'], f'{name}: not the same night'
    assert R['steps'] == wheel.steps_from_w([t for _, t in n['rounds']], RECIPES[rr]), f'{name}: steps are not what {rr} makes from his rounds'
    shots = R['wheel_shots']
    assert len(R['counts']) == 16 and sum(R['counts']) == shots and len(R['shots_in_order']) == shots, name
    assert all(R['counts'][s] == R['shots_in_order'].count(s) for s in range(16)), name
    tw = sum(p['wins'] for p in R['twin']) / sum(p['shots'] for p in R['twin'])
    if R.get('healthy') is False or tw < HEALTH_MIN or rejected_dir:
        skipped.append(f"{name} (twin test {100 * tw:.1f}% < {100 * HEALTH_MIN:.0f}% health gate)" if tw < HEALTH_MIN else f"{name} (marked rejected)")
        not_shown.append(note(R, 'rejected', tw)); continue
    created = (R.get('timestamps') or {}).get('created') or ''
    rec = {k: R.get(k) for k in CHIP_KEYS}
    first = wheel.spot_of(R['shots_in_order'][0], wheel.ring_turn([t for _, t in n['rounds']]))   # before a re-run drops the shots
    assert wheel.turned(R['counts'], wheel.ring_turn([t for _, t in n['rounds']]))[first] > 0, name
    rec.update(created=created, recipe=rr, first_shot=first)
    if rr != n['recipe']:
        rec.pop('shots_in_order'); rec['twin_pct'] = round(100 * tw, 1); reruns.append(rec); continue
    if day not in chips: chips[day] = rec
    elif created > chips[day]['created']: not_shown.append(chips[day]['_note']); chips[day] = rec
    else: not_shown.append(note(R, 'replaced', tw)); continue
    chips[day]['_note'] = note(R, 'replaced', tw)
for c in chips.values(): c.pop('_note', None)
not_shown.sort(key=lambda x: (x['night'], x['created']))
reruns.sort(key=lambda x: (x['night'], x['created']))

W = json.load(open(TWIN))
# 'first' = the first 25 real recorded rounds of each card pair (a, b bits), replayed in the page's Twin Lab
pairs = [{'a_card': p['a_card'], 'b_card': p['b_card'], 'wins': p['wins'], 'shots': p['shots'], 'first': p['bits_ab'][:25]} for p in W['pairs']]
assert all(len(p['first']) == 25 and all(re.fullmatch('[01]{2}', b) for b in p['first']) for p in pairs)
assert sum(p['wins'] for p in pairs) == 3372 and sum(p['shots'] for p in pairs) == 4000
twin = {'backend': W['backend'], 'job_id': W['job_id'], 'created': W['timestamps'].get('created'), 'pairs': pairs,
        'quantum_seconds': W.get('quantum_seconds'), 'classical_max_pct': W['classical_max_pct'], 'ideal_pct': W['ideal_pct']}

newest = nights[max(nights)]
results = {'kind': 'quantum_catch_results', 'v': 1, 'recipes': RECIPES, 'archive_last': ARCHIVE_LAST,
           'nights': nights, 'chips': chips, 'reruns': reruns, 'not_shown': not_shown}
data = {**results, 'twin': twin, 'health_min': HEALTH_MIN,
        'config': {'repoUrl': REPO, 'catchAddress': CATCH.lower() if CATCH else None, 'chainId': '0xaa36a7', **SQK_CFG,
                   'season2': SEASON2, 'season1Address': S1 if SEASON2 else None},
        'core': {'address': newest['core'], 'genesis': newest['genesis']}}
art = json.load(open(os.path.join(HERE, 'art', 'art.json')))
SHOWCASE = json.load(open(os.path.join(HERE, 'art', 'showcase.json'), encoding='utf-8'))   # Season 2 preview cards (12 webp)
TEASER = json.load(open(os.path.join(HERE, 'art', 'teaser.json')))                         # "Hamster battles" fight scene (1400x781 webp)
BANNERS = json.load(open(os.path.join(HERE, 'art', 'banners.json')))                       # the lab (footer) + the 5 prizes podium (How it works)
assert len(SHOWCASE) == 12 and all(base64.b64decode(v['data'][:16])[:4] == b'RIFF' and v['traits'] for v in SHOWCASE.values())
assert base64.b64decode(TEASER['data'][:16])[:4] == b'RIFF'
art = {**art, 'showcase': SHOWCASE, 'teaser': TEASER, 'banners': BANNERS}        # in memory only: art.json (packed on-chain) is not rewritten
if S2_SKINS: art['s2skins'] = S2_SKINS
# Season 2 gallery: real hamsters drawn by the contract's own renderer (wheel/art/s2/examples.json, same shape as
# showcase.json); without it the page keeps the 12 painted previews under "A first look at Season 2"
S2_EX = os.path.join(HERE, 'art', 's2', 'examples.json')
if SEASON2 and os.path.exists(S2_EX):
    EX = json.load(open(S2_EX, encoding='utf-8'))
    assert 4 <= len(EX) <= 16 and all(base64.b64decode(v['data'][:16])[:4] == b'RIFF' and v['traits'] for v in EX.values()), 'examples.json: 4-16 webp hamsters with traits'
    art['s2examples'] = EX
elif SEASON2:
    print('note: no wheel/art/s2/examples.json: the Season 2 gallery shows the painted previews ("A first look at Season 2")', file=sys.stderr)

# ---- the door's fuel (owner 11-07: every net burns its NET_COST of test SQK). The page shows the total burned so far only
# when it is COMPLETE: every NetPaid log of the paid game contracts (QuantumCatch v2 and v3; v1 nets were free) since their
# deploy blocks, read in chunks of at most 9,500 blocks from the public RPC and kept in data/burned.json, so each build reads
# only the blocks since the one before (the public node prunes logs older than ~10,000 blocks). Any gap or failure: no
# number (DATA.burned null), never a wrong one; the page adds the nets paid after asOfBlock, read live.
#   QC_BURNED=<sqk>@<block> | none   a fixed value (tests); test builds (address flags, --out) never read the chain
GAME_DEPLOY = {V2_CATCH: 12077948, '0x5331631708adff57965aab4bba5453be35e30b30': 12082925}   # (ops/deploy-v2/v3-sepolia-record.json)
TOPIC_NETPAID = '0x100db5ea1f9223afdc01a632bcfeea16' + '5e5be9e69a705ff5a0f3602c4eb65ef0'   # NetPaid(uint32,address,uint256), in halves for the leak gate
BURN_CACHE = os.path.join(ROOT, 'data', 'burned.json')
def burned_total():
    env = os.environ.get('QC_BURNED')
    if env is not None:
        if env in ('', 'none'): return None
        m = re.fullmatch(r'(\d+(?:\.\d{1,18})?)@(\d+)', env); assert m, 'QC_BURNED must be <sqk>@<block> or none'
        from decimal import Decimal
        return {'wei': str(int(Decimal(m.group(1)) * 10 ** 18)), 'asOfBlock': int(m.group(2))}
    if os.path.abspath(OUT) != os.path.join(HERE, 'out', 'quantum-catch.html') or any(f in sys.argv for f in ('--catch-address', '--season1-address', '--season2-address')):
        return None
    games = sorted({a for a in (S1, S2, CATCH and CATCH.lower()) if a in GAME_DEPLOY})
    if not games: return None
    import urllib.request
    def rpc(method, params):
        q = urllib.request.Request('https://ethereum-sepolia-rpc.publicnode.com', data=json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}).encode(),
                                   headers={'content-type': 'application/json', 'user-agent': 'quantum-squeak-build'})
        j = json.load(urllib.request.urlopen(q, timeout=20))
        if 'error' in j: raise RuntimeError(str(j['error'])[:120])
        return j['result']
    try:
        cache = json.load(open(BURN_CACHE)) if os.path.exists(BURN_CACHE) else {}
        known = cache.get('games', {})
        as_of = int(rpc('eth_blockNumber', []), 16) - 3          # a few blocks back: no reorg can take a counted net back
        out = {}
        for g in games:
            c = known.get(g) if isinstance(known.get(g), dict) and known[g].get('deployBlock') == GAME_DEPLOY[g] else None
            wei, nets, frm = (int(c['wei']), int(c['nets']), int(c['toBlock']) + 1) if c else (0, 0, GAME_DEPLOY[g])
            while frm <= as_of:
                to = min(frm + 9499, as_of)
                for l in rpc('eth_getLogs', [{'address': g, 'topics': [TOPIC_NETPAID], 'fromBlock': hex(frm), 'toBlock': hex(to)}]):
                    assert l['topics'][0].lower() == TOPIC_NETPAID and len(l['data']) == 66, 'not a NetPaid log'
                    wei += int(l['data'], 16); nets += 1
                frm = to + 1
            out[g] = {'deployBlock': GAME_DEPLOY[g], 'toBlock': as_of, 'wei': str(wei), 'nets': nets}
        json.dump({'note': 'test SQK burned by Quantum Squeak nets (NetPaid logs since each deploy), counted by wheel/build.py', 'asOfBlock': as_of, 'games': out},
                  open(BURN_CACHE, 'w'), indent=1); open(BURN_CACHE, 'a').write('\n')
        return {'wei': str(sum(int(x['wei']) for x in out.values())), 'asOfBlock': as_of}
    except Exception as e:                                      # offline, refused, pruned: no number at all
        print(f'note: the burned total is not shown (cannot read it completely: {str(e)[:100]})', file=sys.stderr)
        return None
data['burned'] = burned_total()

T = rd(os.path.join(HERE, 'page.template.html'))
rep = {'/*__ENGINE__*/': rd(os.path.join(HERE, 'engine.js')), '/*__CATCH__*/': rd(os.path.join(HERE, 'catch.js')),
       '/*__DATA__*/': jdump(data), '/*__ART__*/': jdump(art)}
for k, v in rep.items():
    assert T.count(k) == 1, k
    T = T.replace(k, v)
# QuantumCatch v2: this catch.js (castNetWithPermit, no spot) refuses the live v1 contract ('config', before anything is
# signed). A page with the v2 wallet code and the v1 catchAddress must therefore not show a cast button: the page v2
# template reads the contract's NET_COST() and shows its NOT_WIRED line instead (RULINGS 52, 58), so it is built (with a
# note); any other page is refused, before anything is written, so the morning stops loudly. The switch is one step:
# wheel/config.json catchAddress (and faucetAddress) to the v2 deploy (from its deploy record), or null (watch-only).
if '266ab9cf' in rep['/*__CATCH__*/'].lower() and CATCH and CATCH.lower() == V1_CATCH:   # castNetWithPermit's selector
    if 'const NOT_WIRED = ' not in T:
        sys.exit(f'refused: wheel/catch.js is the v2 wallet code (castNet() with no spot, test SQK) but catchAddress {V1_CATCH} '
                 'is the v1 contract (castNet(uint8 spot)) and this page has no not-wired guard: its NFT button could never '
                 'cast. Set wheel/config.json catchAddress and faucetAddress to the v2 deploy (its deploy record), or '
                 'catchAddress null (watch-only).')
    print(f'note: catchAddress {V1_CATCH} is the v1 contract: wallet visitors see the not-wired line ("Casting opens soon") '
          'until wheel/config.json gets the v2 catchAddress + faucetAddress', file=sys.stderr)
assert T.startswith('<meta charset="utf-8">\n'), 'the page must start with its <meta charset> line'
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
open(OUT, 'w', encoding='utf-8').write(T)
RES = os.path.join(os.path.dirname(os.path.abspath(OUT)), 'results.json')
open(RES, 'w', encoding='utf-8').write(jdump(results) + '\n')
for s in skipped: print('SKIPPED chip run', s)
rel = lambda p: os.path.relpath(p, ROOT) if os.path.abspath(p).startswith(ROOT) else os.path.basename(p)
print(f'{rel(OUT)}: {len(T.encode())} bytes, {rel(RES)}: {os.path.getsize(RES)} bytes, {len(nights)} nights '
      f'({", ".join(f"{d} {n["recipe"]}" for d, n in nights.items())}), chip results for {sorted(chips) or "no night yet"}; '
      f're-runs with the other recipe: {[(x["night"], x["recipe"], x["job_id"]) for x in reruns] or "none"}; '
      f'runs not shown (listed on the page): {[(x["night"], x["job_id"], x["why"]) for x in not_shown] or "none"}; '
      f'NFT button: {"on, " + CATCH if CATCH else "off (no contract address)"}; '
      f'Season 2: {"on (casts to " + S2 + ", Season 1 nets from " + S1 + ")" if SEASON2 else "off (season2Address null)"}; '
      f'burned so far: {"%s test SQK as of block %d" % (int(data["burned"]["wei"]) / 1e18, data["burned"]["asOfBlock"]) if data["burned"] else "not shown"}')
