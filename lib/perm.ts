// Роли и права портала (матрица из ТЗ). Проверяется на сервере.
export type Role = 'owner' | 'market_head' | 'seller' | 'office' | 'finance' | 'content' | 'agency_head' | 'agent'

export const ROLE_NAMES: Record<Role, string> = {
  owner: 'Владелец', market_head: 'Руководитель рынка', seller: 'Продавец', office: 'Офис в Баку',
  finance: 'Финансы', content: 'Контент', agency_head: 'Руководитель агентства', agent: 'Саб-агент',
}

export const isExternal = (r: Role) => r === 'agent' || r === 'agency_head'
export const isTeam = (r: Role) => !isExternal(r)

// Что видит пользователь в шахматке: полные статусы или только «свободно/недоступно»
export const seesAllStatuses = (r: Role) => ['owner', 'market_head', 'seller', 'office', 'finance', 'content'].includes(r)
export const seesSource = (r: Role) => ['owner', 'market_head', 'seller', 'office'].includes(r)
export const seesDeveloperTerms = (r: Role) => ['owner', 'market_head', 'finance'].includes(r)
export const canRegisterClient = (r: Role) => ['owner', 'market_head', 'seller', 'agency_head', 'agent'].includes(r)
export const canBook = (r: Role) => ['owner', 'market_head', 'seller', 'office', 'agency_head', 'agent'].includes(r)
export const canConfirmBooking = (r: Role) => ['owner', 'office'].includes(r)
export const canEditConditions = (r: Role) => r === 'owner'
export const canManageUsers = (r: Role) => r === 'owner'
export const canReviewAgents = (r: Role) => ['owner', 'market_head', 'seller'].includes(r)
export const canSeeJournal = (r: Role) => ['owner', 'market_head', 'finance'].includes(r)
export const canSeeClients = (r: Role) => ['owner', 'market_head', 'seller', 'office', 'agency_head', 'agent'].includes(r)
export const canSeeFinance = (r: Role) => ['owner', 'market_head', 'finance'].includes(r)
export const canSeeSources = (r: Role) => ['owner', 'office'].includes(r)
export const maxDiscount = (r: Role, c: { seller_self_disc: number; seller_max_disc: number; agent_pool_pct: number }) =>
  r === 'owner' || r === 'market_head' ? Number(c.seller_max_disc) : r === 'seller' ? Number(c.seller_self_disc) : Number(c.agent_pool_pct)

// Потолок скидки с согласованием: агенту — весь пул (сверх своей части — из нашей, по запросу), продавцу — порог руководителя
export const discountCeiling = (r: Role, c: { seller_max_disc: number; pool_pct: number }) =>
  r === 'agent' || r === 'agency_head' ? Number(c.pool_pct) : Number(c.seller_max_disc)
export const canApproveDiscount = (r: Role) => r === 'owner' || r === 'market_head'

// Матрица для экрана «Роли и права» (значения как в ТЗ)
export const MATRIX: [string, Record<Role, string>][] = [
  ['Шахматка: все статусы и источник', { owner: 'да', market_head: 'да', seller: 'да', office: 'да', finance: 'чтение', content: 'чтение', agency_head: '—', agent: '—' }],
  ['Шахматка: свободное и цена', { owner: 'да', market_head: 'да', seller: 'да', office: 'да', finance: 'да', content: 'да', agency_head: 'да', agent: 'да' }],
  ['Условия застройщика и пул скидки', { owner: 'да', market_head: 'свои', seller: '—', office: '—', finance: 'да', content: '—', agency_head: '—', agent: '—' }],
  ['Комиссия агента', { owner: 'да', market_head: 'свои', seller: 'свои', office: '—', finance: 'да', content: '—', agency_head: 'свои', agent: 'свои' }],
  ['Контакты клиентов', { owner: 'да', market_head: 'свои', seller: 'свои', office: 'по сделкам', finance: '—', content: '—', agency_head: 'свои', agent: 'свои' }],
  ['Регистрация клиента', { owner: 'да', market_head: 'да', seller: 'да', office: '—', finance: '—', content: '—', agency_head: 'да', agent: 'да' }],
  ['Поставить бронь', { owner: 'да', market_head: 'да', seller: 'да', office: 'да', finance: '—', content: '—', agency_head: 'да', agent: 'да' }],
  ['Подтвердить бронь у застройщика', { owner: 'да', market_head: '—', seller: '—', office: 'да', finance: '—', content: '—', agency_head: '—', agent: '—' }],
  ['Скидка клиенту', { owner: 'до 20%', market_head: 'до 20%', seller: 'до 10%', office: '—', finance: '—', content: '—', agency_head: 'своя часть пула', agent: 'своя часть пула' }],
  ['Сделки и платежи', { owner: 'да', market_head: 'свои', seller: 'свои', office: 'да', finance: 'да', content: '—', agency_head: 'стадия', agent: 'стадия' }],
  ['Выплаты агентам', { owner: 'да', market_head: 'чтение', seller: '—', office: '—', finance: 'да', content: '—', agency_head: 'свои', agent: 'свои' }],
  ['Коммерческие условия проектов', { owner: 'да', market_head: 'чтение', seller: '—', office: '—', finance: 'чтение', content: '—', agency_head: '—', agent: '—' }],
  ['Источники и синхронизация', { owner: 'да', market_head: '—', seller: '—', office: 'да', finance: '—', content: '—', agency_head: '—', agent: '—' }],
  ['Заявки и аккаунты агентов', { owner: 'да', market_head: 'да', seller: 'проверка', office: '—', finance: '—', content: '—', agency_head: 'свои сотрудники', agent: '—' }],
  ['Пользователи и роли', { owner: 'да', market_head: '—', seller: '—', office: '—', finance: '—', content: '—', agency_head: '—', agent: '—' }],
  ['Журнал действий', { owner: 'да', market_head: 'свой рынок', seller: '—', office: '—', finance: 'финансы', content: '—', agency_head: '—', agent: '—' }],
]
