-- Доработки по сверке с ТЗ (24.10.2026)
set search_path = portal, public;

-- Уведомления от фонового обработчика: ключ, чтобы одно и то же напоминание не приходило дважды
alter table notifications add column if not exists dedup text;
create unique index if not exists notifications_dedup on notifications (dedup) where dedup is not null;
alter table tasks add column if not exists dedup text;
create unique index if not exists tasks_dedup on tasks (dedup) where dedup is not null;

-- Скидка сверх своего порога — бронь ждёт согласования владельца или руководителя рынка
alter table bookings add column if not exists approval text check (approval in ('pending','approved','rejected'));
alter table bookings add column if not exists approved_by uuid references users;

-- Споры «чей клиент»: кто попытался зарегистрировать, с какими контактами, решение по журналу
create table if not exists disputes (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients,
  requester_id uuid not null references users,
  name         text not null,
  phone        text,
  email        text,
  comment      text,
  status       text not null default 'open' check (status in ('open','kept','transferred')),
  decided_by   uuid references users,
  decided_at   timestamptz,
  decision     text,
  created_at   timestamptz not null default now()
);
