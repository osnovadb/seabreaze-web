-- 2.2 · Калькулятор вариантов, этап 2 (10.11): сохранённые варианты расчёта по квартире.
-- Храним настройки (взнос, срок, скидка, дата, опции, исходный план); суммы считаются от действующей цены, snapshot — на момент сохранения
-- (по нему видно «цена изменилась»). Автор — пользователь; клиент и подборка — необязательно, прикрепить можно позже.
create table if not exists portal.calc_variants (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete cascade,
  author_id uuid not null references portal.users(id),
  client_id uuid references portal.clients(id) on delete set null,
  name text not null,
  params jsonb not null,            -- { downPct, months, disc, start, options: [id], planId }
  snapshot jsonb not null,          -- { list, total, down, monthly, months, last, devPct, disc, approx, needsApproval }
  needs_approval boolean not null default false,
  approved_by uuid references portal.users(id), approved_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists calc_variants_unit on portal.calc_variants (unit_id, author_id);
create index if not exists calc_variants_client on portal.calc_variants (client_id) where client_id is not null;
