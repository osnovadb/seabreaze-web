-- Денис 12.11, ответ на 381 «Да»: условия стенда — по договорам
-- Д1, Д2 Арад (BRABUS, Marina Village): ответ по регистрации 1 рабочий день (4.1), бронь 7 + 7 дней (4.5)
update portal.developers set reg_response_days = 1, booking_days = 7, booking_ext_days = 7 where name = 'Sabah Investment Group';
-- Д3–Д5 Premium: молчание = подтверждение, 3 + 2 дня; защита клиента 12 месяцев; возврат комиссии — только по тому же клиенту
update portal.developers set silence_rule = 'confirm', reg_response_days = 3, silence_extra_days = 2, protect_months = 12, clawback_offset = 'same_client' where name = 'PR Premium Residence';
-- те же значения — в действующих условиях проектов (регистрации читают их из portal.cur_conditions)
update portal.conditions k set reg_response_days = 1, booking_days = 7, booking_ext_days = 7 from projects p where p.id = k.project_id and p.slug in ('brabus-island-baku','test-marina') and k.id = (portal.cur_conditions(p.id)).id;
update portal.conditions k set silence_rule = 'confirm', reg_response_days = 3, silence_extra_days = 2, reg_protect_months = 12, clawback_offset = 'same_client' from projects p where p.id = k.project_id and p.slug = 'premium-residence' and k.id = (portal.cur_conditions(p.id)).id;
