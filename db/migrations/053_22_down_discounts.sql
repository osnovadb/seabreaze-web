-- 2.2 · Калькулятор вариантов (10.11): сетка скидок застройщика за первый взнос — «взнос от X % → скидка N %».
-- На проект, при необходимости — на блок (ступень блока главнее общей); с датами действия. Скидка уменьшает цену до раздела денег.
create table if not exists portal.down_discounts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  building_id uuid references public.buildings(id) on delete cascade,
  from_pct numeric(5,2) not null check (from_pct > 0 and from_pct <= 100),
  discount_pct numeric(5,2) not null check (discount_pct >= 0 and discount_pct < 100),
  valid_from date, valid_to date, note text,
  created_by uuid references portal.users(id), created_at timestamptz not null default now()
);
create index if not exists down_discounts_project on portal.down_discounts (project_id);
