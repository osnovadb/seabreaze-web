import { notFound } from 'next/navigation'
import { linkPage } from '@/lib/partnerPage'
import { t, usd, type Lang } from '@/lib/i18n'
import { LinkLeadForm } from './form'

export const dynamic = 'force-dynamic'
export const metadata = { robots: { index: false, follow: false } }

// 2.2 · §6 П8 Личная ссылка партнёра: под его брендом (имя агентства и контакты из регистрации), без наших контактов; форма — его кандидат
export default async function PartnerLink({ params, searchParams }: { params: { code: string }; searchParams: { project?: string } }) {
  const p = await linkPage(params.code)
  if (!p) notFound()
  const L = (['de', 'en', 'ru', 'he'].includes(p.lang) ? p.lang : 'de') as Lang
  const T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const brand = p.agency || p.partner
  return (
    <div dir={L === 'he' ? 'rtl' : 'ltr'} style={{ background: 'var(--paper, #faf8f4)', minHeight: '100vh' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 16px' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div className="h2" style={{ margin: 0 }}>{brand}</div>
          <div className="small muted">{p.partner}{p.agency ? '' : ''} · <a href={`mailto:${p.email}`}>{p.email}</a></div>
        </div>
        <p className="muted mt8">{T('Новостройки на Каспийском море — подбор и сопровождение сделки.')}</p>
        <div className="grid g3 mt16">{p.projects.map((x) => (
          <div key={x.id} className="card stack" style={{ gap: 6 }}>
            <div className="h3" style={{ margin: 0 }}>{x.name}</div>
            <div className="small muted">{[x.city, x.delivery && T('сдача {d}', { d: x.delivery })].filter(Boolean).join(' · ')}</div>
            <div className="small">{x.from_usd ? T('от {p}', { p: usd(L, x.from_usd) }) : T('цена по запросу')}</div>
          </div>))}</div>
        <div className="card mt24" style={{ maxWidth: 560 }}>
          <div className="h3">{T('Оставить заявку')}</div>
          <LinkLeadForm lang={L} code={p.code} projects={p.projects.map((x) => x.name)} project={p.projects.find((x) => x.slug === searchParams.project)?.name} brand={brand} />
        </div>
      </div>
    </div>
  )
}
