'use client'
import { useState } from 'react'
import { LOST_REASONS } from '@/lib/stages'
import { t, type Lang } from '@/lib/i18n'

// Отказ — причина из списка (для отчёта), пауза — дата возврата, показ — дата показа
export function StageDialog({ lang, target, name, onOk, onCancel }: {
  lang: Lang; target: 'lost' | 'pause' | 'viewing'; name: string; onOk: (extra: { reason?: string; until?: string }) => void; onCancel: () => void
}) {
  const T = (s: string) => t(lang, s)
  const [reason, setReason] = useState('')
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  const [until, setUntil] = useState(new Date(Date.now() + (target === 'viewing' ? 3 : 30) * 86400000).toISOString().slice(0, 10))
  const ok = target === 'lost' ? !!reason : until >= (target === 'viewing' ? today : tomorrow)
  return (
    <div className="modal" onClick={onCancel}>
      <div className="card modal__box stack" style={{ gap: 12 }} onClick={(e) => e.stopPropagation()}>
        <div className="h3" style={{ margin: 0 }}>{target === 'lost' ? T('Отказ') : target === 'viewing' ? T('Показ') : T('Пауза')} · {name}</div>
        {target === 'lost'
          ? <div className="chips">{LOST_REASONS.map((r) => <button key={r} type="button" className={'chip' + (reason === r ? ' on' : '')} onClick={() => setReason(r)}>{T(r)}</button>)}</div>
          : <label className="field"><span>{target === 'viewing' ? T('Дата показа') : T('Пауза до (дата возврата)')}</span><input className="in" type="date" min={target === 'viewing' ? today : tomorrow} value={until} onChange={(e) => setUntil(e.target.value)} /></label>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onCancel}>{T('Отмена')}</button>
          <button type="button" className="btn btn--p" disabled={!ok} onClick={() => onOk(target === 'lost' ? { reason } : { until })}>{T('Сохранить')}</button>
        </div>
      </div>
    </div>
  )
}
