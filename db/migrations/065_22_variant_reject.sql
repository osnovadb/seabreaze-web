-- О28 (обход 11.11): руководитель рынка может не согласовать скидку в варианте расчёта
alter table portal.calc_variants add column if not exists rejected_at timestamptz;
alter table portal.calc_variants add column if not exists rejected_by uuid references portal.users(id);
