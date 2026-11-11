-- 2.2 · Ответы Дениса 11.11 на 358 и 284: до запуска — защита формы заявки от ботов, уведомление о входе с нового устройства,
-- письмо на прежний адрес и уведомление финансам при смене банковских реквизитов. 2FA и лимит просмотра контактов — после запуска.
create table if not exists portal.user_devices (
  user_id uuid not null references portal.users(id) on delete cascade,
  device_id text not null,
  ua text, ip text,
  first_at timestamptz not null default now(), last_at timestamptz not null default now(),
  primary key (user_id, device_id)
);
alter table portal.agent_applications add column if not exists ip text;
create index if not exists agent_applications_ip on portal.agent_applications (ip, created_at) where ip is not null;
grant select, insert, update, delete on portal.user_devices to portal_app;
