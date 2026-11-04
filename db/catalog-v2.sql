-- v2 · Изменения схемы каталога (выполняет суперпользователь базы, не миграции портала — таблицы каталога принадлежат ему).
-- Тип помещения «кладовка» (у Profitbase есть, у нас не было).
alter table units drop constraint if exists units_unit_type_check;
alter table units add constraint units_unit_type_check check (unit_type = any (array['studio','1br','2br','3br','4br','duplex','penthouse','townhouse','villa','commercial','parking','storage']));
