-- v2 · Группа 4: журнал квартиры (статус и цена, кто и откуда) и прайс-листы (черновик → публикация → откат)
create table if not exists portal.unit_events (
  id bigserial primary key,
  unit_id uuid not null,
  kind text not null check (kind in ('created','status','price')),
  old_value text, new_value text,
  old_price numeric(14,2), new_price numeric(14,2), currency char(3),
  source text not null,                      -- manual · portal · pricelist:<id> · sync:<источник>
  user_id uuid,
  at timestamptz not null default now()
);
create index if not exists unit_events_unit_idx on portal.unit_events (unit_id, at desc);
create index if not exists unit_events_at_idx on portal.unit_events (at, kind);
-- История цен с сентября — из журнала каталога (price_history), чтобы аналитика и карточка начинались не с нуля
insert into portal.unit_events (unit_id, kind, old_price, new_price, currency, source, at)
select unit_id, case when rn = 1 then 'created' else 'price' end, prev, price, currency, case when changed_by like 'sync:%' then changed_by else 'manual' end, changed_at
from (select unit_id, price, currency, changed_by, changed_at, lag(price) over w prev, row_number() over w rn from price_history window w as (partition by unit_id order by changed_at, id)) h
where not exists (select 1 from portal.unit_events);

create table if not exists portal.price_lists (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  title text not null,
  status text not null default 'draft' check (status in ('draft','published','reverted')),
  rule jsonb not null default '{}',
  note text,
  created_by uuid not null, created_at timestamptz not null default now(),
  published_by uuid, published_at timestamptz,
  reverted_by uuid, reverted_at timestamptz
);
create index if not exists price_lists_project_idx on portal.price_lists (project_id, created_at desc);
create table if not exists portal.price_list_items (
  list_id uuid not null references portal.price_lists(id) on delete cascade,
  unit_id uuid not null,
  old_price numeric(14,2) not null, new_price numeric(14,2) not null, currency char(3) not null,
  applied boolean,                           -- null — черновик; true — применено; false — цена успела измениться, пропущено
  primary key (list_id, unit_id)
);
