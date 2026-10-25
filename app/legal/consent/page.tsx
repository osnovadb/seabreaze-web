import Link from 'next/link'
import { cookies } from 'next/headers'
import { CONSENT, type LegalLang } from '@/lib/legal'

export default function Page({ searchParams }: { searchParams: { lang?: string } }) {
  const c = (searchParams.lang || cookies().get('ge_lang')?.value || 'en') as string
  const lang: LegalLang = (['ru', 'en', 'de'].includes(c) ? c : 'en') as LegalLang
  const d = CONSENT[lang]
  return (
    <div style={{ background: 'var(--sand)', minHeight: '100vh' }} dir="ltr">
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 20px 64px' }}>
        <div className="between"><img src="/brand/wordmark.svg" alt="GetsEstate" style={{ height: 24 }} /><div className="chips">{(['de', 'en', 'ru'] as const).map((l) => <Link key={l} href={'?lang=' + l} className={'chip' + (l === lang ? ' on' : '')}>{l.toUpperCase()}</Link>)}</div></div>
        <h1 className="h2" style={{ fontSize: 30, marginTop: 28 }}>{d.title}</h1>
        <div className="small muted">{d.updated}</div>
        <div className="card mt24 stack">{d.sections.map(([h, t]) => <div key={h}><div className="h3">{h}</div><p style={{ margin: '6px 0 0' }}>{t}</p></div>)}</div>
        <p className="tiny muted mt16">{lang === 'ru' ? 'Иврит — после вычитки переводчиком.' : lang === 'de' ? 'Hebräische Fassung folgt nach Prüfung.' : 'Hebrew version will follow after review.'}</p>
      </div>
    </div>
  )
}
