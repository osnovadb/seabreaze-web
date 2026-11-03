-- v2 · QA М4: файлы актов вознаграждения убираются из документов клиента (там их видели все, кому виден клиент)
set search_path = portal, public;
delete from client_documents cd using documents d where d.kind = 'commission_act' and cd.file_id in (d.pdf_file_id, d.docx_file_id);
