-- v2 · Прайс-лист: квартира без цены до публикации — old_price null, чтобы откат вернул пустую цену, а не 0
alter table portal.price_list_items alter column old_price drop not null;
update portal.price_list_items set old_price = null where old_price = 0;
