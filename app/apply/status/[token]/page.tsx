import { notFound } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import { one } from '@/lib/db'
import { t, date, LANGS, type Lang } from '@/lib/i18n'
import { LangSwitch } from '@/components/LangSwitch'

// Статус заявки партнёра для заявителя (М13): по ссылке с токеном, без входа. Без внутренних комментариев проверяющих.
const STEPS: [string, string][] = [['new', 'Заявка получена'], ['review', 'Проверка документов'], ['contract', 'Договор'], ['approved', 'Доступ открыт']]
export const dynamic = 'force-dynamic'
export default async function ApplyStatus(
  props: { params: Promise<{ token: string }>; searchParams: Promise<{ lang?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  if (!/^[0-9a-f]{24}$/.test(params.token)) notFound()
  const a = await one<{ name: string; status: string; created_at: string; market: string }>('select name, status, created_at, market from portal.agent_applications where status_token = $1', [params.token])
  if (!a) notFound()
  const lc = (await cookies()).get('ge_lang')?.value as Lang | undefined
  const al = ((await headers()).get('accept-language') || '').slice(0, 2) as Lang
  const ql = searchParams.lang as Lang | undefined
  const L: Lang = lc && LANGS.includes(lc) ? lc : ql && LANGS.includes(ql) ? ql : LANGS.includes(al) ? al : a.market === 'IL' ? 'he' : a.market === 'DE' ? 'de' : 'en'
  const T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const idx = STEPS.findIndex(([k]) => k === a.status)
  return (
    <div dir={L === 'he' ? 'rtl' : 'ltr'} style={{ background: 'var(--sand)', minHeight: '100vh' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '40px 20px' }}>
        <div className="between"><img src="/brand/wordmark.svg" alt="GetsEstate" style={{ height: 24 }} /><LangSwitch lang={L} order={['de', 'en', 'ru', 'he']} /></div>
        <h1 className="h2 mt24">{T('Заявка партнёра')}</h1>
        <p className="muted">{a.name} · {T('отправлена {d}', { d: date(L, a.created_at) })}</p>
        <div className="card mt16">
          {a.status === 'rejected'
            ? <div className="err">{T('К сожалению, сейчас мы не можем открыть доступ. Менеджер рынка напишет вам подробности.')}</div>
            : STEPS.map(([k, l], i) => <div key={k} className="kv"><span style={{ color: i <= idx ? 'var(--ink)' : undefined }}>{i < idx ? '✓ ' : i === idx ? '● ' : '○ '}{T(l)}</span><span className="tiny muted">{i === idx ? T('сейчас') : ''}</span></div>)}
        </div>
        <p className="tiny muted mt16">{T('Обычно проверка занимает до 2 рабочих дней. Вопросы — ответом на письмо менеджера.')}</p>
      </div>
    </div>
  )
}
