# Чистка контуров квартир поэтажных планов BRABUS (ревью О91, 12.11.2026).
# 1) направление квартиры — по прямоугольнику наименьшей площади (перебор сторон выпуклой оболочки), а не по самому длинному ребру;
# 2) если после сильного упрощения (1,5 % размера плана) у контура 4–5 вершин — это обычная квартира: ровный прямоугольник по этому направлению;
# 3) края соседних прямоугольников с одним направлением ближе 1 % ширины плана сводятся в одну стену (убирает перекрытия и щели);
# 4) угловые (скруглённый фасад) — многоугольник, упрощённый с допуском 1 %.
import sys, json, math
from PIL import Image
d = sys.argv[1]
D = json.load(open(d + '/all.json'))

def area(p): return abs(sum(p[i][0]*p[i-1][1] - p[i-1][0]*p[i][1] for i in range(len(p)))) / 2
def rot(p, a):
    c, s = math.cos(a), math.sin(a); return [(x*c - y*s, x*s + y*c) for x, y in p]
def hull(pts):
    pts = sorted(set(pts))
    if len(pts) < 3: return pts
    def cross(o, a, b): return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]
def minrect(px):
    h = hull(px); best = None
    for i in range(len(h)):
        (x1, y1), (x2, y2) = h[i-1], h[i]
        a = math.atan2(y2-y1, x2-x1)
        r = rot(px, -a); xs, ys = [q[0] for q in r], [q[1] for q in r]
        ar = (max(xs)-min(xs)) * (max(ys)-min(ys))
        if best is None or ar < best[0]: best = (ar, a, min(xs), max(xs), min(ys), max(ys))
    _, a, x0, x1, y0, y1 = best
    # направление к [-45°, 45°): одинаковые стены соседей сравнимы
    while a >= math.pi/4: a -= math.pi/2; x0, x1, y0, y1 = -y1, -y0, x0, x1
    while a < -math.pi/4: a += math.pi/2; x0, x1, y0, y1 = y0, y1, -x1, -x0
    return a, x0, x1, y0, y1
def dp(p, eps):
    if len(p) < 4: return p
    def rec(pts):
        a, b = pts[0], pts[-1]; dx, dy = b[0]-a[0], b[1]-a[1]; L = math.hypot(dx, dy) or 1e-9
        i, dm = 0, -1
        for k in range(1, len(pts)-1):
            dd = abs(dy*pts[k][0] - dx*pts[k][1] + b[0]*a[1] - b[1]*a[0]) / L
            if dd > dm: i, dm = k, dd
        if dm > eps: return rec(pts[:i+1])[:-1] + rec(pts[i:])
        return [a, b]
    # начинаем с самой дальней от центра точки — у замкнутого контура так устойчивее
    cx = sum(x for x, _ in p)/len(p); cy = sum(y for _, y in p)/len(p)
    k = max(range(len(p)), key=lambda i: (p[i][0]-cx)**2 + (p[i][1]-cy)**2); p = p[k:] + p[:k]
    q = rec(p + [p[0]])[:-1]
    return q if len(q) >= 3 else p

stat = []
for fp in D:
    W, H = Image.open(d + '/' + fp['file']).size; S = max(W, H)
    out, rects = [], []
    for c in fp['cells']:
        px = [(x*W, y*H) for x, y in c['points']]
        simple = dp(px, S * 0.015)
        a, x0, x1, y0, y1 = minrect(px)
        fill = area(px) / ((x1-x0)*(y1-y0) or 1)
        if len(simple) <= 5 or fill >= 0.9:
            rects.append([len(out), a, x0, x1, y0, y1]); out.append(None)
        else:
            q = dp(px, S * 0.01)
            out.append([[round(x/W, 4), round(y/H, 4)] for x, y in q])
    tol = W * 0.01
    for k in (2, 4):
        groups = []
        for r in rects:
            for e in (k, k+1):
                g = next((g for g in groups if abs(g['a'] - r[1]) < 0.035 and abs(g['v'] - r[e]) < tol), None)
                if g: g['m'].append((r, e)); g['v'] = sum(rr[ee] for rr, ee in g['m']) / len(g['m'])
                else: groups.append({'a': r[1], 'v': r[e], 'm': [(r, e)]})
        for g in groups:
            for r, e in g['m']: r[e] = g['v']
    for i, a, x0, x1, y0, y1 in rects:
        q = rot([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], a)
        out[i] = [[round(x/W, 4), round(y/H, 4)] for x, y in q]
    fp['clean'] = [{**c, 'points': out[i]} for i, c in enumerate(fp['cells'])]
    stat.append(sum(1 for p in out if len(p) == 4))
json.dump(D, open(d + '/clean.json', 'w'), ensure_ascii=False)
tot = sum(len(fp['cells']) for fp in D); print('прямоугольников', sum(stat), 'из', tot)
print('много точек (>10):', sum(1 for fp in D for c in fp['clean'] if len(c['points']) > 10))
