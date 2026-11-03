-- v2 · М6: акции застройщика и правило сложения скидок.
-- Пока ключа Profitbase нет — заводятся вручную в «Объекты → Акции»; синхронизация (М1) будет писать сюда же с source = 'profitbase'.
set search_path = portal, public;
create table if not exists special_offers (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null,
  building_id uuid,
  name        text not null,
  badge       text,
  kind        text not null check (kind in ('pct','fixed')),
  value       numeric not null check (value > 0),
  currency    char(3),                 -- для fixed: валюта проекта (как price_currency квартир)
  unit_ids    uuid[],                  -- null — все квартиры проекта или блока
  starts_on   date,
  ends_on     date,
  active      boolean not null default true,
  source      text not null default 'manual' check (source in ('manual','profitbase')),
  external_id text,
  created_by  uuid references users,
  created_at  timestamptz not null default now(),
  check (kind = 'pct' and value < 100 or kind = 'fixed' and currency is not null)
);
create index if not exists special_offers_project on special_offers (project_id) where active;
create unique index if not exists special_offers_ext on special_offers (source, external_id) where external_id is not null;
-- Как акция складывается с планом оплаты и пулом скидки: chain — по очереди, sum — проценты складываются,
-- best — берётся бо́льшая из акции и скидки за 100%, exclusive — при акции скидки из пула нет
alter table project_settings add column if not exists promo_mode text not null default 'chain' check (promo_mode in ('chain','sum','best','exclusive'));
