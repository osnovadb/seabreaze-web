import Link from 'next/link'
// О12/О55 (обход 11.11): постраничный вывод длинных списков. qs — текущие параметры без page
export function Pager({ page, pages, total, qs, label }: { page: number; pages: number; total: number; qs: string; label: string }) {
  if (pages <= 1) return null
  const at = (p: number) => `?${qs}${qs ? '&' : ''}page=${p}`
  const nums = Array.from(new Set([1, page - 2, page - 1, page, page + 1, page + 2, pages])).filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b)
  return (
    <div className="row mt8" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <span className="small muted">{label}</span>
      {nums.map((p, i) => <span key={p} className="row" style={{ gap: 6 }}>{i > 0 && p - nums[i - 1] > 1 ? <span className="muted">…</span> : null}<Link className={'chip' + (p === page ? ' on' : '')} href={at(p)}>{p}</Link></span>)}
    </div>
  )
}
export const PAGE_SIZE = 100
export const pageOf = (raw: string | undefined, total: number, size = PAGE_SIZE) => {
  const pages = Math.max(1, Math.ceil(total / size)), page = Math.min(pages, Math.max(1, Number(raw) || 1))
  return { page, pages, from: (page - 1) * size, to: page * size }
}
