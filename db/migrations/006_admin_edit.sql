-- Редактирование пользователей и агентов: «выйти везде» (версия сессии), доступ, созданный из заявки
alter table portal.users add column if not exists session_ver int not null default 0;
alter table portal.agent_applications add column if not exists user_id uuid references portal.users;
