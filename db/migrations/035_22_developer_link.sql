-- 2.2 · Карточка условий привязана к застройщику каталога (public.developers); проект → застройщик — через public.projects.developer_id.
alter table portal.developers add column if not exists catalog_id uuid unique;
alter table portal.project_settings drop column if exists developer_id;
insert into portal.developers (name, catalog_id)
  select d.name, d.id from public.developers d
  where not exists (select 1 from portal.developers x where x.catalog_id = d.id)
  on conflict (name) do nothing;
