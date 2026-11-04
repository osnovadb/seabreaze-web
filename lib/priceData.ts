// Данные для прайс-листов (не server action: читается только страницами и действиями на сервере)
import { q } from './db'
import { roomsSql } from './catalog'
import type { RuleUnit } from './priceRule'

export const ruleUnits = (projectId: string) => q<RuleUnit>(`select u.id, u.building_id, u.unit_type, ${roomsSql} rooms, u.layout_id, u.number, u.floor, u.status, u.price_list::float price, u.price_currency currency, coalesce(u.area_total_m2, 0)::float area
  from units u where u.project_id = $1 and u.building_id is not null`, [projectId])
