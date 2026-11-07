-- 2.2 · §13 события 9–13, 16, 18–20: задачи в Bitrix24, KYC, оплата → Won, Installments и Aftercare, заявки партнёров.

-- Новые виды задач очереди: task — задача сотруднику Bitrix24 по клиенту; app_sync — заявка партнёра ↔ сделка в Agencies / Sub-agents
alter table portal.b24_jobs drop constraint if exists b24_jobs_kind_check;
alter table portal.b24_jobs add constraint b24_jobs_kind_check check (kind in ('deal_sync','client_sync','call','task','app_sync'));
drop index if exists portal.b24_jobs_one_pending;
create unique index b24_jobs_one_pending on portal.b24_jobs (kind, ref_id) where status in ('pending','error') and ref_id is not null and kind in ('deal_sync','app_sync');

-- Сделки портала (по квартире) ↔ Installments и Aftercare в Bitrix24 (§9)
alter table portal.deals add column if not exists b24_inst_id bigint;
alter table portal.deals add column if not exists b24_after_id bigint;

-- Заявка партнёра ↔ сделка в воронке заявок (§6 П7)
alter table portal.agent_applications add column if not exists b24_contact_id bigint;
alter table portal.agent_applications add column if not exists b24_deal_id bigint;
alter table portal.agent_applications add column if not exists b24_stage text;
create index if not exists agent_applications_b24 on portal.agent_applications (b24_deal_id) where b24_deal_id is not null;
