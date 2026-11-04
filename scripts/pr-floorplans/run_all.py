import csv, json, re, sys
from parse import parse, ocr as _ocr, prep
def B_ocr(c):
    c = c.resize((c.width // 2, c.height // 2)).point(lambda p: 0 if p < 140 else 255)
    return _ocr(c, '0123456789')
import build as B
units = [dict(zip(['blk', 'number', 'floor', 'area', 'ext', 'plot', 'type', 'id'], r)) for r in csv.reader(open('../pr_floors/units.csv'))]
for u in units: u['floor'] = int(u['floor']); u['area'] = float(u['area'])
rows = [l.strip().split('\t') for l in open('../pr_floors/urls.tsv') if l.strip()]
only = sys.argv[1:]
if only: rows = [r for r in rows if f'{r[0]}-{r[1]}' in only]
out = []
_cache = {}
orig_parse = B.parse
def cached(p):
    if p not in _cache: _cache[p] = orig_parse(p)
    return _cache[p]
B.parse = cached
for blk, fl, h in rows:
    path = f'../pr_floors/img/{blk}-{fl}.jpg'
    d = cached(path)
    areas = [B.num(l['area']) for l in d['labels'] if l['w'] < 200]
    # этаж картинки — по совпадению площадей подписей с квартирами этажа
    score = {}
    for f in range(1, 14):
        fu = [u['area'] for u in units if u['blk'] == blk and u['floor'] == f]
        if not fu: continue
        hit = sum(1 for a in areas if a is not None and any(abs(a - x) <= 0.12 for x in fu))
        score[f] = hit - 0.5 * abs(len(fu) - len(areas))
    # номер этажа — из крупного заголовка картинки; если не прочитался — по совпадению площадей, затем по клику
    from PIL import Image
    im = Image.open(path).convert('L'); W, H = im.size
    t = B_ocr(im.crop((int(W * .38), int(H * .12), int(W * .62), int(H * .23))))
    best = int(fl)  # этаж — по клику в кабинете (снизу вверх); заголовок картинки OCR читает ненадёжно (1 → 7)
    r = B.build(path, blk, best, units, f'dbg/{blk}-{best}.jpg')
    out.append({'blk': blk, 'floor_click': int(fl), 'floor': best, 'title': t, 'hash': h, 'labels': r['labels'], 'cells': r['cells'], 'missing': r['missing'], 'units': len([u for u in units if u['blk'] == blk and u['floor'] == best])})
    print(blk, fl, '→', best, 'title', repr(t), 'labels', r['labels'], 'cells', len(r['cells']), 'of', out[-1]['units'], 'missing', r['missing'], flush=True)
json.dump(out, open('../pr_floors/result.json' if not only else '../pr_floors/result_part.json', 'w'))
