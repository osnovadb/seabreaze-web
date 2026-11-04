-- v2 · Запуск: уведомления вне портала — e-mail (SMTP) и Telegram (бот). Срочные — сразу, остальные — сводкой раз в день.
alter table portal.users add column if not exists notify_email boolean not null default true;
alter table portal.users add column if not exists notify_telegram boolean not null default true;
alter table portal.users add column if not exists notify_digest boolean not null default true;
alter table portal.users add column if not exists telegram_chat_id bigint;
alter table portal.users add column if not exists tg_link_code text;
alter table portal.users add column if not exists last_digest_on date;
alter table portal.notifications add column if not exists forwarded_at timestamptz;
-- уже существующие уведомления наружу не пересылаем
update portal.notifications set forwarded_at = created_at where forwarded_at is null;
create table if not exists portal.kv (key text primary key, value text not null, updated_at timestamptz not null default now());
