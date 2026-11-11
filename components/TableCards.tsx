'use client'
import { useEffect } from 'react'

// В7 (ревью 10.11): широкие таблицы. На телефоне (≤ 640 px) таблица .tbl становится карточками: у каждой ячейки — подпись колонки
// (data-l из шапки), колонка действий — первой. На любом экране у таблицы, которая не влезла, — тень у края, где есть ещё колонки.
// Не трогаем таблицы с .tbl--keep (шахматка, сетки, где карточки бессмысленны).
export function TableCards() {
  useEffect(() => {
    let t = 0
    const mark = () => {
      document.querySelectorAll<HTMLTableElement>('table.tbl:not(.tbl--keep)').forEach((tb) => {
        const heads = Array.from(tb.tHead?.rows[0]?.cells || []).map((c) => (c.textContent || '').trim())
        if (!heads.length) return
        tb.classList.add('tbl--cards')
        Array.from(tb.tBodies).forEach((b) => Array.from(b.rows).forEach((r) => {
          let i = 0
          Array.from(r.cells).forEach((c) => { const l = heads[i] || ''; if (c.dataset.l !== l) c.dataset.l = l; i += c.colSpan || 1 })
        }))
      })
      document.querySelectorAll<HTMLElement>('.tbl-wrap').forEach((w) => {
        const more = w.scrollWidth - w.clientWidth > 4
        w.classList.toggle('is-wide', more)
        w.classList.toggle('at-end', !more || Math.abs(w.scrollLeft) + w.clientWidth >= w.scrollWidth - 4)
      })
    }
    const later = () => { cancelAnimationFrame(t); t = requestAnimationFrame(mark) }
    mark()
    const mo = new MutationObserver(later)
    mo.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', later)
    document.addEventListener('scroll', (e) => { if ((e.target as HTMLElement)?.classList?.contains('tbl-wrap')) later() }, true)
    return () => { mo.disconnect(); window.removeEventListener('resize', later); cancelAnimationFrame(t) }
  }, [])
  return null
}
