import Link from 'next/link'
import { t } from '@/lib/i18n'
import { AuthLayout, authLang } from '@/components/AuthLayout'
import { ForgotForm } from './form'

export default function Forgot({ searchParams }: { searchParams: { lang?: string } }) {
  const lang = authLang(searchParams.lang)
  const T = (s: string) => t(lang, s)
  return (
    <AuthLayout lang={lang}>
      <h1 className="h2" style={{ fontSize: 30, marginTop: 64 }}>{T('Восстановление пароля')}</h1>
      <p className="muted">{T('Укажите e-mail, с которым входите в портал, — пришлём ссылку для нового пароля.')}</p>
      <ForgotForm lang={lang} />
      <div className="small mt16"><Link className="bronze" href={`/login?lang=${lang}`}>← {T('Вход')}</Link></div>
    </AuthLayout>
  )
}
