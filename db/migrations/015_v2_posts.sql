-- v2 · М9: лента новостей и баннеров для партнёров. Ручные записи — на своём языке; автоматические (акция, старт продаж,
-- новые условия) — шаблон словаря + vars, показываются на языке читателя. markets пусто — всем рынкам.
set search_path = portal, public;
create table if not exists posts (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null default 'news' check (kind in ('news','banner','auto')),
  title      text not null,
  body       text,
  vars       jsonb,
  lang       text check (lang in ('ru','en','de','he')),   -- null — авто-запись, переводится при показе
  markets    text[] not null default '{}',
  project_id uuid,
  link       text,
  starts_on  date not null default current_date,
  ends_on    date,
  auto_key   text unique,                                   -- dedup авто-записей
  created_by uuid references users,
  created_at timestamptz not null default now()
);
create index if not exists posts_starts on posts (starts_on desc);
create table if not exists post_reads (
  post_id uuid not null references posts on delete cascade,
  user_id uuid not null references users on delete cascade,
  read_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
