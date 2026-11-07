// KYC и KYB (2.2): главный покупатель — сам клиент (анкета в карточке), созаёмщики и компания — в portal.buyers.
// Минимум (решение 251): паспорт каждого покупателя и подтверждение адреса; компания — выписка из реестра, бенефициары, паспорт директора.
// Решение принимает бэк-офис (офис в Баку) или владелец, не тот, кто ведёт клиента.
export const KYC_DOCS = ['passport', 'address'] as const
export const KYB_DOCS = ['registry', 'ubo', 'director'] as const
export const KYC_DOC_NAMES: Record<string, string> = { passport: 'паспорт', address: 'подтверждение адреса', funds: 'происхождение средств', registry: 'выписка из реестра', ubo: 'бенефициары', director: 'паспорт директора' }
export const canReviewKyc = (role: string) => role === 'office' || role === 'owner'
export type KycFields = { kyc_citizenship: string | null; kyc_tax_residence: string | null; kyc_pep: boolean | null }
export type Buyer = { id: string; kind: 'person' | 'company'; name: string; citizenship: string | null; tax_residence: string | null; pep: boolean | null; reg_no: string | null; ubo: string | null }
// Чего не хватает для отправки. docs — документы клиента с привязкой к покупателю (buyer_id null — главный покупатель)
export function kycMissing(docs: { kind: string; buyer_id?: string | null }[] | string[], cl: KycFields, buyers: Buyer[] = []): string[] {
  const list = (docs as (string | { kind: string; buyer_id?: string | null })[]).map((d) => (typeof d === 'string' ? { kind: d, buyer_id: null } : d))
  const has = (kind: string, b: string | null) => list.some((d) => d.kind === kind && (d.buyer_id || null) === b)
  const miss: string[] = KYC_DOCS.filter((k) => !has(k, null)).map((k) => KYC_DOC_NAMES[k])
  if (!cl.kyc_citizenship) miss.push('гражданство')
  if (!cl.kyc_tax_residence) miss.push('налоговое резидентство')
  if (cl.kyc_pep == null) miss.push('ответ про PEP')
  for (const b of buyers) {
    const need = b.kind === 'company' ? KYB_DOCS : KYC_DOCS
    for (const k of need) if (!has(k, b.id)) miss.push(`${b.name}: ${KYC_DOC_NAMES[k]}`)
    if (b.kind === 'person' && (!b.citizenship || b.pep == null)) miss.push(`${b.name}: гражданство и PEP`)
    if (b.kind === 'company' && (!b.reg_no || !b.ubo)) miss.push(`${b.name}: номер в реестре и бенефициары`)
  }
  return miss
}
