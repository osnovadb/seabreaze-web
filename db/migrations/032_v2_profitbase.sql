-- v2 · М1–М3, М11: синхронизация с Profitbase API v4. Каталог — в своих таблицах (sources, sync_runs, status_map — схема каталога),
-- здесь — очередь записи в Profitbase (бронь, снятие, продажа) и пометка, что план этажа пришёл из Profitbase (/floor).
create table if not exists portal.pb_outbox (
  id uuid primary key default gen_random_uuid(),
  source_id text not null,
  unit_id uuid not null,
  booking_id uuid,
  op text not null check (op in ('reserve','release','sold')),
  status_alias text not null,                 -- статус застройщика, который ставим (alias или id)
  state text not null default 'pending' check (state in ('pending','sent','error','skipped')),
  attempts int not null default 0,
  last_error text,
  result jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists pb_outbox_state_idx on portal.pb_outbox (state, created_at);
alter table portal.floor_plans add column if not exists source text;          -- null — разметка вручную; иначе id источника Profitbase
alter table portal.floor_plans add column if not exists pb_floor_id int;
