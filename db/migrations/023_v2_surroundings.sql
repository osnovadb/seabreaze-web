-- v2 · Окружение на планах: метки «море, бассейн, дорога…» на плане этажа и генплане, стороны схемы этажа у блока без плана
alter table portal.floor_plans add column if not exists marks jsonb not null default '[]';
alter table portal.genplans add column if not exists marks jsonb not null default '[]';
create table if not exists portal.building_sides (
  building_id uuid primary key,
  sides jsonb not null default '{}',          -- { top: {kind, label}, right: …, bottom: …, left: … }
  updated_at timestamptz not null default now()
);
-- Обложка проекта в списке «Проекты» (раньше картинки были зашиты в код)
alter table portal.project_settings add column if not exists cover_file_id uuid references portal.files(id) on delete set null;
