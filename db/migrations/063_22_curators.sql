-- 2.2 · Ответы Дениса 11.11 на 374 и 280: куратором партнёра может быть только пользователь с отметкой «ведёт партнёров»; сейлза — нельзя.
alter table portal.users add column if not exists leads_partners boolean not null default false;
-- Стенд: отметка — у руководителей рынка и владельцев; кураторство сейлзов снимаем (их клиентов партнёров они больше не видят)
update portal.users set leads_partners = true where role in ('market_head', 'owner');
update portal.users a set curator_id = null from portal.users cu where cu.id = a.curator_id and cu.role = 'seller';

-- 375: руководитель агентства меняет подборки своих сотрудников — видно, кто менял
alter table portal.selections add column if not exists updated_by uuid references portal.users(id), add column if not exists updated_at timestamptz;
