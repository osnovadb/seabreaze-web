-- 384 (Денис 12.11): режим «акция входит в максимум» — цена полная, акция берётся из максимума скидки (пула)
alter table portal.project_settings drop constraint if exists project_settings_promo_mode_check;
alter table portal.project_settings add constraint project_settings_promo_mode_check check (promo_mode in ('chain','sum','best','exclusive','within'));
