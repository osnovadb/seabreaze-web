# Контуры квартир на плане этажа: подписи (parse.py) + стены → [{number, riser, points}] в долях картинки, плюс картинка-проверка.
import sys, json, re, csv
import numpy as np
from PIL import Image, ImageDraw
from parse import parse

def riser(n):
    m = re.match(r'^(\d+)(.*)$', n)
    return (m.group(1)[-2:] + m.group(2)) if m and len(m.group(1)) >= 3 else n

def num(s):
    s = s.replace(',', '.'); m = re.search(r'\d+(\.\d+)?', s)
    return float(m.group(0)) if m else None

def build(path, blk, floor, units, debug=None):
    d = parse(path); W, H = d['W'], d['H']
    im = Image.open(path).convert('L'); gray = np.asarray(im)
    labs = [l for l in d['labels'] if l['w'] < 200]
    xs0 = min(l['x'] for l in labs) - 150; xs1 = max(l['x'] + l['w'] for l in labs) + 150
    ys = sorted(l['y'] for l in labs); ymid = (ys[0] + ys[-1]) / 2
    top = sorted([l for l in labs if l['y'] < ymid], key=lambda l: l['x']); bot = sorted([l for l in labs if l['y'] >= ymid], key=lambda l: l['x'])
    y0 = max(l['y'] + l['h'] for l in top) + 15; y1 = min(l['y'] for l in bot) - 15
    dark = gray < 110
    reg = dark[y0:y1, xs0:xs1]
    rows = np.where(reg.mean(axis=1) > 0.03)[0]; cols = np.where(reg.mean(axis=0) > 0.03)[0]
    by0, by1 = y0 + rows[0], y0 + rows[-1]; bx0, bx1 = xs0 + cols[0], xs0 + cols[-1]
    # коридор: длинная светлая полоса в средней части здания
    mid = dark[by0:by1, bx0 + (bx1 - bx0) // 5: bx1 - (bx1 - bx0) // 5].mean(axis=1)
    best, s = (0, 0), None
    for i, v in enumerate(list(mid < 0.06) + [False]):
        if v and s is None: s = i
        if not v and s is not None:
            if i - s > best[1] - best[0] and (by1 - by0) * 0.3 < s < (by1 - by0) * 0.75: best = (s, i)
            s = None
    cy0, cy1 = by0 + best[0], by0 + best[1]
    # сопоставление подписей с квартирами этажа: площадь (±0.12), для одинаковых площадей — соседи по ряду
    fl = [u for u in units if u['blk'] == blk and u['floor'] == floor]
    for l in labs: l['a'] = num(l['area'])
    def cands(l): return [u for u in fl if l['a'] is not None and abs(u['area'] - l['a']) <= 0.12]
    taken = {}
    for row in (top, bot):
        for l in row:
            c = cands(l)
            ocrn = re.sub(r'[^0-9a-z]', '', l['num'].lower())
            exact = [u for u in c if u['number'].lower() == ocrn]
            if len(c) == 1 or exact: l['u'] = (exact or c)[0]
        for _ in range(3):
            for i, l in enumerate(row):
                if l.get('u'): continue
                c = [u for u in cands(l) if u['number'] not in {x['u']['number'] for x in row if x.get('u')}]
                c = [u for u in c if all(u is not x.get('u') for x in top + bot)]
                if len(c) == 1: l['u'] = c[0]; continue
                nb = [row[j]['u'] for j in (i - 1, i + 1) if 0 <= j < len(row) and row[j].get('u')]
                if c and nb:
                    def dist(u): return min(abs(int(re.match(r'\d+', riser(u['number'])).group(0)) - int(re.match(r'\d+', riser(n['number'])).group(0))) for n in nb)
                    l['u'] = sorted(c, key=dist)[0]
    # одна квартира — одна подпись: при дубле остаётся подпись с точным номером или ближайшей площадью
    def quality(l):
        ocrn = re.sub(r'[^0-9a-z]', '', l['num'].lower())
        return (0 if ocrn == l['u']['number'].lower() else 1, abs((l['a'] or 0) - l['u']['area']))
    by = {}
    for l in top + bot:
        if l.get('u'): by.setdefault(l['u']['number'], []).append(l)
    for n, ls in by.items():
        if len(ls) > 1:
            for l in sorted(ls, key=quality)[1:]: l.pop('u')
    # оставшиеся подписи и квартиры: по ближайшей площади (до 1,5 м²), затем по номеру из OCR
    used = {l['u']['number'] for l in top + bot if l.get('u')}
    free = [u for u in fl if u['number'] not in used]
    for l in sorted([l for l in top + bot if not l.get('u')], key=lambda l: l['a'] is None):
        if not free: break
        ocrn = re.sub(r'[^0-9a-z]', '', l['num'].lower())
        c = [u for u in free if u['number'].lower() == ocrn] or ([min(free, key=lambda u: abs(u['area'] - l['a']))] if l['a'] is not None and min(abs(u['area'] - l['a']) for u in free) <= 1.5 else [])
        if not c and len(free) == 1 and len([x for x in top + bot if not x.get('u')]) == 1: c = free
        if c: l['u'] = c[0]; free.remove(c[0])
    # стены ряда: столбцы, тёмные почти на всю высоту ряда
    def walls(ya, yb):
        f = dark[ya:yb, bx0:bx1].mean(axis=0)
        idx = np.where(f > 0.5)[0]; segs = []
        for x in idx:
            if segs and x - segs[-1][1] <= 3: segs[-1][1] = x
            else: segs.append([x, x])
        return [bx0] + [bx0 + (a + b) // 2 for a, b in segs if b - a >= 4] + [bx1]
    cells = []
    for row, ya, yb in ((top, by0, cy0), (bot, cy1, by1)):
        f = dark[ya + (yb - ya) // 6: yb - (yb - ya) // 6, bx0:bx1].mean(axis=0)
        strong = [bx0 + i for i in np.where(f > 0.45)[0]]
        def snap(x, r=45):
            near = [w for w in strong if abs(w - x) <= r]
            return int(min(near, key=lambda w: abs(w - x))) if near else int(x)
        cx = [l['x'] + l['w'] / 2 for l in row]
        A = [l['u']['area'] if l.get('u') else (l['a'] or 50) for l in row]
        # ширина пропорциональна площади; масштаб — так, чтобы квартиры занимали ~85% длины ряда (остальное — лестницы и лифты)
        k = sum(A) / (0.85 * (bx1 - bx0))
        iv = [[c - a / k / 2, c + a / k / 2] for c, a in zip(cx, A)]
        for i in range(len(iv) - 1):
            if iv[i][1] > iv[i + 1][0]:
                m = (iv[i][1] * A[i + 1] + iv[i + 1][0] * A[i]) / (A[i] + A[i + 1]); iv[i][1] = iv[i + 1][0] = m
        if iv and iv[0][0] - bx0 < (iv[0][1] - iv[0][0]) * 0.5: iv[0][0] = bx0
        if iv and bx1 - iv[-1][1] < (iv[-1][1] - iv[-1][0]) * 0.5: iv[-1][1] = bx1
        for i, (l, (a, b)) in enumerate(zip(row, iv)):
            a, b = max(bx0, snap(a)), min(bx1, snap(b))
            if l.get('u') and b > a: cells.append({'number': l['u']['number'], 'riser': riser(l['u']['number']), 'id': l['u']['id'], 'points': [[round(a / W, 4), round(ya / H, 4)], [round(b / W, 4), round(ya / H, 4)], [round(b / W, 4), round(yb / H, 4)], [round(a / W, 4), round(yb / H, 4)]]})
    miss = [u['number'] for u in fl if u['number'] not in {c['number'] for c in cells}]
    if debug:
        dbg = Image.open(path).convert('RGB'); dr = ImageDraw.Draw(dbg)
        for c in cells:
            p = [(x * W, y * H) for x, y in c['points']]; dr.polygon(p, outline=(0, 160, 0), width=8)
            dr.text((p[0][0] + 20, p[0][1] + 20), c['number'], fill=(0, 0, 255), font_size=60)
        dbg.resize((W // 3, H // 3)).save(debug)
    return {'blk': blk, 'floor': floor, 'cells': cells, 'missing': miss, 'labels': len(labs)}

if __name__ == '__main__':
    units = [dict(zip(['blk', 'number', 'floor', 'area', 'ext', 'plot', 'type', 'id'], r)) for r in csv.reader(open(sys.argv[2]))]
    for u in units: u['floor'] = int(u['floor']); u['area'] = float(u['area'])
    blk, floor = sys.argv[3], int(sys.argv[4])
    r = build(sys.argv[1], blk, floor, units, sys.argv[5] if len(sys.argv) > 5 else None)
    print(json.dumps(r))
