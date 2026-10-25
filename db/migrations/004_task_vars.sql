-- Автозадачи хранят шаблон и переменные, как уведомления — переводятся при показе
alter table portal.tasks add column if not exists vars jsonb;
