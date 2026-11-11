import { isExternal } from '@/lib/perm'
import { requireCtx } from '@/lib/auth'
import { t, dateTime, tzOf } from '@/lib/i18n'
import { ROLE_NAMES } from '@/lib/perm'
import { one } from '@/lib/db'
import { Top } from '@/components/ui'
import { setOwnLocale, saveNotifyPrefs, linkTelegram } from '@/lib/actions'
import { PasswordForm, PinForm } from './form'

// Профиль: свой пароль (временный из письма или от админа меняют здесь), PIN режима показа, язык по умолчанию
export default async function Profile() {
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const TZ = tzOf(c.user.market) // время — в поясе рынка пользователя
  const bot = process.env.TG_BOT_NAME, mail = !!process.env.SMTP_URL && process.env.SMTP_URL !== 'log'
  const u = c.real
  const me = await one<{ last_login_at: string | null; agency: string | null; curator: string | null; notify_email: boolean; notify_telegram: boolean; notify_digest: boolean; telegram_chat_id: string | null; tg_link_code: string | null }>(`select u.last_login_at, a.name agency, cu.name curator, u.notify_email, u.notify_telegram, u.notify_digest, u.telegram_chat_id, u.tg_link_code from portal.users u
    left join portal.agencies a on a.id = u.agency_id left join portal.users cu on cu.id = u.curator_id where u.id = $1`, [u.id])
  return (
    <>
      <Top title={T('Профиль')} sub={`${u.name} · ${T(ROLE_NAMES[u.role])}${u.market ? ' · ' + u.market : ''}`} />
      <div className="page">
        {c.impersonating && <div className="note" style={{ marginBottom: 16 }}>{T('Это ваш профиль, а не профиль пользователя, от имени которого вы смотрите портал.')}</div>}
        <div className="grid g3" style={{ alignItems: 'start' }}>
          <div className="card stack" style={{ gap: 8 }}>
            <div className="h3" style={{ margin: 0 }}>{T('Аккаунт')}</div>
            <div className="kv"><span>E-mail</span><span className="small">{u.email}</span></div>
            {me?.agency && <div className="kv"><span>{T('Агентство')}</span><span>{me.agency}</span></div>}
            {me?.curator && <div className="kv"><span>{T('Куратор')}</span><span>{me.curator}</span></div>}
            {/* Л5: «Последний вход —» не показываем; язык — подписанное поле с кнопкой «Сохранить» */}
            {me?.last_login_at && <div className="kv"><span>{T('Последний вход')}</span><span className="small">{dateTime(L, me.last_login_at, TZ)}</span></div>}
            <form action={setOwnLocale} className="row mt8" style={{ alignItems: 'flex-end' }}>
              <label className="field" style={{ flex: 1 }}><span>{T('Язык писем и уведомлений')}</span><select key={`locale:${String(u.locale)}`} className="in" name="locale" defaultValue={u.locale}>{['ru', 'en', 'de', 'he'].map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select></label>
              <button className="btn">{T('Сохранить')}</button>
            </form>
            <div className="tiny muted">{T('Сменить e-mail, роль или агентство может администратор.')}</div>
          </div>
          <PasswordForm lang={L} />
          {!isExternal(c.user.role) && <PinForm lang={L} />}{/* 279: партнёру PIN не нужен */}
        </div>
        {!c.impersonating && <div className="grid g2 mt16" style={{ alignItems: 'start' }}>
          <form action={saveNotifyPrefs} className="card stack" style={{ gap: 8 }}>
            <div className="h3" style={{ margin: 0 }}>{T('Уведомления вне портала')}</div>
            <div className="tiny muted">{T('Срочные (брони, KYC, выплаты, доступ, споры, фиксация) — сразу. Остальные — сводкой раз в день в 9:00 по Баку.')}</div>
            <label className="check"><input type="checkbox" name="email" value="1" defaultChecked={me?.notify_email && mail} disabled={!mail} /> <span>{T('На e-mail')} {u.email}{!mail ? ' · ' + T('почта ещё не подключена') : ''}</span></label>
            <label className="check"><input type="checkbox" name="telegram" value="1" defaultChecked={me?.notify_telegram && !!me?.telegram_chat_id} disabled={!me?.telegram_chat_id} /> <span>{T('В Telegram')}{!me?.telegram_chat_id ? ' · ' + T('сначала подключите бота') : ''}</span></label>
            <label className="check"><input type="checkbox" name="digest" value="1" defaultChecked={me?.notify_digest} /> <span>{T('Ежедневная сводка по остальным событиям')}</span></label>
            <div><button className="btn btn--sm">{T('Сохранить')}</button></div>
          </form>
          <div className="card stack" style={{ gap: 8 }}>
            <div className="h3" style={{ margin: 0 }}>Telegram</div>
            {me?.telegram_chat_id ? <>
              <div className="small okc">{T('Бот подключён — уведомления приходят в Telegram.')}</div>
              <form action={linkTelegram}><input type="hidden" name="unlink" value="1" /><button className="btn btn--sm">{T('Отключить')}</button></form>
            </> : !bot ? <div className="small muted">{T('Бот портала ещё не подключён — кнопка появится, когда его настроит администратор.')}</div>
            : me?.tg_link_code ? <>
              <a className="btn btn--p" href={`https://t.me/${bot}?start=${me.tg_link_code}`} target="_blank" rel="noopener">{T('Открыть бота @{b} и нажать «Start»', { b: bot })}</a>
              <div className="tiny muted">{T('После «Start» обновите страницу через минуту — бот подтвердит подключение.')}</div>
            </> : <form action={linkTelegram}><button className="btn btn--p btn--sm">{T('Подключить Telegram')}</button></form>}
          </div>
        </div>}
      </div>
    </>
  )
}
