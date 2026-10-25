'use client'
import { useEffect, useState, useTransition } from 'react'
import { moveStage } from '@/lib/actions'
import { stageBlock, type StageCtx } from '@/lib/stages'
import type { Role } from '@/lib/perm'
import { t, type Lang } from '@/lib/i18n'
import { StageDialog } from './StageDialog'

// Шаги воронки в карточке клиента: клик по этапу переводит клиента (по тем же правилам, что и канбан)
export function StageStepper({ clientId, name, steps, current, ctx, role, lang }: {
  clientId: string; name: string; steps: { key: string; label: string; target: string }[]; current: number; ctx: StageCtx; role: Role; lang: Lang
}) {
  const T = (s: string) => t(lang, s)
  const [pending, start] = useTransition()
  const [cur, setCur] = useState(current)
  const [dialog, setDialog] = useState<'lost' | 'pause' | 'viewing' | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  useEffect(() => setCur(current), [current])
  useEffect(() => { if (!toast) return; const h = setTimeout(() => setToast(null), 4000); return () => clearTimeout(h) }, [toast])
  const go = (target: string, idx: number, extra?: { reason?: string; until?: string }) => {
    const prev = cur
    if (idx >= 0) setCur(idx)
    start(async () => {
      const r = await moveStage(clientId, target, extra)
      if (r.error) { setCur(prev); setToast(r.error) }
    })
  }
  const inactive = ctx.paused || ctx.stage === 'lost'
  return (
    <div className="card card--tight">
      <div className="steps" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr)) auto` }}>
        {steps.map((s, i) => {
          const block = i === cur && !inactive ? null : stageBlock(role, ctx, s.target)
          const cls = inactive ? '' : i < cur ? ' step--done' : i === cur ? ' step--cur' : ''
          return (
            <button key={s.key} type="button" className={'step' + cls + (block ? ' step--no' : '')} disabled={pending || (i === cur && !inactive)}
              title={block ? T(block) : i === cur && !inactive ? T('Текущий этап') : T('Перевести на этот этап')}
              onClick={() => (block ? setToast(T(block)) : s.target === 'viewing' ? setDialog('viewing') : go(s.target, i))}>
              <div className="step__l">{s.label}</div><div className="step__bar" />
            </button>
          )
        })}
        <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          <button type="button" className="btn btn--sm" disabled={pending} onClick={() => setDialog('pause')}>{T('Пауза')}</button>
          <button type="button" className="btn btn--sm" disabled={pending || ctx.stage === 'lost'} onClick={() => setDialog('lost')}>{T('Отказ')}</button>
        </div>
      </div>
      <div className="tiny muted mt8">{inactive ? T('Клиент не в работе — нажмите этап, чтобы вернуть его в воронку.') : T('Нажмите на этап, чтобы перевести клиента. Серые этапы ведёт команда или система.')}</div>
      {dialog && <StageDialog lang={lang} target={dialog} name={name} onCancel={() => setDialog(null)} onOk={(extra) => { go(dialog, dialog === 'viewing' ? steps.findIndex((x) => x.target === 'viewing') : -1, extra); setDialog(null) }} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
