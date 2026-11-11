import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t, dateTime, tzOf } from '@/lib/i18n'
import { DOC_KINDS, DOC_KIND_NAMES, VARS, varAllowed, canEditTemplates } from '@/lib/docs'
import { uploadTemplate, activateTemplate } from '@/lib/docActions'
import { ActionForm } from '@/components/ActionForm'
import { Top, Pill } from '@/components/ui'

// Шаблоны документов (М8): по виду и языку, с версиями; переменные проверяются при загрузке
export default async function Templates() {
  const c = await requireCtx()
  if (!canEditTemplates(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const TZ = tzOf(c.user.market) // время — в поясе рынка пользователя
  const rows = await q<{ id: string; kind: string; lang: string; version: number; name: string; file_id: string; vars: string[]; active: boolean; created_at: string; who: string | null }>(
    `select t.id, t.kind, t.lang, t.version, t.name, t.file_id, t.vars, t.active, t.created_at, u.name who from portal.doc_templates t left join portal.users u on u.id = t.created_by order by t.kind, t.lang, t.version desc`)
  return (
    <>
      <Top title={T('Шаблоны документов')} sub={T('docx с переменными в фигурных скобках, например {unit.number}. Новая версия становится активной сразу.')} />
      <div className="page split">
        <div className="stack">
          {DOC_KINDS.map((k) => (
            <div key={k} className="card">
              <div className="h3">{T(DOC_KIND_NAMES[k])}</div>
              {['ru', 'en', 'de', 'he'].map((lg) => {
                const vs = rows.filter((r) => r.kind === k && r.lang === lg)
                return (
                  <div key={lg} className="kv"><span><b>{lg.toUpperCase()}</b></span>
                    <span className="small" style={{ textAlign: 'end' }}>{vs.length === 0 ? <span className="muted">{T('нет шаблона')}</span> : vs.map((r) => (
                      <div key={r.id} className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        <a href={`/files/${r.file_id}`}>{r.name}</a><span className="tiny muted">v{r.version} · {dateTime(L, r.created_at, TZ)}{r.who ? ' · ' + r.who : ''}</span>
                        {r.active ? <Pill kind="ok">{T('активный')}</Pill> : <form action={activateTemplate}><input type="hidden" name="id" value={r.id} /><button className="btn btn--sm">{T('Сделать активным')}</button></form>}
                      </div>))}</span></div>
                )
              })}
            </div>
          ))}
          <ActionForm action={uploadTemplate} lang={L} reset className="card stack" style={{ gap: 8 }} okText={T('Шаблон загружен и стал активным')}>
            <div className="h3" style={{ margin: 0 }}>{T('Загрузить шаблон')}</div>
            <div className="grid g3">
              <label className="field"><span>{T('Вид документа')}</span><select className="in" name="kind">{DOC_KINDS.map((k) => <option key={k} value={k}>{T(DOC_KIND_NAMES[k])}</option>)}</select></label>
              <label className="field"><span>{T('Язык')}</span><select className="in" name="lang">{['ru', 'en', 'de', 'he'].map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select></label>
              <label className="field"><span>{T('Название')}</span><input className="in" name="name" placeholder={T('Оферта брони, ред. юриста')} /></label>
            </div>
            <input className="in" type="file" name="file" accept=".docx" required style={{ paddingTop: 6 }} />
            <div><button className="btn btn--p">{T('Загрузить')}</button></div>
          </ActionForm>
        </div>
        <div className="card">
          <div className="h3">{T('Переменные')}</div>
          {Object.entries(VARS).map(([k, d]) => (
            <div key={k} className="kv"><span><code>{'{' + k + '}'}</code></span><span className="small">{T(d)}{!varAllowed('fixation_act', k) ? <div className="tiny muted">{T('только документы по брони')}</div> : !varAllowed('booking_offer', k) ? <div className="tiny muted">{T('только акт фиксации')}</div> : null}</span></div>
          ))}
        </div>
      </div>
    </>
  )
}
