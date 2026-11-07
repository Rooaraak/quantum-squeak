"""The story band's five painted panels ("How Squeektoshi opened the door", owner 11-07) -> wheel/art/lore.json
{panel-N: {data: base64 WebP, w, h}}: 900 px wide, q76, no metadata (the export gate checks). panel-1 is painted inside a
wooden picture frame: it is cut out (the same 2400:1792 shape as the others) before the resize.
  python3 wheel/art/make_lore.py <folder with panel-1.png .. panel-5.png (2400x1792)>"""
import base64, io, json, os, sys
from PIL import Image

src = sys.argv[1] if len(sys.argv) > 1 else '.'
W = 900
out = {}
for n in range(1, 6):
    im = Image.open(os.path.join(src, f'panel-{n}.png')).convert('RGB')
    assert im.size == (2400, 1792), im.size
    if n == 1:                                           # the frame is ~110 px wide: keep the inside, same aspect
        mx = 165; w = 2400 - 2 * mx; h = round(w * 1792 / 2400); my = (1792 - h) // 2
        im = im.crop((mx, my, mx + w, my + h))
    im = im.resize((W, round(W * 1792 / 2400)), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, 'WEBP', quality=76, method=6); data = b.getvalue()
    assert data[:4] == b'RIFF' and b'EXIF' not in data and b'XMP ' not in data and b'ICCP' not in data
    out[f'panel-{n}'] = {'data': base64.b64encode(data).decode('ascii'), 'w': im.size[0], 'h': im.size[1]}
dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lore.json')
json.dump(out, open(dst, 'w'), separators=(',', ':'))
print('lore.json', os.path.getsize(dst), 'bytes:', ', '.join(f'{k} {v["w"]}x{v["h"]}' for k, v in out.items()))
