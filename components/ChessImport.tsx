'use client'
import { useActionState } from 'react'
import { t, type Lang } from '@/lib/i18n'

type St = { ok?: boolean; error?: string; applied?: boolean; report?: { create: number; update: number; same: number; errors: string[]; errorsTotal: number } } | null
// Импорт шахматки: «Проверить» показывает, что изменится, ничего не записывая; «Загрузить» — то же одной транзакцией
export function ChessImport({ lang, projectId, action }: { lang: Lang; projectId: string; action: (s: St, f: FormData) => Promise<St> }) {
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  const [st, act] = useActionState(action, null)
  const r = st?.report
  return (
    <form action={act} className="card stack" style={{ gap: 8 }}>
      <div className="h3" style={{ margin: 0 }}>{T('Импорт шахматки из Excel')}</div>
      <input type="hidden" name="project" value={projectId} />
      <div className="small muted">{T('Выгрузите текущую шахматку, поправьте и загрузите обратно. Квартира ищется по корпусу и номеру; пустая ячейка ничего не меняет; новые номера создаются.')}</div>
      <a className="btn btn--sm" href={`/admin/objects/${projectId}/export`} style={{ alignSelf: 'flex-start' }}>{T('Выгрузить шахматку (.xlsx)')}</a>
      <input className="in" type="file" name="file" accept=".xlsx" required style={{ paddingTop: 6 }} />
      <div className="row" style={{ gap: 6 }}>
        <button className="btn btn--sm" name="mode" value="check">{T('Проверить')}</button>
        <button className="btn btn--sm btn--p" name="mode" value="apply">{T('Загрузить')}</button>
      </div>
      {st?.error && <div className="err tiny">{st.error}</div>}
      {r && <div className="small">
        <div className={st?.applied ? 'okc' : ''}>{st?.applied ? T('Загружено') + ': ' : T('Будет') + ': '}{T('новых {a} · изменится {b} · без изменений {c}', { a: r.create, b: r.update, c: r.same })}</div>
        {r.errorsTotal > 0 && <div className="err tiny mt8">{T('Ошибок: {n} — файл не загружен, исправьте строки:', { n: r.errorsTotal })}<ul style={{ margin: '4px 0 0 16px' }}>{r.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
      </div>}
      <div className="tiny muted">{T('Колонки: Корпус, Этаж, Номер, Тип, Спальни, Площадь, Терраса, Сад, Планировка, Цена, Валюта, Статус, Вид, Угловая. Нужны хотя бы Корпус и Номер.')}</div>
    </form>
  )
}
