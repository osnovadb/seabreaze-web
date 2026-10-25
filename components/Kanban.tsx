'use client'
import Link from 'next/link'
import { useEffect, useRef, useState, useTransition } from 'react'
import { moveStage } from '@/lib/actions'
import { stageBlock, type StageCtx } from '@/lib/stages'
import type { Role } from '@/lib/perm'
import { t, type Lang } from '@/lib/i18n'
import { StageDialog } from './StageDialog'

export type KCol = { key: string; label: string; who?: string; target: string; empty?: string }
export type KCard = { id: string; name: string; sub: string; owner?: string; signal?: [string, string] | null; col: string; ctx: StageCtx }

// Канбан воронки: карточку тянем мышью или долгим нажатием на планшете; недоступные колонки гаснут.
// Клик без перетаскивания открывает карточку клиента. Отказ и пауза спрашивают причину или дату.
export function Kanban({ cols, cards, role, lang }: { cols: KCol[]; cards: KCard[]; role: Role; lang: Lang }) {
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  const [local, setLocal] = useState<Record<string, string>>({})
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; dx: number; dy: number; w: number } | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ id: string; key: string; target: 'lost' | 'pause' | 'viewing' } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [, start] = useTransition()
  const press = useRef<{ id: string; x: number; y: number; touch: boolean; timer?: number; el: HTMLElement } | null>(null)
  const moved = useRef(false)
  const beginRef = useRef<(x: number, y: number) => void>(() => {})
  useEffect(() => setLocal({}), [cards])
  // Автопрокрутка канбана, когда карточку подносят к краю (дальние колонки уходят за экран)
  const last = useRef({ x: 0, y: 0 })
  const board = useRef<HTMLDivElement>(null)
  const dragging = !!drag
  useEffect(() => {
    if (!dragging) return
    const h = setInterval(() => {
      const el = board.current
      if (!el) return
      const r = el.getBoundingClientRect(), { x, y } = last.current
      if (y < r.top || y > r.bottom) return
      if (x > r.right - 70) el.scrollLeft += 18
      else if (x < r.left + 70) el.scrollLeft -= 18
    }, 30)
    return () => clearInterval(h)
  }, [dragging])
  useEffect(() => { if (!toast) return; const h = setTimeout(() => setToast(null), 4000); return () => clearTimeout(h) }, [toast])

  const colOf = (c: KCard) => local[c.id] ?? c.col
  const card = (id: string) => cards.find((c) => c.id === id)!
  const targetOf = (key: string) => (key === 'lost' || key === 'pause' ? key : cols.find((c) => c.key === key)?.target || key)
  const blockFor = (id: string, key: string) => (colOf(card(id)) === key ? null : stageBlock(role, card(id).ctx, targetOf(key)))

  const move = (id: string, key: string, extra?: { reason?: string; until?: string }) => {
    const prev = colOf(card(id))
    setLocal((m) => ({ ...m, [id]: key }))
    start(async () => {
      const r = await moveStage(id, targetOf(key), extra)
      if (r.error) { setLocal((m) => ({ ...m, [id]: prev })); setToast(r.error) }
    })
  }
  const drop = (id: string, key: string | null) => {
    if (!key || key === colOf(card(id))) return
    const b = blockFor(id, key)
    if (b) return setToast(T(b))
    if (key === 'lost' || key === 'pause') return setDialog({ id, key, target: key })
    if (targetOf(key) === 'viewing') return setDialog({ id, key, target: 'viewing' })
    move(id, key)
  }

  useEffect(() => {
    const begin = (x: number, y: number) => {
      const p = press.current!
      const r = p.el.getBoundingClientRect()
      moved.current = true
      setDrag({ id: p.id, x, y, dx: p.x - r.left, dy: p.y - r.top, w: r.width })
    }
    const colAt = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest('[data-col]') as HTMLElement | null)?.dataset.col || null
    const onMove = (e: PointerEvent) => {
      const p = press.current
      if (!p) return
      const dist = Math.hypot(e.clientX - p.x, e.clientY - p.y)
      if (!drag && !moved.current) {
        if (p.touch) { if (dist > 8) { clearTimeout(p.timer); press.current = null } return }
        if (dist > 5) begin(e.clientX, e.clientY)
        return
      }
      last.current = { x: e.clientX, y: e.clientY }
      setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d))
      setOver(colAt(e.clientX, e.clientY))
    }
    const onUp = (e: PointerEvent) => {
      const p = press.current
      if (p) clearTimeout(p.timer)
      if (p && moved.current) drop(p.id, colAt(e.clientX, e.clientY))
      press.current = null
      setDrag(null); setOver(null)
      setTimeout(() => { moved.current = false }, 0)
    }
    // Во время перетаскивания на планшете страница не должна прокручиваться
    const onTouch = (e: TouchEvent) => { if (moved.current) e.preventDefault() }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('touchmove', onTouch, { passive: false })
    beginRef.current = begin
    return () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp); window.removeEventListener('touchmove', onTouch)
    }
  })

  const onDown = (e: React.PointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0) return
    const touch = e.pointerType !== 'mouse'
    press.current = { id, x: e.clientX, y: e.clientY, touch, el: e.currentTarget }
    if (touch) press.current.timer = window.setTimeout(() => { if (press.current) beginRef.current(press.current.x, press.current.y) }, 350)
  }
  const body = (c: KCard, ghost?: boolean) => (
    <>
      <b>{c.name}</b><div className="muted">{c.sub}</div>{c.owner && <div className="tiny muted">{c.owner}</div>}
      {c.signal && !ghost && <div className={c.signal[0]} style={{ marginTop: 6, fontWeight: 500 }}>{c.signal[1]}</div>}
    </>
  )
  const column = (k: string, label: string, who?: string, empty?: string, wide?: boolean) => {
    const list = cards.filter((c) => colOf(c) === k)
    const bad = drag ? blockFor(drag.id, k) : null
    return (
      <div key={k} data-col={k} className={'col' + (drag && over === k ? (bad ? ' col--no' : ' col--over') : '') + (drag && bad && colOf(card(drag.id)) !== k ? ' col--off' : '') + (wide ? ' col--wide' : '')}>
        <div className="col__h"><span>{label}</span><span className="muted">{list.length}</span></div>
        {who && <div className="col__who">{who}</div>}
        {list.map((c) => (
          <Link key={c.id} href={`/clients/${c.id}`} className={'kcard' + (drag?.id === c.id ? ' kcard--drag' : '')} draggable={false}
            onPointerDown={(e) => onDown(e, c.id)} onClick={(e) => { if (moved.current) e.preventDefault() }} onContextMenu={(e) => { if (drag) e.preventDefault() }}>
            {body(c)}
          </Link>
        ))}
        {!list.length && empty && <div className="tiny muted">{empty}</div>}
      </div>
    )
  }
  const dragged = drag && card(drag.id)
  return (
    <>
      <div ref={board} className={'kanban' + (drag ? ' kanban--drag' : '')} style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(170px, 1fr))` }}>
        {cols.map((c) => column(c.key, c.label, c.who, c.empty))}
      </div>
      <div className="grid g2 mt16">
        {column('pause', T('Пауза'), T('Перетащите сюда — спросим дату возврата'), undefined, true)}
        {column('lost', T('Отказ'), T('Перетащите сюда — спросим причину'), undefined, true)}
      </div>
      <div className="tiny muted mt8">{T('Перетаскивайте карточки между этапами; на планшете — долгим нажатием. Серые колонки сейчас недоступны.')}</div>
      {drag && dragged && <div className="kcard kcard--ghost" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }}>{body(dragged, true)}</div>}
      {dialog && <StageDialog lang={lang} target={dialog.target} name={card(dialog.id).name} onCancel={() => setDialog(null)} onOk={(extra) => { move(dialog.id, dialog.key, extra); setDialog(null) }} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  )
}
