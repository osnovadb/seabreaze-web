import { cookies } from 'next/headers'
import Link from 'next/link'
import { t, isRtl, type Lang } from '@/lib/i18n'
import { LoginForm } from './form'
import { LangSwitch } from '@/components/LangSwitch'

// Ссылки с сайтов рынков: ?lang=de&market=DE — язык и рынок выбраны заранее
export default function Login({ searchParams }: { searchParams: { lang?: string; market?: string } }) {
  const ql = ['ru', 'en', 'de', 'he'].includes(searchParams.lang || '') ? searchParams.lang : null
  const lang = (ql || cookies().get('ge_lang')?.value || 'ru') as Lang
  const T = (s: string) => t(lang, s)
  return (
    <div className="auth" dir={isRtl(lang) ? 'rtl' : 'ltr'}>
      <div className="auth__brand">
        <img src="/brand/wordmark-white.svg" alt="GetsEstate" style={{ height: 28 }} />
        <div className="label" style={{ color: 'var(--mist-2)', marginTop: 10 }}>{T('Партнёрский портал')}</div>
        <h2>{T('Каталог, брони и комиссия по Sea Breeze — в одном месте')}</h2>
        <div className="stack mt24" style={{ gap: 10 }}>
          {['Свободные квартиры и цены застройщиков', 'Закрепление клиента с первой регистрации', 'Бронь онлайн и подборки на языке клиента', 'Комиссия по каждой сделке — прозрачно'].map((x) => <div key={x}>— {T(x)}</div>)}
        </div>
        <div className="small" style={{ marginTop: 40, color: 'var(--mist-2)' }}>{T('Тестовый стенд · данные тестовые')}</div>
      </div>
      <div className="auth__form">
        <div className="between"><span /><LangSwitch light lang={lang} /></div>
        <h1 className="h2" style={{ fontSize: 30, marginTop: 64 }}>{T('Вход')}</h1>
        <p className="muted">{T('Для команды GetsEstate и партнёров. Вход по коду из письма появится позже — сейчас по паролю.')}</p>
        <LoginForm lang={lang} />
        <div className="card card--sand mt32">
          <div className="h3">{T('Ещё не партнёр?')}</div>
          <p className="muted small">{T('Оставьте заявку — ответим за 2 рабочих дня. Доступ к каталогу — после проверки и договора.')}</p>
          <Link className="btn mt8" href="/apply">{T('Стать партнёром')}</Link>
        </div>
      </div>
    </div>
  )
}
