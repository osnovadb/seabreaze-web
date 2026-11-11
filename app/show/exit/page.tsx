import { isExternal } from '@/lib/perm'
import { requireCtx } from '@/lib/auth'
import { t } from '@/lib/i18n'
import { ExitForm } from './form'

export default async function Exit() {
  const c = await requireCtx()
  const ext = isExternal(c.real.role)
  return (
    <div className="page" style={{ maxWidth: 420, margin: '60px auto' }}>
      <div className="card">
        <div className="h2">{t(c.lang, 'Выход из презентации')}</div>
        {/* 279 (Денис 11.11): партнёру PIN не спрашиваем */}
        {!ext && <p className="muted small">{t(c.lang, 'Введите PIN консультанта')}</p>}
        <ExitForm lang={c.lang} pin={!ext} />
      </div>
    </div>
  )
}
