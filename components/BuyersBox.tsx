import { t, type Lang } from '@/lib/i18n'
import { KYC_DOC_NAMES, type Buyer } from '@/lib/kyc'
import { addBuyer, removeBuyer, uploadBuyerDocPlain, kycLink } from '@/lib/kycActions'

// 2.2 · Покупатели по сделке (KYC и KYB): главный — клиент; созаёмщики и компания — здесь; документы — по каждому
export function BuyersBox({ lang, clientId, buyers, docs, locked, kycToken }: { lang: Lang; clientId: string; buyers: Buyer[]; docs: { kind: string; buyer_id: string | null }[]; locked: boolean; kycToken: string | null }) {
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  const has = (k: string, b: string | null) => docs.some((d) => d.kind === k && (d.buyer_id || null) === b)
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '')
  const Upload = ({ buyer, kinds }: { buyer: string; kinds: string[] }) => (
    <form action={uploadBuyerDocPlain} className="row" style={{ gap: 4, flexWrap: 'wrap' }}><input type="hidden" name="client" value={clientId} /><input type="hidden" name="buyer" value={buyer} />
      <select className="in" name="kind" style={{ height: 30, width: 150 }}>{kinds.map((k) => <option key={k} value={k}>{T(KYC_DOC_NAMES[k])}</option>)}</select>
      <input className="in" type="file" name="file" style={{ height: 30, paddingTop: 3, width: 170 }} /><button className="btn btn--sm">{T('Загрузить')}</button></form>
  )
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="label">{T('Покупатели')}</div>
      <div className="small"><b>{T('Главный покупатель')}</b> · {['passport', 'address'].map((k) => <span key={k} className={has(k, null) ? 'okc' : 'muted'}> {T(KYC_DOC_NAMES[k])} {has(k, null) ? '✓' : '—'}</span>)}</div>
      {!locked && <Upload buyer="" kinds={['passport', 'address', 'funds']} />}
      {buyers.map((b) => {
        const need = b.kind === 'company' ? ['registry', 'ubo', 'director'] : ['passport', 'address']
        return <div key={b.id} className="stack" style={{ gap: 4, borderTop: '1px solid var(--line)', paddingTop: 6 }}>
          <div className="row small" style={{ justifyContent: 'space-between' }}><span><b>{b.name}</b> · {T(b.kind === 'company' ? 'компания (KYB)' : 'созаёмщик')}{b.kind === 'company' ? ` · ${b.reg_no || '—'}` : ` · ${b.citizenship || '—'}${b.pep ? ' · PEP' : ''}`}</span>
            {!locked && <form action={removeBuyer}><input type="hidden" name="id" value={b.id} /><button className="btn btn--sm btn--ghost" title={T('Убрать')}>×</button></form>}</div>
          <div className="tiny">{need.map((k) => <span key={k} className={has(k, b.id) ? 'okc' : 'muted'}>{T(KYC_DOC_NAMES[k])} {has(k, b.id) ? '✓' : '—'} · </span>)}</div>
          {b.kind === 'company' && b.ubo && <div className="tiny muted">{T('Бенефициары')}: {b.ubo}</div>}
          {!locked && <Upload buyer={b.id} kinds={need} />}
        </div>
      })}
      {!locked && <details><summary className="small bronze" style={{ cursor: 'pointer' }}>{T('+ Покупатель или компания')}</summary>
        <form action={addBuyer} className="stack mt8" style={{ gap: 6 }}><input type="hidden" name="client" value={clientId} />
          <select className="in" name="kind"><option value="person">{T('созаёмщик')}</option><option value="company">{T('компания (KYB)')}</option></select>
          <input className="in" name="name" placeholder={T('Имя или название компании')} required />
          <div className="row" style={{ gap: 6 }}><input className="in" name="citizenship" placeholder={T('Гражданство / страна регистрации')} /><input className="in" name="tax_residence" placeholder={T('Налоговое резидентство')} /></div>
          <div className="row" style={{ gap: 6 }}><select className="in" name="pep"><option value="">{T('PEP — ?')}</option><option value="no">{T('не PEP')}</option><option value="yes">PEP</option></select><input className="in" name="reg_no" placeholder={T('Номер в реестре (компания)')} /></div>
          <input className="in" name="ubo" placeholder={T('Бенефициары и доли (компания)')} />
          <button className="btn btn--sm">{T('Добавить')}</button></form></details>}
      <div className="row" style={{ gap: 6, alignItems: 'center' }}>{kycToken ? <span className="tiny" style={{ wordBreak: 'break-all' }}>{T('Ссылка клиенту на загрузку')}: {base}/k/{kycToken}</span>
        : <form action={kycLink}><input type="hidden" name="client" value={clientId} /><button className="btn btn--sm btn--ghost">{T('Ссылка клиенту на загрузку документов')}</button></form>}</div>
    </div>
  )
}
