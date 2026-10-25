import type { User } from './auth'

// Какие клиенты видит пользователь (условие SQL для таблицы с алиасом cl), параметр $1 = user id
export function clientScope(u: User): { sql: string; params: unknown[] } {
  switch (u.role) {
    case 'owner': case 'office': return { sql: 'true', params: [] }
    case 'market_head': return { sql: 'cl.market = $1', params: [u.market] }
    case 'seller': return { sql: '(cl.owner_id = $1 or cl.owner_id in (select id from portal.users where curator_id = $1))', params: [u.id] }
    case 'agency_head': return { sql: 'cl.agency_id = $1', params: [u.agency_id] }
    case 'agent': return { sql: 'cl.owner_id = $1', params: [u.id] }
    default: return { sql: 'false', params: [] }
  }
}
// Брони: агент — свои, руководитель агентства — агентства, продавец — свои и агентов, команда — все
export function bookingScope(u: User): { sql: string; params: unknown[] } {
  switch (u.role) {
    case 'owner': case 'office': case 'finance': return { sql: 'true', params: [] }
    case 'market_head': return { sql: '(select market from portal.clients where id = b.client_id) = $1', params: [u.market] }
    case 'seller': return { sql: '(b.agent_id = $1 or b.agent_id in (select id from portal.users where curator_id = $1))', params: [u.id] }
    case 'agency_head': return { sql: 'b.agent_id in (select id from portal.users where agency_id = $1)', params: [u.agency_id] }
    default: return { sql: 'b.agent_id = $1', params: [u.id] }
  }
}
