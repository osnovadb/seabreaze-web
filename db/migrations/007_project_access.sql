-- Видимость проектов для партнёров (решение Дениса 24.10.2026: статус + рынки + исключения).
-- Публикация на сайтах — отдельно, в каталоге (public.project_markets); здесь — только портал.
set search_path = portal, public;

create table if not exists project_settings (
  project_id    uuid primary key,
  sales_status  text not null default 'draft' check (sales_status in ('draft','sales','stop','closed')),
  agent_markets text[] not null default '{}',
  updated_at    timestamptz not null default now()
);
-- Исключение поверх рынка: открыть или закрыть проект конкретному агентству или партнёру
create table if not exists project_exceptions (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  agency_id  uuid references agencies on delete cascade,
  user_id    uuid references users on delete cascade,
  allow      boolean not null,
  note       text,
  created_at timestamptz not null default now(),
  check ((agency_id is null) <> (user_id is null))
);
-- Квартиры, скрытые от партнёров (квота мастер-девелопера, «придержать»)
create table if not exists unit_hidden (
  unit_id    uuid primary key,
  note       text,
  created_by uuid references users,
  created_at timestamptz not null default now()
);
-- Уже работающие проекты оставляем открытыми DE и IL, как было до настройки
insert into project_settings (project_id, sales_status, agent_markets)
  select id, 'sales', '{DE,IL}' from public.projects on conflict do nothing;
