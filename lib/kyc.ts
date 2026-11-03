// KYC клиента: что нужно для отправки на проверку. Решение принимает офис в Баку или владелец, не тот, кто ведёт клиента.
export const KYC_DOCS = ['passport', 'address', 'funds'] as const
export const KYC_DOC_NAMES: Record<string, string> = { passport: 'паспорт', address: 'подтверждение адреса', funds: 'происхождение средств' }
export const canReviewKyc = (role: string) => role === 'office' || role === 'owner'
export type KycFields = { kyc_citizenship: string | null; kyc_tax_residence: string | null; kyc_pep: boolean | null }
// Чего не хватает для отправки: документы по видам и поля анкеты
export function kycMissing(docKinds: string[], cl: KycFields): string[] {
  const miss: string[] = KYC_DOCS.filter((k) => !docKinds.includes(k)).map((k) => KYC_DOC_NAMES[k])
  if (!cl.kyc_citizenship) miss.push('гражданство')
  if (!cl.kyc_tax_residence) miss.push('налоговое резидентство')
  if (cl.kyc_pep == null) miss.push('ответ про PEP')
  return miss
}
