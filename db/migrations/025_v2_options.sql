-- v2 · Группа 4: опции — платные дополнения к квартире (отделка, мебель, кондиционеры, место в паркинге без номера).
-- В отличие от Profitbase, у опции своя валюта и список объектов; в бронь опции пишутся отдельно и не входят в базу комиссии.
create table if not exists portal.unit_options (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  title text not null,
  note text,
  price numeric(14,2) not null check (price > 0),
  currency char(3) not null check (currency in ('USD','AZN','EUR')),
  building_ids uuid[] not null default '{}',   -- пусто — весь проект
  unit_types text[] not null default '{}',     -- пусто — все типы
  unit_ids uuid[] not null default '{}',       -- пусто — все квартиры
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists unit_options_project_idx on portal.unit_options (project_id) where active;
alter table portal.bookings add column if not exists options jsonb not null default '[]';
alter table portal.bookings add column if not exists options_usd numeric(14,2) not null default 0;
