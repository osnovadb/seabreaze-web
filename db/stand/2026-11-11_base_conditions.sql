-- Стенд 2.2 · базовые условия по ответу Дениса 11.11 (318, 368): «у всех макс рассрочка до 60 месяцев, 20% бонус пулл, аванс от 20%, по Араду от 35%».
-- Арад (BRABUS, Marina Village): фикс 4 % Европа / 2,5 % Израиль от прайса, бронь 7 + 7, лимит 5. Premium: фикс 5 % от цены клиента, бронь 14 + 14, лимит 10.
-- Часть партнёра в пуле — половина (10 из 20), как в условиях Premium. Правим действующую опубликованную версию (стенд, не бой).
update portal.conditions k set pool_pct = 20, agent_pool_pct = 10,
  fix_pct = case when p.slug in ('brabus-island-baku','test-marina') then 4 else 5 end,
  fix_base = case when p.slug in ('brabus-island-baku','test-marina') then 'list' else 'final' end,
  rates_by_market = case when p.slug in ('brabus-island-baku','test-marina') then '{"IL": 2.5}'::jsonb else '{}'::jsonb end,
  booking_days = case when p.slug in ('brabus-island-baku','test-marina') then 7 else 14 end,
  booking_ext_days = case when p.slug in ('brabus-island-baku','test-marina') then 7 else 14 end,
  note = coalesce(k.note || '; ', '') || 'базовые условия 11.11 (318)'
from public.projects p where p.id = k.project_id and k.id = (select (portal.cur_conditions(p.id)).id);
-- Лимит застройщика (Арад 5, Premium 10) — в условиях проекта до пункта 366
update portal.conditions k set max_bookings_total = case when p.slug in ('brabus-island-baku','test-marina') then 5 else 10 end
from public.projects p where p.id = k.project_id and k.id = (select (portal.cur_conditions(p.id)).id) and k.max_bookings_total < 1000;
-- Планы: рассрочка до 60 мес., взнос от 20 % (Арад — от 35 %); «скидка за 100 %» не задаём — пул 20 % для всех
update payment_plans pp set down_payment_pct = 35, months = 60, name = 'Рассрочка до 60 мес.', source_note = 'базовые условия 11.11 (318)'
  from projects p where p.id = pp.project_id and p.slug in ('brabus-island-baku','test-marina') and pp.down_payment_pct < 100;
update payment_plans pp set full_payment_discount_pct = null from projects p where p.id = pp.project_id and p.slug = 'test-marina' and pp.down_payment_pct >= 100;
insert into payment_plans (project_id, name, down_payment_pct, months, sort, source_note, verified)
  select p.id, x.name, x.down, x.months, x.sort, 'базовые условия 11.11 (318)', true
  from projects p cross join (values ('Полная оплата', 100, 0, 0), ('Рассрочка до 60 мес.', 20, 60, 1)) x(name, down, months, sort)
  where p.slug = 'premium-residence' and not exists (select 1 from payment_plans q where q.project_id = p.id);
-- Ревью 11.11 (п. 6): Marina Village — тоже Арада, застройщик как у BRABUS (тестовый проект стенда)
update projects set developer_id = (select developer_id from projects where slug = 'brabus-island-baku') where slug = 'test-marina';
