import { planBase, schedule, type Plan } from '@/lib/plans'
import { t, usd, pct, type Lang } from '@/lib/i18n'

// Варианты оплаты квартиры с суммами: в карточке квартиры и в режиме показа (без комиссий)
export function PlanList({ plans, price, lang }: { plans: Plan[]; price: number; lang: Lang }) {
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  if (!plans.length) return null
  return (
    <div className="card">
      <div className="h3">{T('Варианты оплаты')}</div>
      {plans.map((p) => {
        const base = planBase(p, price), sc = schedule(p, base)
        return (
          <div key={p.id} className="kv">
            <span style={{ color: 'var(--ink)' }}>{p.name}{p.source_note && <div className="tiny muted">{p.source_note}</div>}</span>
            <span className="small" style={{ textAlign: 'end' }}>{sc.full
              ? <>{usd(lang, base)}{Number(p.full_payment_discount_pct) ? <div className="tiny okc">{T('скидка {p}', { p: pct(lang, Number(p.full_payment_discount_pct)) })}</div> : null}</>
              : <>{T('взнос {d}', { d: usd(lang, sc.down) })} ({pct(lang, Number(p.down_payment_pct))})<div className="tiny muted">{T('{m} × {x}', { m: sc.months, x: usd(lang, sc.monthly) })}</div></>}</span>
          </div>
        )
      })}
      <div className="tiny muted mt8">{T('Расчёт без учёта персональной скидки; график уточняется в договоре.')}</div>
    </div>
  )
}
