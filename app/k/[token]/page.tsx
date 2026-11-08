import { notFound } from 'next/navigation'
import { q, one } from '@/lib/db'
import { t, type Lang } from '@/lib/i18n'
import { KYC_DOC_NAMES } from '@/lib/kyc'
import { ClientUpload } from './form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'GetsEstate · KYC', robots: { index: false, follow: false } }

// 2.2 · §11 П9 Загрузка документов KYC/KYB клиентом по защищённой ссылке: только загрузка, без просмотра загруженного
export default async function ClientKyc({ params, searchParams }: { params: { token: string }; searchParams: { lang?: string } }) {
  const cl = await one<{ id: string; name: string; language: string | null; kyc_status: string }>('select id, name, language, kyc_status from portal.clients where kyc_token = $1 and anonymized_at is null', [params.token])
  if (!cl) notFound()
  const buyers = await q<{ id: string; kind: string; name: string }>('select id, kind, name from portal.buyers where client_id = $1 order by created_at', [cl.id])
  const got = await q<{ kind: string; buyer_id: string | null }>('select distinct kind, buyer_id from portal.client_documents where client_id = $1', [cl.id])
  const L = (['ru', 'en', 'de', 'he'].includes(searchParams.lang || '') ? searchParams.lang : ['ru', 'en', 'de', 'he'].includes(cl.language || '') ? cl.language : 'en') as Lang
  const T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const rows = [{ id: '', kind: 'person', name: cl.name }, ...buyers]
  return (
    <main dir={L === 'he' ? 'rtl' : 'ltr'} lang={L} style={{ maxWidth: 680, margin: '0 auto', padding: '40px 16px' }}>
      <h1 className="h2">GetsEstate · KYC</h1>
      <p>{T('Здравствуйте, {n}! Для покупки по закону нужно проверить личность каждого покупателя. Загрузите документы — их увидит только наш бэк-офис; хранятся в ЕС 5 лет.', { n: cl.name })}</p>
      {rows.map((b) => {
        const need = b.kind === 'company' ? ['registry', 'ubo', 'director'] : ['passport', 'address', 'funds']
        return <section key={b.id || 'main'} className="card stack mt16" style={{ gap: 8 }}>
          <h2 className="h3" style={{ margin: 0 }}>{b.name}{b.kind === 'company' ? ' · ' + T('компания') : ''}</h2>
          {/* QA 09.11: на телефоне — по кнопке на каждый документ, без выбора вида в списке; статус рядом */}
          {need.map((k) => { const ok = got.some((g) => g.kind === k && (g.buyer_id || '') === b.id); return (
            <div key={k} className="stack" style={{ gap: 6, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
              <div className="between"><b className="small">{T(KYC_DOC_NAMES[k])}</b>{ok ? <span className="okc small">✓ {T('получено')}</span> : <span className="muted small">{k === 'funds' ? T('если попросим') : T('нужно загрузить')}</span>}</div>
              <ClientUpload lang={L} token={params.token} buyer={b.id} kinds={[[k, T(KYC_DOC_NAMES[k])]]} again={ok} />
            </div>) })}
        </section>
      })}
      <p className="tiny muted mt24">{T('Если чего-то нет под рукой — загрузите позже по этой же ссылке.')}</p>
    </main>
  )
}
