-- 2.2 · Ответ Дениса 11.11 на 344/314: доли партнёра — процент от цены, ставка — на пару «проект и рынок сделки» (agent_rates.market).
-- У рынка может быть своя ставка рекомендателя (Арад, Израиль: партнёру 1 %, рекомендателю 0,5 %). Ставка застройщика по рынку — conditions.rates_by_market.
alter table portal.agent_rates add column if not exists referrer_pct numeric check (referrer_pct is null or (referrer_pct >= 0 and referrer_pct < 100));
-- Стенд: Арад (BRABUS, Marina Village), рынок Израиль — партнёру 1 %, рекомендателю 0,5 %; часть пула партнёра — прежняя (половина)
insert into portal.agent_rates (project_id, market, agent_fix_pct, agent_pool_pct, referrer_pct, note)
  select p.id, 'IL', 1, k.agent_pool_pct, 0.5, 'Арад, Израиль: фикс 2,5 % — партнёру 1 %, рекомендателю 0,5 % (Денис 11.11, 314)'
  from public.projects p cross join lateral portal.cur_conditions(p.id) k
  where p.slug in ('brabus-island-baku', 'test-marina') and k.id is not null
    and not exists (select 1 from portal.agent_rates r where r.project_id = p.id and r.market = 'IL' and r.agent_id is null and r.agency_id is null);
