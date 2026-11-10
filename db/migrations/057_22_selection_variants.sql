-- 2.2 · Калькулятор вариантов, этап 3 (подтверждено Денисом 10.11): в подборке у квартиры — до трёх вариантов расчёта.
-- Клиенту показывается только вариант со скидкой в пределах порога автора или согласованный; клиент может отметить «подходит».
create table if not exists portal.selection_variants (
  selection_id uuid not null references portal.selections(id) on delete cascade,
  unit_id uuid not null,
  variant_id uuid not null references portal.calc_variants(id) on delete cascade,
  sort int not null default 0,
  liked_at timestamptz,
  created_by uuid references portal.users(id),
  created_at timestamptz not null default now(),
  primary key (selection_id, variant_id)
);
create index if not exists selection_variants_unit on portal.selection_variants (selection_id, unit_id);

grant select, insert, update, delete on portal.selection_variants to portal_app;
