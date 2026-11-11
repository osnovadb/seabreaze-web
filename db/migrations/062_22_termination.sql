-- 2.2 · Ответ Дениса 11.11 на 352: «Расторжение» у бэк-офиса — дата, причина, вернули ли деньги клиенту.
-- Возврат комиссии (клаубэк) — только при расторжении в первые 3 месяца (окно из условий) и с возвратом денег клиенту; сумму утверждают финансы.
alter table portal.deals add column if not exists termination_date date, add column if not exists termination_reason text, add column if not exists client_refunded boolean;
create table if not exists portal.clawback_requests (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references portal.deals(id) on delete cascade,
  role text not null, user_id uuid references portal.users(id),
  proposed numeric not null, amount numeric,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note text, created_at timestamptz not null default now(),
  decided_by uuid references portal.users(id), decided_at timestamptz
);
create index if not exists clawback_requests_pending on portal.clawback_requests (status) where status = 'pending';
grant select, insert, update, delete on portal.clawback_requests to portal_app;
