import { redirect, notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import { requireCtx } from '@/lib/auth'
import { t } from '@/lib/i18n'
import { hookOn } from '@/lib/b24'
import { createFromB24 } from '@/lib/b24Actions'
import { resolveClient, type Kind } from '@/lib/b24link'
import { Top } from '@/components/ui'

// 2.2 · Вкладка Units (сделка, контакт) и Selection (лид) в Bitrix24: клиент портала → его карточка с квартирами, подбором и условиями
export default async function B24Tab(
  props: { params: Promise<{ kind: string; id: string }>; searchParams: Promise<{ err?: string; nc?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const c = await requireCtx()
  const kind = params.kind as Kind
  if (!['deal', 'contact', 'lead'].includes(kind) || !/^\d+$/.test(params.id)) notFound()
  if (!['owner', 'market_head', 'seller', 'office', 'finance'].includes(c.user.role)) notFound() // вкладка Bitrix24 — только команде (QA 09.11)
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const r = await resolveClient(kind, Number(params.id))
  if (r.id) redirect(`/b24/ctx?client=${r.id}`) // запомнить клиента вкладки и открыть Units
  // Б9: клиента вкладки больше нет в общей cookie — сбрасывать нечего; без клиента портала адрес вкладки без ?cl=
  const what = kind === 'deal' ? T('Сделка') : kind === 'contact' ? T('Контакт') : T('Лид')
  return (
    <>
      <Top title={T('Units')} sub={T('{w} Bitrix24 № {n} ещё не связан с клиентом портала', { w: what, n: params.id })} />
      <div className="page">
        {!hookOn() && <div className="note">{T('Портал пока не читает карточки Bitrix24 (нет ключа обмена) — свяжите клиента вручную в карточке клиента портала.')}</div>}
        {searchParams.err === 'nophone' && <div className="err">{T('В карточке Bitrix24 нет телефона или e-mail — добавьте их, чтобы проверить «чей клиент».')}</div>}
        {r.person && (
          <div className="card stack" style={{ maxWidth: 640 }}>
            <div className="label">{T('Человек из Bitrix24')}</div>
            <div className="kv"><span>{T('Имя')}</span><span>{r.person.name}</span></div>
            <div className="kv"><span>{T('Телефон')}</span><span>{r.person.phone || '—'}</span></div>
            <div className="kv"><span>{T('E-mail')}</span><span>{r.person.email || '—'}</span></div>
            <div className="small muted">{T('Совпадений в портале нет — клиент свободен. Заведите его: он закрепится за командой на 6 месяцев и встанет в очередь регистрации у застройщиков.')}</div>
            <form action={createFromB24}><input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={params.id} /><button className="btn btn--p">{T('Завести клиента в портале')}</button></form>
          </div>
        )}
      </div>
    </>
  )
}
