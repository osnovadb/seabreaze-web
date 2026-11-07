-- 2.2 · §13 п.1 Заявки сайтов, посадок и смарт-каталога → проверка «чей клиент» → лид с метками и согласиями через новую очередь обмена; копия письмом в ящик рынка
alter table portal.b24_jobs drop constraint if exists b24_jobs_kind_check;
alter table portal.b24_jobs add constraint b24_jobs_kind_check check (kind in ('deal_sync','client_sync','call','task','app_sync','privacy','web_lead'));
alter table portal.markets add column if not exists mailbox text;   -- ящик рынка (Google Workspace, группа рынка) — копия каждой заявки
-- старая очередь v2 (bitrix_outbox) больше не пополняется: накопленное переносим в новую очередь
