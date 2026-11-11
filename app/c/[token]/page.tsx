import { notFound } from 'next/navigation'
import { one } from '@/lib/db'
import { t, type Lang } from '@/lib/i18n'
import { ConsentForm } from './form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'GetsEstate', robots: { index: false, follow: false } }

// 2.2 · §15 Страница согласия клиента: на его языке, иврит справа налево; клиентские страницы — WCAG AA (273)
export default async function Consent(
  props: { params: Promise<{ token: string }>; searchParams: Promise<{ lang?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const cl = await one<{ name: string; language: string | null; consent_status: string; marketing: boolean; brand: string | null }>(
    `select c.name, c.language, c.consent_status, c.marketing_consent_at is not null marketing, case when c.owner_type = 'partner' then coalesce(a.name, u.name) end brand
     from portal.clients c join portal.users u on u.id = c.owner_id left join portal.agencies a on a.id = c.agency_id where c.consent_token = $1 and c.anonymized_at is null`, [params.token])
  if (!cl) notFound()
  const L = (['ru', 'en', 'de', 'he'].includes(searchParams.lang || '') ? searchParams.lang : ['ru', 'en', 'de', 'he'].includes(cl.language || '') ? cl.language : 'en') as Lang
  const T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  return (
    <main dir={L === 'he' ? 'rtl' : 'ltr'} lang={L} style={{ maxWidth: 620, margin: '0 auto', padding: '40px 16px', minHeight: '100vh' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 className="h2" style={{ margin: 0 }}>{cl.brand || 'GetsEstate'}</h1>
        <nav className="small" aria-label={T('Язык')}>{['de', 'en', 'ru', 'he'].map((x) => <a key={x} href={`?lang=${x}`} style={{ marginInlineStart: 8, fontWeight: x === L ? 700 : 400 }}>{x.toUpperCase()}</a>)}</nav>
      </div>
      <p className="mt16">{T('Здравствуйте, {n}!', { n: cl.name })}</p>
      <p>{cl.brand ? T('{b} работает с GetsEstate — агентством новостроек в Баку. Чтобы подобрать для вас квартиры и зарегистрировать вас у застройщиков, нам нужно ваше согласие.', { b: cl.brand }) : T('Чтобы подобрать для вас квартиры и зарегистрировать вас у застройщиков, нам нужно ваше согласие.')}</p>
      <ConsentForm lang={L} token={params.token} status={cl.consent_status} marketing={cl.marketing} ads={!cl.brand} />
      <p className="tiny muted mt24"><a href="/legal/privacy" target="_blank">{T('Политика конфиденциальности')}</a> · {T('Данные хранятся в ЕС. Отозвать согласие можно в любой момент по этой же ссылке или письмом.')}</p>
    </main>
  )
}
