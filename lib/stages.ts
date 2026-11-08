// Стадии воронки и правила переходов — общие для сервера (проверка) и браузера (подсветка колонок при перетаскивании)
import type { Role } from './perm'

export const STAGES: [string, string][] = [
  ['lead', 'Новый лид'], ['contact', 'Первый контакт'], ['qualify', 'Квалификация'], ['selection', 'Подборка'], ['fixation', 'Фиксация у застройщика'],
  ['viewing', 'Показ'], ['booking', 'Бронь'], ['kyc', 'KYC'], ['contract', 'Договор'], ['payments', 'Платежи'], ['fee', 'Вознаграждение получено'], ['support', 'Сопровождение'], ['handed', 'Сдана'],
]
// Воронка агента — 8 стадий поверх стадий команды: [ключ, название, стадии команды, кто переводит]; переход в группу = первая её стадия
export const AGENT_STAGES: [string, string, string[], string][] = [
  ['new', 'Новый', ['lead', 'contact'], 'агент'], ['fix', 'Фиксация', ['fixation'], 'команда'], ['qual', 'Квалификация', ['qualify'], 'агент'],
  ['sel', 'Подборка', ['selection'], 'агент'], ['view', 'Показ', ['viewing'], 'агент + офис'], ['book', 'Бронь', ['booking', 'kyc'], 'агент'],
  ['contract', 'Договор', ['contract', 'payments'], 'команда'], ['fee', 'Комиссия', ['fee', 'support', 'handed'], 'команда'],
]
// 2.2 · Стадии клиента партнёра = стадии сделки Bitrix24 (§6 П8): партнёр сам двигает только Selection (после квалификации),
// пауза и отказ — тоже его; остальное двигает офис в Bitrix24, при конфликте побеждает Bitrix24. [ключ, название, цель перехода]
export const PARTNER_STAGES: [string, string, string][] = [
  ['candidate', 'Candidate', 'p:candidate'], ['selection', 'Selection', 'selection'], ['registration', 'Developer registration', 'p:registration'],
  ['request', 'Reservation request', 'booking'], ['reserved', 'Reserved', 'p:reserved'], ['kyc', 'KYC', 'p:kyc'], ['spa', 'SPA signed', 'p:spa'], ['won', 'Won', 'p:won'],
]
const B24_TO_P: Record<string, string> = { Selection: 'selection', 'Developer registration': 'registration', 'Reservation request': 'request', Reserved: 'reserved', KYC: 'kyc', 'SPA approval': 'spa', 'SPA signed': 'spa', Payments: 'won', Won: 'won' }
// Колонка клиента партнёра: стадия сделки Bitrix24, если сделка есть; иначе — по фактам портала
export function partnerCol(c: { b24_stage?: string | null; attach_status?: string | null; booking?: string | null; paid?: boolean; regs_sent?: boolean }) {
  if (c.b24_stage && B24_TO_P[c.b24_stage]) return B24_TO_P[c.b24_stage]
  if (c.attach_status === 'candidate') return 'candidate'
  if (c.paid) return 'won'
  if (c.booking === 'converted') return 'spa'
  if (c.booking === 'confirmed' || c.booking === 'release_pending') return 'reserved'
  if (c.booking === 'requested' || c.booking === 'queued') return 'request'
  return c.regs_sent ? 'registration' : 'selection'
}
// Причины отказа (ТЗ, «Воронка клиента саб-агента») — из них отчёт по проектам и рынкам
export const LOST_REASONS = ['дорого', 'не то место', 'купил другое', 'не выходит на связь', 'сроки сдачи', 'другое']

export type StageCtx = { stage: string; paused: boolean; hasBooking: boolean; hasDeal: boolean; qualified?: boolean }
// После квалификации клиент идёт дальше, только когда известны цель, бюджет и срок покупки (прототипы 10–11)
const AFTER_QUAL = ['selection', 'fixation', 'viewing', 'kyc', 'booking', 'contract', 'payments', 'fee', 'support', 'handed']
const TEAM_ONLY = ['fixation', 'contract', 'payments', 'fee', 'support', 'handed']
const NEED_DEAL = ['contract', 'payments', 'fee', 'support', 'handed']
const CAN_MOVE: Role[] = ['owner', 'market_head', 'seller', 'office', 'agent', 'agency_head']

// Можно ли перевести клиента в стадию: null — можно, иначе причина (ключ словаря). 'lost' и 'pause' — особые цели с причиной и датой.
export function stageBlock(role: Role, c: StageCtx, target: string): string | null {
  if (!CAN_MOVE.includes(role)) return 'Нет прав'
  if (target === 'lost' || target === 'pause') return c.stage === 'lost' && target === 'lost' ? 'Клиент уже в отказе' : null
  // 2.2: стадии, которые ведёт офис в Bitrix24 — у партнёра только просмотр (проверка до общей: иначе «Нет такой стадии» — QA 09.11)
  if (target.startsWith('p:')) return target === 'p:candidate' ? 'Кандидат становится клиентом после квалификации' : 'Эту стадию ведёт офис в Bitrix24 — она обновится сама'
  if (!STAGES.some(([k]) => k === target)) return 'Нет такой стадии'
  const ext = role === 'agent' || role === 'agency_head'
  if (c.qualified === false && AFTER_QUAL.includes(target) && !AFTER_QUAL.includes(c.stage)) return 'Сначала заполните квалификацию: цель, бюджет, срок, страна и язык'
  if (ext) {
    if (TEAM_ONLY.includes(c.stage)) return 'Этот этап ведёт команда'
    if (TEAM_ONLY.includes(target)) return 'Фиксацию, договор и комиссию переводит команда.'
    if ((target === 'booking' || target === 'kyc') && !c.hasBooking) return 'Бронь ставится на квартиру — из шахматки или карточки квартиры'
    if ((c.stage === 'booking' || c.stage === 'kyc') && c.hasBooking && target !== 'booking' && target !== 'kyc') return 'Сначала снимите активную бронь'
    return null
  }
  if (target === 'booking' && !c.hasBooking && !c.hasDeal) return 'Бронь ставится на квартиру — из шахматки или карточки квартиры'
  if (NEED_DEAL.includes(target) && !c.hasDeal) return 'Сначала отметьте «Договор подписан» в брони'
  return null
}
export const agentGroup = (stage: string) => AGENT_STAGES.find(([, , s]) => s.includes(stage))?.[0] || 'new'
export const groupTarget = (key: string) => AGENT_STAGES.find(([k]) => k === key)?.[2][0] || 'lead'

// Статусы регистрации клиента у застройщика (§7): подпись и цвет — общие для «Регистраций» и карточки клиента
export const REG_ST: Record<string, [string, 'ok' | 'warn' | 'bad' | 'off' | 'ink']> = {
  to_send: ['К отправке', 'ink'], sent: ['Отправлено', 'warn'], confirmed: ['Подтверждено', 'ok'], confirmed_silence: ['Подтверждено молчанием', 'ok'],
  rejected: ['Отказ', 'bad'], expired: ['Истекла', 'off'], withdrawn: ['Отозвана', 'off'],
}
