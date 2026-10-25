import { cookies } from 'next/headers'
import Link from 'next/link'
import { t, isRtl, type Lang } from '@/lib/i18n'
import { ApplyForm } from './form'
import { LangSwitch } from '@/components/LangSwitch'

// Ссылки с сайтов рынков: ?lang=de&market=DE — язык и рынок выбраны заранее
export default function Apply({ searchParams }: { searchParams: { lang?: string; market?: string } }) {
  const ql = ['ru', 'en', 'de', 'he'].includes(searchParams.lang || '') ? searchParams.lang : null
  const lang = (ql || cookies().get('ge_lang')?.value || 'de') as Lang
  const T = (s: string) => t(lang, s)
  return (
    <div className="auth" dir={isRtl(lang) ? 'rtl' : 'ltr'}>
      <div className="auth__brand">
        <img src="/brand/wordmark-white.svg" alt="GetsEstate" style={{ height: 28 }} />
        <div className="label" style={{ color: 'var(--mist-2)', marginTop: 10 }}>{T('Партнёрский портал')}</div>
        <h2>{T('Продавайте Sea Breeze своим клиентам')}</h2>
        <div className="stack mt24" style={{ gap: 10 }}>
          {['Заявка', 'Проверка продавцом рынка', 'Договор (на бумаге)', 'Доступ к проектам рынка'].map((x, i) => <div key={x}>{i + 1}. {T(x)}</div>)}
        </div>
        <div className="small" style={{ marginTop: 40, color: 'var(--mist-2)' }}>{T('Для агентов и агентств в Германии, Австрии, Швейцарии и Израиле')}</div>
      </div>
      <div className="auth__form">
        <div className="between"><Link className="small muted" href="/login">← {T('Вход')}</Link><LangSwitch light lang={lang} order={['de', 'en', 'ru', 'he']} /></div>
        <h1 className="h2" style={{ fontSize: 30, marginTop: 40 }}>{T('Заявка на партнёрство')}</h1>
        <p className="muted">{T('Ответим за 2 рабочих дня. Доступ к каталогу — после проверки и договора.')}</p>
        <ApplyForm lang={lang} market={['DE', 'IL', 'GLOBAL'].includes(searchParams.market || '') ? searchParams.market! : lang === 'he' ? 'IL' : 'DE'} />
      </div>
    </div>
  )
}
