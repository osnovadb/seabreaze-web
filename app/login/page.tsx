import Link from 'next/link'
import { t } from '@/lib/i18n'
import { LoginForm } from './form'
import { AuthLayout, authLang } from '@/components/AuthLayout'

// Ссылки с сайтов рынков: ?lang=de&market=DE — язык и рынок выбраны заранее
export default function Login({ searchParams }: { searchParams: { lang?: string; market?: string } }) {
  const lang = authLang(searchParams.lang)
  const T = (s: string) => t(lang, s)
  return (
    <AuthLayout lang={lang}>
      <h1 className="h2" style={{ fontSize: 30, marginTop: 64 }}>{T('Вход')}</h1>
      <p className="muted">{T('Для команды GetsEstate и партнёров.')}</p>
      <LoginForm lang={lang} />
      <div className="small mt16 row" style={{ gap: 16 }}><Link className="bronze" href={`/forgot?lang=${lang}`}>{T('Забыли пароль?')}</Link><Link className="bronze" href={`/login/link?lang=${lang}`}>{T('Рекомендатель? Войти по ссылке из письма')}</Link></div>
      <div className="card card--sand mt32">
        <div className="h3">{T('Ещё не партнёр?')}</div>
        <p className="muted small">{T('Оставьте заявку — ответим за 2 рабочих дня. Доступ к каталогу — после проверки и договора.')}</p>
        <Link className="btn mt8" href={`/apply?lang=${lang}`}>{T('Стать партнёром')}</Link>
      </div>
    </AuthLayout>
  )
}
