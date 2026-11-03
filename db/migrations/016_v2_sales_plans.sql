-- v2 · М10: план продаж агентства на месяц или квартал — по рынку, менеджеру или агентству. Факт считается из сделок.
set search_path = portal, public;
create table if not exists sales_plans (
  id           uuid primary key default gen_random_uuid(),
  period_kind  text not null check (period_kind in ('month','quarter')),
  period_start date not null,
  scope        text not null check (scope in ('market','user','agency')),
  scope_id     text not null,              -- код рынка или id пользователя / агентства
  units        int,
  area         numeric(10,2),
  revenue      numeric(14,2),              -- объём продаж, USD
  commission   numeric(14,2),              -- наш доход, USD
  updated_by   uuid references users,
  updated_at   timestamptz not null default now(),
  unique (period_kind, period_start, scope, scope_id)
);
