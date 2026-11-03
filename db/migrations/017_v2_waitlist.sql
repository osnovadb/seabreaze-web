-- v2 · М12: лист ожидания на занятую квартиру и сохранённые поиски с уведомлением о новых подходящих квартирах.
-- Освободилась квартира — первый в очереди получает уведомление сразу, следующий — через паузу проекта (по умолчанию 24 ч).
set search_path = portal, public;
create table if not exists waitlist (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid not null,
  user_id     uuid not null references users on delete cascade,
  client_id   uuid references clients on delete cascade,
  active      boolean not null default true,
  notified_at timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists waitlist_once on waitlist (unit_id, user_id, coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid)) where active;
create index if not exists waitlist_unit on waitlist (unit_id) where active;
create table if not exists saved_searches (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users on delete cascade,
  name       text not null,
  filters    jsonb not null,               -- {project, rooms, max (тыс. $), outdoor: g|t}
  seen_ids   uuid[] not null default '{}', -- подходящие свободные квартиры на прошлой проверке
  active     boolean not null default true,
  checked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table project_settings add column if not exists waitlist_pause_hours int not null default 24 check (waitlist_pause_hours between 0 and 720);
