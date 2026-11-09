import { t } from '@/lib/i18n'
import { AuthLayout, authLang } from '@/components/AuthLayout'
import { LinkForm } from './form'

// 2.2 · Рекомендатель входит без пароля: одноразовая ссылка на почту (решение 249)
export default async function LoginLink(props: { searchParams: Promise<{ lang?: string; expired?: string }> }) {
  const searchParams = await props.searchParams;
  const lang = authLang(searchParams.lang)
  const T = (s: string) => t(lang, s)
  return (
    <AuthLayout lang={lang}>
      <h1 className="h2" style={{ fontSize: 30, marginTop: 64 }}>{T('Вход для рекомендателей')}</h1>
      <p className="muted">{T('Пароль не нужен: пришлём на почту одноразовую ссылку для входа.')}</p>
      {searchParams.expired && <div className="err">{T('Ссылка устарела или уже использована — запросите новую.')}</div>}
      <LinkForm lang={lang} />
    </AuthLayout>
  )
}
