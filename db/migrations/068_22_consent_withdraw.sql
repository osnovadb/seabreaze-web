-- 386 (Денис 12.11, «Ок»): клиент отзывает согласие на обработку данных по своей ссылке — статус withdrawn
alter table portal.clients drop constraint if exists clients_consent_status_check;
alter table portal.clients add constraint clients_consent_status_check check (consent_status in ('none','pending','given','declined','withdrawn'));
