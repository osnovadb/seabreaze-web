# Чистка контуров квартир поэтажных планов BRABUS: прямоугольные — ровный прямоугольник по оси здания, общие стены — в одну линию;
# угловые — многоугольник без зазубрин (Дуглас — Пекер). Координаты — доли картинки, считаем в пикселях.
import sys, json, math
from PIL import Image
d = sys.argv[1]
D = json.load(open(d + '/all.json'))

def area(p):
    return abs(sum(p[i][0] * p[i-1][1] - p[i-1][0] * p[i][1] for i in range(len(p)))) / 2
def rot(p, a):
    c, s = math.cos(a), math.sin(a)
    return [(x * c - y * s, x * s + y * c) for x, y in p]
def dp(p, eps):
    if len(p) < 3: return p
    def rec(pts):
        a, b = pts[0], pts[-1]; dx, dy = b[0]-a[0], b[1]-a[1]; L = math.hypot(dx, dy) or 1e-9
        i, dm = 0, -1
        for k in range(1, len(pts)-1):
            dd = abs(dy*pts[k][0] - dx*pts[k][1] + b[0]*a[1] - b[1]*a[0]) / L
            if dd > dm: i, dm = k, dd
        if dm > eps: return rec(pts[:i+1])[:-1] + rec(pts[i:])
        return [a, b]
    q = rec(p + [p[0]])[:-1]
    return q if len(q) >= 3 else p
def axis(p):
    # направление самого длинного ребра, приведённое к [-45°, 45°)
    best, ang = 0, 0
    for i in range(len(p)):
        (x1, y1), (x2, y2) = p[i-1], p[i]; L = math.hypot(x2-x1, y2-y1)
        if L > best: best, ang = L, math.atan2(y2-y1, x2-x1)
    while ang >= math.pi/4: ang -= math.pi/2
    while ang < -math.pi/4: ang += math.pi/2
    return ang

stat = []
for fp in D:
    W, H = Image.open(d + '/' + fp['file']).size
    cells = fp['cells']; out = []
    rects = []  # (index, angle, xmin, xmax, ymin, ymax) в повёрнутой системе
    for c in cells:
        px = [(x*W, y*H) for x, y in c['points']]
        a = axis(px); r = rot(px, -a)
        xs, ys = [p[0] for p in r], [p[1] for p in r]
        box = (max(xs)-min(xs)) * (max(ys)-min(ys))
        fill = area(px) / box if box else 0
        if fill >= 0.86:
            rects.append([len(out), a, min(xs), max(xs), min(ys), max(ys)]); out.append(None)
        else:
            q = dp(px, max(W, H) * 0.006)
            out.append([[round(x/W, 4), round(y/H, 4)] for x, y in q])
    # общие стены: у прямоугольников с почти одной осью края ближе 6 px сводим в одну линию
    for k in (2, 4):
        groups = []
        for r in rects:
            for e in (k, k+1):
                v = r[e]; g = next((g for g in groups if abs(g['a'] - r[1]) < 0.03 and abs(g['v'] - v) < 6), None)
                if g: g['m'].append((r, e)); g['v'] = sum(rr[ee] for rr, ee in g['m']) / len(g['m'])
                else: groups.append({'a': r[1], 'v': v, 'm': [(r, e)]})
        for g in groups:
            for r, e in g['m']: r[e] = g['v']
    for i, a, x0, x1, y0, y1 in rects:
        q = rot([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], a)
        out[i] = [[round(x/W, 4), round(y/H, 4)] for x, y in q]
    fp['clean'] = [{**c, 'points': out[i]} for i, c in enumerate(cells)]
    stat.append((fp['b'], fp['floor'], len(rects), len(cells) - len(rects)))
json.dump(D, open(d + '/clean.json', 'w'), ensure_ascii=False)
print(stat)
