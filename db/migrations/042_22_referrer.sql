-- 2.2 · §6 П9 Рекомендатель: заявка упрощённая (сразу доступ), вход по одноразовой ссылке из письма без пароля (решение 249)
alter table portal.agent_applications drop constraint if exists agent_applications_kind_check;
alter table portal.agent_applications add constraint agent_applications_kind_check check (kind in ('agent','agency','referrer'));
alter table portal.auth_tokens drop constraint if exists auth_tokens_kind_check;
alter table portal.auth_tokens add constraint auth_tokens_kind_check check (kind in ('invite','reset','login'));
create index if not exists clients_referrer on portal.clients (referrer_id) where referrer_id is not null;
