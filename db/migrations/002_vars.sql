-- Уведомления и системные события хранят шаблон (русский ключ словаря) и переменные — переводятся при показе
alter table portal.notifications add column if not exists vars jsonb;
alter table portal.activities add column if not exists vars jsonb;
