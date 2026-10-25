-- Права портала на каталог (выполняет суперпользователь базы, не миграции портала).
-- Портал — админка каталога (решение Дениса 24.10.2026: объекты, цены, планы оплаты и видимость — в портале, Directus убираем).
-- Триггеры каталога: units_track_changes пишет price_history и ставит замки ручных правок; trg_refresh_catalog пересобирает витрины сайтов.
grant insert, update, delete on developers, projects, buildings, layouts, units, payment_plans, project_markets to portal_app;
grant insert on price_history to portal_app;
grant select, insert, delete on catalog_units, catalog_projects to portal_app;
grant select on pricing_rules, markets, currency_rates, sources, zones, project_markets, payment_plans, developers to portal_app;
grant insert, select on directus_files to portal_app;
grant usage on sequence project_markets_id_seq, price_history_id_seq to portal_app;
