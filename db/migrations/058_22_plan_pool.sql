-- 2.2 · Ответ Дениса 11.11 на 361: сетка «взнос и срок → скидка» из Приложения 1 договоров — это максимум скидки (пул плана), а не скидка клиенту.
-- Строка сетки — «взнос от X % и срок до N мес.»; срок не задан — любой срок. Фикс застройщика считается от прайса (Арад) или от цены клиента (Premium).
alter table portal.down_discounts add column if not exists max_months int check (max_months is null or max_months >= 0);
comment on column portal.down_discounts.discount_pct is 'Максимальная скидка (пул плана) для взноса от from_pct и срока до max_months';
alter table portal.conditions add column if not exists fix_base text not null default 'final' check (fix_base in ('list', 'final'));
comment on column portal.conditions.fix_base is 'От чего считается фикс застройщика: list — прайс, final — цена клиента';
