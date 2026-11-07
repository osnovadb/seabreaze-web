-- 2.2 · §6 П10: статус партнёра — Active / Inactive (6 месяцев без новых квалифицированных клиентов, доступ остаётся) / Blocked (доступ закрыт)
alter table portal.users add column if not exists partner_status text not null default 'active' check (partner_status in ('active','inactive','blocked'));
alter table portal.users add column if not exists partner_status_at timestamptz;
