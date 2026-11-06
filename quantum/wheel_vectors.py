"""data/wheel-vectors.json: the frozen recipe applied to his real nights from the chain (data/chain-nights.json).
The page's JS engine must reproduce every number here (steps, angles, perfect-quantum and normal P per spot)."""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(__file__)); import wheel
src = json.load(open(os.path.join(os.path.dirname(__file__), '../data/chain-nights.json')))
out = {'recipe': 'wheel_spec.md v1', 'nights': {}}
for day, n in sorted(src['nights'].items()):
    if not n.get('complete'): continue
    steps = wheel.steps_from_w([r['turns'] for r in n['rounds']])
    ideal, ih = wheel.ideal_walk(steps, trace=True); normal, nh = wheel.normal_walk(steps, trace=True)
    out['nights'][day] = {'core': n['core'], 'rounds': [[r['id'], r['turns']] for r in n['rounds']], 'steps': steps,
                          'angles': [round(wheel.angle(t), 12) for t in steps], 'perfect': [round(x, 12) for x in ideal],
                          'normal': [round(x, 12) for x in normal], 'perfectTrace': [[round(x, 9) for x in s] for s in ih],
                          'normalTrace': [[round(x, 9) for x in s] for s in nh]}
json.dump(out, open(os.path.join(os.path.dirname(__file__), '../data/wheel-vectors.json'), 'w'), separators=(',', ':'))
for d, v in out['nights'].items(): print(d, 'steps', len(v['steps']), 'top perfect spot', max(range(16), key=lambda s: v['perfect'][s]), 'top normal spot', max(range(16), key=lambda s: v['normal'][s]))
