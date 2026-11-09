'use client'
import { useActionState, useEffect, useRef, useState } from 'react'
import { t, type Lang } from '@/lib/i18n'
import { MARKS, type Mark } from '@/lib/surround'

// Редактор окружения: выбираете, что ставить (море, бассейн, дорога…), щёлкаете по картинке — появляется метка.
// Метки можно тянуть мышью; правый клик по метке — удалить. Подпись необязательна: без неё показывается название вида.
export function MarksEditor({ lang, src, initial, action, hidden, overlay }: {
  lang: Lang; src: string; initial: Mark[]; hidden: Record<string, string>
  action: (s: any, f: FormData) => Promise<{ ok?: boolean; error?: string } | null | undefined>
  overlay?: { points: number[][] }[]
}) {
  const T = (s: string) => t(lang, s)
  const [marks, setMarks] = useState<Mark[]>(initial)
  const [kind, setKind] = useState('sea')
  const [label, setLabel] = useState('')
  const [drag, setDrag] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const [st, act] = useActionState(action, null)
  const pos = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  useEffect(() => {
    if (drag == null) return
    const mv = (e: PointerEvent) => setMarks((a) => a.map((m, i) => (i === drag ? { ...m, ...pos(e) } : m)))
    const up = () => setDrag(null)
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up) }
  })
  const text = (m: Mark) => m.label || T(MARKS[m.kind]?.[1] || 'Метка')
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '250px minmax(0,1fr)', gap: 16, alignItems: 'start' }}>
      <div className="card stack" style={{ gap: 6 }}>
        <div className="label">{T('Что ставим')}</div>
        <div className="chips" style={{ gap: 4 }}>
          {Object.entries(MARKS).map(([k, [ic, n]]) => <button key={k} type="button" className={'chip' + (k === kind ? ' on' : '')} onClick={() => setKind(k)}>{ic} {T(n)}</button>)}
        </div>
        <label className="field mt8"><span>{T('Подпись (необязательно)')}</span><input className="in" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} placeholder={T('Каспийское море, ул. Нефтяников…')} /></label>
        <div className="label mt8">{T('Метки')} · {marks.length}</div>
        {marks.length === 0 && <div className="tiny muted">{T('Пока нет ни одной метки.')}</div>}
        {marks.map((m, i) => (
          <div key={i} className="between small"><span>{MARKS[m.kind]?.[0]} {text(m)}</span><button type="button" className="btn btn--sm" onClick={() => setMarks((a) => a.filter((_, j) => j !== i))}>×</button></div>
        ))}
        <form action={act} className="stack mt8" style={{ gap: 6 }}>
          {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input type="hidden" name="marks" value={JSON.stringify(marks)} />
          <button className="btn btn--p">{T('Сохранить окружение')}</button>
          {st?.error && <div className="err tiny">{st.error}</div>}
          {st?.ok && <div className="tiny okc">{T('Сохранено')}</div>}
        </form>
        <div className="tiny muted mt8">{T('Щелчок по картинке — новая метка выбранного вида. Метку можно тянуть мышью; правый клик — удалить. Партнёр видит метки на плане и «что рядом» в карточке квартиры.')}</div>
      </div>
      <div ref={box} className="mk" onPointerDown={(e) => { if (e.button === 0 && (e.target as HTMLElement).dataset.h == null) setMarks((a) => [...a, { kind, ...pos(e), ...(label.trim() ? { label: label.trim() } : {}) }]) }}>
        <img src={src} alt="" draggable={false} />
        {overlay && <svg viewBox="0 0 1 1" preserveAspectRatio="none">{overlay.map((o, i) => <polygon key={i} points={o.points.map((p) => p.join(',')).join(' ')} className="mk__off" />)}</svg>}
        {marks.map((m, i) => (
          <span key={i} data-h="1" className="smark smark--edit" style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
            onPointerDown={(e) => { e.stopPropagation(); if (e.button === 0) setDrag(i) }}
            onContextMenu={(e) => { e.preventDefault(); setMarks((a) => a.filter((_, j) => j !== i)) }}>
            <i data-h="1">{MARKS[m.kind]?.[0]}</i><b data-h="1">{text(m)}</b>
          </span>
        ))}
      </div>
    </div>
  )
}
