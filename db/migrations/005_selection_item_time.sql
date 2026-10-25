-- Когда квартиру добавили или отметили — для отчёта о встрече в режиме показа
alter table portal.selection_items add column if not exists created_at timestamptz not null default now();
