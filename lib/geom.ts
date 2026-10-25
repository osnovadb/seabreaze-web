// Геометрия разметки: точки в долях 0..1 от картинки
export type P = [number, number]
const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
// Точка внутри четырёхугольника (TL, TR, BR, BL) по долям u (слева направо) и v (сверху вниз) — билинейная интерполяция:
// повторяет наклон фасада на фото, снятом под углом
export const quadPoint = (q: P[], u: number, v: number): P => lerp(lerp(q[0], q[1], u), lerp(q[3], q[2], u), v)
// Ячейка сетки фасада: столбец i из n, строка j из m (j = 0 — верхний этаж)
export function quadCell(q: P[], i: number, n: number, j: number, m: number): P[] {
  const u0 = i / n, u1 = (i + 1) / n, v0 = j / m, v1 = (j + 1) / m
  return [quadPoint(q, u0, v0), quadPoint(q, u1, v0), quadPoint(q, u1, v1), quadPoint(q, u0, v1)]
}
export const polyStr = (ps: P[] | number[][]) => ps.map((p) => `${p[0]},${p[1]}`).join(' ')
export const centroid = (ps: number[][]): P => [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length]
