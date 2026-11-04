-- v2 · Запуск: доступы без паролей в чате. Приглашение и сброс — одноразовая ссылка (хранится только хеш),
-- «Забыли пароль?», защита от подбора пароля, очередь писем и сообщений (отправка — когда подключат SMTP и бота).
create table if not exists portal.auth_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references portal.users(id) on delete cascade,
  kind text not null check (kind in ('invite','reset')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists auth_tokens_user_idx on portal.auth_tokens (user_id, created_at desc);
create table if not exists portal.login_attempts (
  id bigserial primary key,
  email text not null,
  ip text,
  ok boolean not null,
  at timestamptz not null default now()
);
create index if not exists login_attempts_email_idx on portal.login_attempts (email, at desc);
create index if not exists login_attempts_ip_idx on portal.login_attempts (ip, at desc);
create table if not exists portal.outbox_messages (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('email','telegram')),
  to_addr text not null,
  user_id uuid,
  subject text,
  body text not null,
  kind text not null,                         -- invite · reset · notify
  status text not null default 'queued' check (status in ('queued','sent','error','skipped')),
  attempts int not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists outbox_messages_status_idx on portal.outbox_messages (status, created_at);
-- пароль ещё не задан (приглашён, но не вошёл)
alter table portal.users add column if not exists password_set boolean not null default true;
