-- Файлы портала (материалы и документы проектов, документы клиентов), ссылки на сайты рынков, предыдущий вход
set search_path = portal, public;

-- Файлы лежат на диске портала (FILES_DIR), отдаются через /files/<id> с проверкой прав по тому, к чему файл привязан
create table if not exists files (
  id         uuid primary key default gen_random_uuid(),
  filename   text not null,
  mime       text not null,
  size       bigint not null,
  disk_name  text not null,
  created_by uuid references users,
  created_at timestamptz not null default now()
);
-- Материалы и документы проекта: файл или ссылка; язык; кому видно
create table if not exists project_files (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  kind       text not null check (kind in ('material','document','video')),
  title      text not null,
  lang       text not null default 'all' check (lang in ('all','ru','en','de','he')),
  audience   text not null default 'partner' check (audience in ('partner','client','team')),
  file_id    uuid references files on delete cascade,
  url        text,
  sort       int not null default 0,
  created_by uuid references users,
  created_at timestamptz not null default now(),
  check ((file_id is null) <> (url is null))
);
-- Документы клиента: паспорт для KYC, бронь, договор, платёжки; внутренние партнёр не видит
create table if not exists client_documents (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients on delete cascade,
  file_id    uuid not null references files on delete cascade,
  kind       text not null default 'other' check (kind in ('passport','kyc','booking','contract','payment','other')),
  note       text,
  internal   boolean not null default false,
  created_by uuid references users,
  created_at timestamptz not null default now()
);
-- Ссылка «На сайте» по рынку зрителя: {"DE": "...", "IL": "...", "GLOBAL": "..."}
alter table project_settings add column if not exists site_urls jsonb not null default '{}';
-- «Изменения с прошлого входа» на главной партнёра
alter table users add column if not exists prev_login_at timestamptz;

update project_settings ps set site_urls = jsonb_build_object(
    'DE', 'https://ge-de.pdna.pro/de/projects/' || x.site || '/', 'IL', 'https://ge-il.pdna.pro/he/projects/' || x.site || '/', 'GLOBAL', 'https://sb.pdna.pro/en/projects/' || x.site || '/')
  from (select id, case slug when 'brabus-island-baku' then 'brabus-island' else slug end site from public.projects where slug in ('premium-residence','brabus-island-baku')) x
  where ps.project_id = x.id and ps.site_urls = '{}';
