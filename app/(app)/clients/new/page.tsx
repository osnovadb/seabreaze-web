import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { t } from '@/lib/i18n'
import { isExternal, canRegisterClient } from '@/lib/perm'
import { Top } from '@/components/ui'
import { RegisterForm } from './form'

export default async function NewClient() {
  const c = await requireCtx()
  if (!canRegisterClient(c.user.role)) redirect('/')
  const T = (s: string) => t(c.lang, s)
  return (
    <>
      <Top crumbs={[[T('Клиенты'), '/clients'], [T('Новый клиент')]]} title={T('Новый клиент')} sub={T(isExternal(c.user.role) ? 'Сначала клиент, потом подборка и бронь. Клиент закрепляется за тем, кто первым его квалифицировал.' : 'Сначала клиент, потом подборка и бронь.')} />
      <div className="page"><RegisterForm lang={c.lang} ext={isExternal(c.user.role)} /></div>
    </>
  )
}
