// Стадии воронки и правила переходов — общие для сервера (проверка) и браузера (подсветка колонок при перетаскивании)
import type { Role } from './perm'

export const STAGES: [string, string][] = [
  ['lead', 'Новый лид'], ['contact', 'Первый контакт'], ['qualify', 'Квалификация'], ['selection', 'Подборка'], ['fixation', 'Фиксация у застройщика'],
  ['viewing', 'Показ'], ['kyc', 'KYC'], ['booking', 'Бронь'], ['contract', 'Договор'], ['payments', 'Платежи'], ['fee', 'Вознаграждение получено'], ['support', 'Сопровождение'], ['handed', 'Сдана'],
]
// Воронка агента — 8 стадий поверх стадий команды: [ключ, название, стадии команды, кто переводит]; переход в группу = первая её стадия
export const AGENT_STAGES: [string, string, string[], string][] = [
  ['new', 'Новый', ['lead', 'contact'], 'агент'], ['fix', 'Фиксация', ['fixation'], 'команда'], ['qual', 'Квалификация', ['qualify'], 'агент'],
  ['sel', 'Подборка', ['selection'], 'агент'], ['view', 'Показ', ['viewing'], 'агент + офис'], ['book', 'Бронь', ['kyc', 'booking'], 'агент'],
  ['contract', 'Договор', ['contract', 'payments'], 'команда'], ['fee', 'Комиссия', ['fee', 'support', 'handed'], 'команда'],
]
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
  if (!STAGES.some(([k]) => k === target)) return 'Нет такой стадии'
  const ext = role === 'agent' || role === 'agency_head'
  if (c.qualified === false && AFTER_QUAL.includes(target) && !AFTER_QUAL.includes(c.stage)) return 'Сначала заполните квалификацию: цель, бюджет и срок покупки'
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
