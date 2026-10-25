import { requireCtx } from '@/lib/auth'
import { t } from '@/lib/i18n'
import { MATRIX, ROLE_NAMES, type Role } from '@/lib/perm'
import { Top } from '@/components/ui'
import { AdminTabs } from '@/components/AdminTabs'

export default async function Roles() {
  const c = await requireCtx()
  const L = c.lang, T = (s: string) => t(L, s)
  const roles = Object.keys(ROLE_NAMES) as Role[]
  const kind = (v: string) => (v === 'да' ? 'pill--ok' : v === '—' ? 'pill--off' : 'pill--warn')
  return (
    <>
      <Top title={T('Админка')} sub={T('Роль = права + область (рынок, проект) + владение (свои, агентство, рынок, все). Права проверяет сервер.')} />
      <div className="page">
        <AdminTabs lang={L} on="roles" role={c.user.role} />
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>{T('Действие или данные')}</th>{roles.map((r) => <th key={r} style={{ whiteSpace: 'normal', minWidth: 90 }}>{T(ROLE_NAMES[r])}</th>)}</tr></thead>
          <tbody>{MATRIX.map(([a, m]) => <tr key={a}><td>{T(a)}</td>{roles.map((r) => <td key={r}><span className={`pill ${kind(m[r])}`}>{T(m[r])}</span></td>)}</tr>)}</tbody>
        </table></div>
        <div className="small muted mt8">{T('Режим показа клиенту — не роль, а состояние сессии агента или продавца: скрыто всё рабочее, выход по PIN.')}</div>
      </div>
    </>
  )
}
