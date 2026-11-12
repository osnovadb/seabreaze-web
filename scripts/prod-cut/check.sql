-- Целостность после чистки: для каждого внешнего ключа (одна колонка) — строки, которые ссылаются в пустоту. Ожидается пустой вывод.
do $$ declare r record; n bigint; begin
  for r in select c.conname, cn.nspname cs, cl.relname ct, a.attname ca, pn.nspname ps, pl.relname pt, pa.attname pa
    from pg_constraint c join pg_class cl on cl.oid = c.conrelid join pg_namespace cn on cn.oid = cl.relnamespace
    join pg_class pl on pl.oid = c.confrelid join pg_namespace pn on pn.oid = pl.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1] join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
    where c.contype = 'f' and array_length(c.conkey, 1) = 1 and cn.nspname in ('public', 'portal')
  loop
    execute format('select count(*) from %I.%I x where x.%I is not null and not exists (select 1 from %I.%I y where y.%I = x.%I)', r.cs, r.ct, r.ca, r.ps, r.pt, r.pa, r.ca) into n;
    if n > 0 then raise notice 'FK % : %.%.% → %.% — % висячих', r.conname, r.cs, r.ct, r.ca, r.ps, r.pt, n; end if;
  end loop;
end $$;
select 'projects' t, count(*) from public.projects union all select 'buildings', count(*) from public.buildings union all select 'units', count(*) from public.units
union all select 'layouts', count(*) from public.layouts union all select 'directus_files', count(*) from public.directus_files union all select 'portal.files', count(*) from portal.files
union all select 'floor_plans', count(*) from portal.floor_plans union all select 'genplans', count(*) from portal.genplans union all select 'conditions', count(*) from portal.conditions
union all select 'users', count(*) from portal.users union all select 'clients', count(*) from portal.clients union all select 'directus_users', count(*) from public.directus_users;
select p.slug, b.name, count(u.*) from public.projects p join public.buildings b on b.project_id = p.id left join public.units u on u.building_id = b.id group by 1, 2 order by 1, 2;
