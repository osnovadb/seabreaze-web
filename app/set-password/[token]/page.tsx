import Link from 'next/link'
import { one } from '@/lib/db'
import { t } from '@/lib/i18n'
import { tokenUser } from '@/lib/access'
import { AuthLayout, authLang } from '@/components/AuthLayout'
import { SetForm } from './form'

// Ссылка из приглашения или сброса: задать пароль (и PIN режима показа, если его ещё нет) и сразу войти
export default async function SetPassword(props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const tk = await tokenUser(params.token)
  const lang = tk?.locale || authLang()
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  const needPin = tk ? !(await one<{ pin_hash: string | null }>('select pin_hash from portal.users where id = $1', [tk.user_id]))?.pin_hash : false
  return (
    <AuthLayout lang={lang}>
      {tk ? <>
        <h1 className="h2" style={{ fontSize: 30, marginTop: 64 }}>{tk.kind === 'invite' ? T('Добро пожаловать, {n}', { n: tk.name }) : T('Новый пароль')}</h1>
        <p className="muted">{T('Вход: {e}', { e: tk.email })}</p>
        <SetForm lang={lang} token={params.token} needPin={needPin} />
      </> : <>
        <h1 className="h2" style={{ fontSize: 30, marginTop: 64 }}>{T('Ссылка не действует')}</h1>
        <p className="muted">{T('Ссылка устарела или уже использована. Запросите новую — или напишите своему куратору.')}</p>
        <Link className="btn btn--p mt16" href={`/forgot?lang=${lang}`}>{T('Запросить новую ссылку')}</Link>
      </>}
    </AuthLayout>
  )
}
