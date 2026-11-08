// Данные для выплат партнёра и рекомендателя: налоговый статус + банковские реквизиты (QA 09.11 — реквизитов не было вовсе)
import { one } from '@/lib/db'
import { t, usd, type Lang } from '@/lib/i18n'
import { payoutGaps } from '@/lib/money22'
import { savePayoutProfile } from '@/lib/moneyActions'

type Prof = { partner_form: string | null; vat_payer: boolean; vat_no: string | null; tax_country: string | null; tax_no: string | null; tax_cert_until: string | null
  bank_holder: string | null; bank_iban: string | null; bank_swift: string | null; bank_name: string | null }

// Баннер «выплата не пройдёт» — для главной и страниц выплат
export async function PayoutGapNote({ userId, lang, href }: { userId: string; lang: Lang; href?: string }) {
  const g = await payoutGaps(userId)
  if (!g.missing.length) return null
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  const what = g.missing.map((m) => T(m)).join(', ')
  return <div className="err">
    {g.waiting > 0 ? T('{a} ждут выплаты, но без данных платить некуда: укажите {w}.', { a: usd(lang, g.waiting), w: what }) : T('Перед первой выплатой укажите {w}.', { w: what })}
    {href && <> <a href={href}>{T('Заполнить')}</a></>}
  </div>
}

export async function PayoutProfile({ userId, lang }: { userId: string; lang: Lang }) {
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  const prof = await one<Prof>(`select partner_form, vat_payer, vat_no, tax_country, tax_no, tax_cert_until::text, bank_holder, bank_iban, bank_swift, bank_name from portal.users where id = $1`, [userId])
  return (
    <form action={savePayoutProfile} className="card stack mt24" style={{ gap: 10 }} id="payout">
      <div className="h3" style={{ margin: 0 }}>{T('Данные для выплат')}</div>
      <PayoutGapNote userId={userId} lang={lang} />
      <div className="small muted">{T('Компания или ИП — счёт против нашего акта; физлицо — акт и налоговый номер. Без документа выплата переносится на следующий месяц.')}</div>
      <div className="grid g3">
        <label className="field"><span>{T('Форма')}</span><select className="in" name="partner_form" defaultValue={prof?.partner_form || ''}><option value="">—</option><option value="company">{T('Компания')}</option><option value="sole">{T('ИП')}</option><option value="individual">{T('Физлицо')}</option></select></label>
        <label className="field"><span>{T('Налоговый номер')}</span><input className="in" name="tax_no" defaultValue={prof?.tax_no || ''} /></label>
        <label className="field"><span>{T('Страна налогового резидентства (код)')}</span><input className="in" name="tax_country" maxLength={2} defaultValue={prof?.tax_country || ''} placeholder="DE" /></label>
        <label className="field"><span>{T('Сертификат резидентства действует до')}</span><input className="in" type="date" name="tax_cert_until" defaultValue={prof?.tax_cert_until || ''} /></label>
        <label className="field"><span>{T('Номер плательщика НДС')}</span><input className="in" name="vat_no" defaultValue={prof?.vat_no || ''} /></label>
        <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" name="vat_payer" defaultChecked={!!prof?.vat_payer} /> {T('Плательщик НДС — добавлю НДС к сумме акта')}</label>
      </div>
      <div className="label mt8">{T('Банковские реквизиты')}</div>
      <div className="grid g2">
        <label className="field"><span>{T('Получатель (как в банке)')}</span><input className="in" name="bank_holder" defaultValue={prof?.bank_holder || ''} autoComplete="off" /></label>
        <label className="field"><span>{T('Банк')}</span><input className="in" name="bank_name" defaultValue={prof?.bank_name || ''} autoComplete="off" /></label>
        <label className="field"><span>IBAN</span><input className="in" name="bank_iban" defaultValue={prof?.bank_iban || ''} autoComplete="off" spellCheck={false} /></label>
        <label className="field"><span>SWIFT / BIC</span><input className="in" name="bank_swift" defaultValue={prof?.bank_swift || ''} autoComplete="off" spellCheck={false} /></label>
      </div>
      <div className="tiny muted">{T('После смены реквизитов выплата на новые — не раньше чем через 3 дня: так мы защищаем вас от подмены.')}</div>
      <div><button className="btn btn--sm btn--p">{T('Сохранить')}</button></div>
    </form>
  )
}
