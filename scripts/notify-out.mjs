// Уведомления вне портала (запуск): пересылка уведомлений портала в e-mail и Telegram, ежедневная сводка,
// привязка Telegram по /start <код>, отправка очереди portal.outbox_messages. Вызывается из tick.mjs.
// SMTP_URL=log — режим проверки (письма помечаются отправленными, но не уходят; текст — в Админке). Без SMTP_URL письма ждут в очереди (приглашения и сбросы) или не создаются (пересылка); без TG_BOT_TOKEN — так же для Telegram.
import fs from 'node:fs'

const dict = Object.fromEntries(['en', 'de', 'he'].map((l) => [l, JSON.parse(fs.readFileSync(new URL(`../lib/dict/${l}.json`, import.meta.url), 'utf8'))]))
const tr = (lang, ru, vars) => String((dict[lang] || {})[ru] || ru).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? String(vars[k]) : `{${k}}`))
// Срочные виды уходят сразу; остальные — сводкой раз в день
const URGENT = ['booking', 'payout', 'access', 'kyc', 'dispute', 'fixation', 'application', 'deal']

export async function notifyOut(q, out) {
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '')
  const mail = !!process.env.SMTP_URL, tg = !!process.env.TG_BOT_TOKEN
  const api = (m, body) => fetch(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/${m}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) }).then((r) => r.json())

  // 1. Привязка Telegram: /start <код> из профиля → чат пользователя
  if (tg) {
    try {
      const off = Number((await q(`select value from portal.kv where key = 'tg_offset'`))[0]?.value || 0)
      const upd = await api('getUpdates', { offset: off + 1, timeout: 0, allowed_updates: ['message'] })
      let last = off, linked = 0
      for (const u of upd.result || []) {
        last = Math.max(last, u.update_id)
        const m = u.message, code = (m?.text || '').match(/^\/start\s+(\S+)/)?.[1]
        if (!code || !m.chat?.id) continue
        const who = (await q(`update portal.users set telegram_chat_id = $2, tg_link_code = null where tg_link_code = $1 and active returning locale`, [code, m.chat.id]))[0]
        if (who) { linked++; await q(`insert into portal.outbox_messages (channel, to_addr, body, kind) values ('telegram', $1, $2, 'notify')`, [String(m.chat.id), tr(who.locale, 'Готово: уведомления портала GetsEstate будут приходить сюда.')]) }
      }
      if (last > off) await q(`insert into portal.kv (key, value) values ('tg_offset', $1) on conflict (key) do update set value = $1, updated_at = now()`, [String(last)])
      out.tg_linked = linked
    } catch (e) { out.tg_error = String(e.message || e).slice(0, 120) }
  }

  // 2. Пересылка: срочные — сразу, остальные — в сводку не раньше 9:00 по Баку и не чаще раза в день
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baku', hour: '2-digit', hour12: false }).format(new Date()))
  const users = await q(`select u.id, u.email, u.locale, u.notify_email, u.notify_telegram, u.notify_digest, u.telegram_chat_id, u.last_digest_on, current_date today,
      json_agg(json_build_object('id', n.id, 'kind', n.kind, 'text', n.text, 'vars', n.vars, 'link', n.link) order by n.created_at) items
    from portal.notifications n join portal.users u on u.id = n.user_id
    where n.forwarded_at is null and n.created_at > now() - interval '2 days' and u.active group by u.id`)
  let queued = 0
  for (const u of users) {
    const digestNow = u.notify_digest && hour >= 9 && (!u.last_digest_on || String(u.last_digest_on) < String(u.today))
    const urgent = u.items.filter((n) => URGENT.includes(n.kind)), rest = u.items.filter((n) => !URGENT.includes(n.kind))
    const send = [...urgent.map((n) => [n]), ...(digestNow && rest.length ? [rest] : [])]
    const done = [...urgent, ...(digestNow || !u.notify_digest ? rest : [])].map((n) => n.id) // без сводки «остальные» только в портале
    const line = (n) => '• ' + tr(u.locale, n.text, n.vars || {}) + (n.link && base ? `\n  ${base}${n.link}` : '')
    for (const group of send) {
      const digest = group.length > 1 || !URGENT.includes(group[0].kind)
      const subject = digest ? tr(u.locale, 'GetsEstate: сводка за день') : tr(u.locale, 'GetsEstate: {t}', { t: tr(u.locale, group[0].text, group[0].vars || {}).slice(0, 80) })
      const body = [digest ? tr(u.locale, 'События в портале GetsEstate:') : '', ...group.map(line), '', tr(u.locale, 'Настройки уведомлений — в профиле портала.')].filter((x, i) => x || i > 0).join('\n')
      if (mail && u.notify_email && u.email) { await q(`insert into portal.outbox_messages (channel, to_addr, user_id, subject, body, kind) values ('email',$1,$2,$3,$4,'notify')`, [u.email, u.id, subject, body]); queued++ }
      if (tg && u.notify_telegram && u.telegram_chat_id) { await q(`insert into portal.outbox_messages (channel, to_addr, user_id, body, kind) values ('telegram',$1,$2,$3,'notify')`, [String(u.telegram_chat_id), u.id, (digest ? subject + '\n\n' : '') + body]); queued++ }
    }
    if (done.length) await q(`update portal.notifications set forwarded_at = now() where id = any($1)`, [done])
    if (digestNow && rest.length) await q(`update portal.users set last_digest_on = current_date where id = $1`, [u.id])
  }
  out.notify_queued = queued

  // 3. Отправка очереди: до 5 попыток; старше 7 дней без канала — «пропущено»
  await q(`update portal.outbox_messages set status = 'skipped', last_error = 'канал не подключён' where status = 'queued' and created_at < now() - interval '7 days'
    and ((channel = 'email' and $1 = false) or (channel = 'telegram' and $2 = false))`, [mail, tg])
  const jobs = await q(`select id, channel, to_addr, subject, body from portal.outbox_messages where status in ('queued','error') and attempts < 5
    and ((channel = 'email' and $1) or (channel = 'telegram' and $2)) order by created_at limit 100`, [mail, tg])
  let sent = 0, transport = null
  for (const j of jobs) {
    try {
      if (j.channel === 'email') {
        if (!transport) { const nm = (await import('nodemailer')).default; transport = nm.createTransport(process.env.SMTP_URL === 'log' ? { jsonTransport: true } : process.env.SMTP_URL) } // SMTP_URL=log — проверка без почтового сервера: письмо не уходит, текст остаётся в очереди (Админка → Почта и Telegram)
        await transport.sendMail({ from: process.env.SMTP_FROM || 'GetsEstate <no-reply@getsestate.com>', to: j.to_addr, subject: j.subject || 'GetsEstate', text: j.body })
      } else {
        const r = await api('sendMessage', { chat_id: j.to_addr, text: j.body, disable_web_page_preview: true })
        if (!r.ok) throw new Error(r.description || 'telegram')
      }
      await q(`update portal.outbox_messages set status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = null where id = $1`, [j.id]); sent++
    } catch (e) {
      await q(`update portal.outbox_messages set status = 'error', attempts = attempts + 1, last_error = $2 where id = $1`, [j.id, String(e.message || e).slice(0, 300)])
    }
  }
  out.outbox_sent = sent
  out.outbox_waiting = Number((await q(`select count(*)::int n from portal.outbox_messages where status = 'queued'`))[0].n)
}
