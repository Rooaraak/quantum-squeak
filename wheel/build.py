"""Builds the Quantum Catch page: wheel/page.template.html + engine.js + catch.js + his real nights + the IBM chip results +
the twin-test summary + the reused v9 hamster art -> wheel/out/quantum-catch.html (one self-contained file, works offline),
and wheel/out/results.json next to it (the same nights and chip results: the standalone site reads it, so a new night's
result reaches the page without a rebuild of the page; the claude.ai preview blocks fetches, the built-in data always works).
  python3 wheel/build.py                          (chip results: quantum/wheel-*.json)
  python3 wheel/build.py --chips 'wheel/test/fixtures/wheel-*.json' --out /some/scratch/test-page.html   (tests only)
  python3 wheel/build.py --catch-address 0x...    (the QuantumCatch contract: test builds only until it is deployed;
                                                   the real value lives in wheel/config.json, null = no NFT button)
  python3 wheel/build.py --repo-url https://github.com/<owner>/<repo>   (else wheel/config.json repoUrl)
Recipe per night (quantum/wheel_spec.md): the 29 Oct - 4 Nov archive is v1.1 (up to 16 steps), nights from 5 Nov are v1.2
(at most 10 steps). A night's chip result must be a run of the night's own recipe, with exactly the steps that recipe
makes from his rounds; runs of the other recipe (the v1.2 re-runs of archive nights) are kept as comparisons, never as
the night's result. Every chip run carries `first_shot`: the SPOT of the chip's very first shot (shots_in_order[0], a
position, turned onto the ring by wheel.py spot_of), which makes the night's Epic spot Legendary when it lands there (the
owner's rarity rule, contracts/src/QuantumCatch.sol tiersOf; the page ranks with wheel/engine.js tiers)."""
import glob, importlib.util, json, os, re, sys

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
        'config': {'repoUrl': REPO, 'catchAddress': CATCH.lower() if CATCH else None, 'chainId': '0xaa36a7'},
        'core': {'address': newest['core'], 'genesis': newest['genesis']}}
art = json.load(open(os.path.join(HERE, 'art', 'art.json')))

T = rd(os.path.join(HERE, 'page.template.html'))
rep = {'/*__ENGINE__*/': rd(os.path.join(HERE, 'engine.js')), '/*__CATCH__*/': rd(os.path.join(HERE, 'catch.js')),
       '/*__DATA__*/': jdump(data), '/*__ART__*/': jdump(art)}
for k, v in rep.items():
    assert T.count(k) == 1, k
    T = T.replace(k, v)
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
      f'NFT button: {"on, " + CATCH if CATCH else "off (no contract address)"}')
