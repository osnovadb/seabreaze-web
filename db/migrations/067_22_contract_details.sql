-- 380 (Денис 12.11, «Да»): при «Договор подписан» обязательны дата и номер договора, файл — по желанию;
-- окно возврата комиссии (клаубэк) считается от даты договора, а не от нажатия кнопки
alter table portal.deals add column if not exists contract_date date;
alter table portal.deals add column if not exists contract_no text;
alter table portal.deals add column if not exists contract_file_id uuid references portal.files(id);
