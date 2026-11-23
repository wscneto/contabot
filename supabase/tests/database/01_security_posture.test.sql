-- Postura de segurança do banco (pgTAP): verificações sobre o catálogo do
-- Postgres que valem para TODAS as tabelas e funções, inclusive as criadas por
-- migrations futuras. Uma tabela nova sem RLS, uma RPC exposta ao anon ou uma
-- função security definer sem search_path quebram este teste.
--
--   pnpm dlx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(24);

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity $$,
  'toda tabela do schema public tem RLS ligada'
);

select is_empty(
  $$ select grantee || ' ' || privilege_type || ' ' || table_name
     from information_schema.role_table_grants
     where table_schema = 'public' and grantee in ('anon', 'authenticated')
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER') $$,
  'anon e authenticated não escrevem direto em nenhuma tabela (toda escrita passa por RPC)'
);

select is_empty(
  $$ select table_name || ' ' || privilege_type from information_schema.role_table_grants
     where table_schema = 'public' and grantee = 'anon' $$,
  'anon não tem nenhum privilégio de tabela'
);

select is_empty(
  $$ select tablename || '.' || policyname || ' (' || cmd || ')' from pg_policies
     where schemaname = 'public' and cmd <> 'SELECT' $$,
  'só existem políticas de leitura nas tabelas'
);

select is_empty(
  $$ select tablename || '.' || policyname from pg_policies
     where schemaname = 'public' and not ('authenticated' = any (roles)) $$,
  'políticas de leitura valem apenas para usuários autenticados'
);

select ok(
  not has_table_privilege('authenticated', 'public.access_codes', 'SELECT')
  and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'access_codes'),
  'access_codes (hash dos códigos) é invisível para a API'
);

select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'email', 'SELECT')
  and has_column_privilege('authenticated', 'public.profiles', 'name', 'SELECT'),
  'profiles.email não é legível pela API; nome continua legível pela equipe'
);

-- ---------------------------------------------------------------------------
-- Funções
-- ---------------------------------------------------------------------------

select is_empty(
  $$ select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prosecdef
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') $$,
  'toda função security definer fixa o search_path (evita sequestro de objetos)'
);

select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE') $$,
  'nenhuma função do schema public é executável pelo anon'
);

select is_empty(
  $$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')) $$,
  'funções do schema private não são executáveis pela API'
);

select ok(
  not has_schema_privilege('anon', 'private', 'USAGE') and not has_schema_privilege('authenticated', 'private', 'USAGE'),
  'schema private é inacessível para anon e authenticated'
);

select is_empty(
  $$ select f from unnest(array[
       'public.pipeline_claim(uuid, text)',
       'public.pipeline_set_stage(uuid, text, jsonb)',
       'public.pipeline_fail(uuid, text)',
       'public.pipeline_finish(uuid, jsonb, jsonb, jsonb, text, text, jsonb, boolean)'
     ]) f
     where has_function_privilege('authenticated', f::regprocedure, 'EXECUTE')
        or not has_function_privilege('service_role', f::regprocedure, 'EXECUTE') $$,
  'funções do pipeline de IA são exclusivas do service role'
);

select is_empty(
  $$ select f from unnest(array[
       'public.whoami()', 'public.list_team()', 'public.regenerate_access_code(uuid)',
       'public.deactivate_member(uuid)', 'public.list_products()', 'public.get_product(uuid)',
       'public.create_product(text, text[], text, text, integer)',
       'public.update_product(uuid, text, text, text, integer, text[])', 'public.archive_product(uuid)',
       'public.import_products(jsonb)', 'public.list_areas()', 'public.get_area(uuid)',
       'public.create_area(text, text, uuid[])', 'public.update_area(uuid, text, text, uuid[])',
       'public.delete_area(uuid)', 'public.list_tasks(text, text[])', 'public.get_task(uuid)',
       'public.create_tasks(uuid[], uuid, date, text)', 'public.update_task(uuid, jsonb)',
       'public.delete_task(uuid)', 'public.switch_to_manual(uuid)', 'public.submit_task(uuid, jsonb)',
       'public.approve_task(uuid, jsonb)', 'public.request_recount(uuid, text)',
       'public.start_capture(uuid)', 'public.register_capture_frames(uuid, jsonb, text[], text, jsonb)',
       'public.fail_capture(uuid, text)', 'public.get_dashboard()', 'public.get_store_settings()',
       'public.update_counting_instruction(text)'
     ]) f
     where not has_function_privilege('authenticated', f::regprocedure, 'EXECUTE') $$,
  'todas as RPCs do app continuam executáveis por usuários autenticados'
);

-- Defaults: objetos criados por migrations futuras nascem fechados.
create function public.__teste_default() returns integer language sql as 'select 1';
select ok(
  not has_function_privilege('anon', 'public.__teste_default()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.__teste_default()', 'EXECUTE'),
  'função nova no schema public não nasce executável pela API (exige GRANT explícito)'
);

create table public.__teste_default (x integer);
select ok(
  not has_table_privilege('anon', 'public.__teste_default', 'SELECT'),
  'tabela nova no schema public não nasce legível pelo anon'
);

-- ---------------------------------------------------------------------------
-- Gatilho de cadastro e códigos de acesso
-- ---------------------------------------------------------------------------

select has_trigger('auth', 'users', 'on_auth_user_created', 'cadastro do gerente cria loja e perfil');

select is(
  private.hash_access_code('abcd-2345'),
  'a00d76646eba91b057841554d5c8334f498dc592ed744bce404f21fe271cd36e',
  'hash do código no SQL é o SHA-256 do código normalizado (mesmo vetor do teste em TypeScript)'
);

select ok(
  (select bool_and(private.new_access_code() ~ '^[A-HJ-NP-Z2-9]{8}$') from generate_series(1, 500)),
  'códigos gerados no SQL usam só o alfabeto sem caracteres ambíguos'
);

select is(
  (select count(distinct private.new_access_code()) from generate_series(1, 2000)),
  2000::bigint,
  '2000 códigos gerados no SQL sem colisão'
);

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select public, file_size_limit, allowed_mime_types::text[] from storage.buckets where id = 'media' $$,
  $$ values (false, 10485760::bigint, array['image/jpeg', 'image/png', 'image/webp']) $$,
  'bucket media é privado, limitado a 10 MB e a imagens'
);

select is_empty(
  $$ select policyname || ' (' || cmd || ')' from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'DELETE', 'ALL')
       and coalesce(qual, '') || coalesce(with_check, '') like '%media%' $$,
  'mídia não pode ser sobrescrita nem apagada pela API'
);

select ok(
  (select bool_and(coalesce(qual, '') || coalesce(with_check, '') like '%my_store_id()%')
   from pg_policies where schemaname = 'storage' and tablename = 'objects'
     and coalesce(qual, '') || coalesce(with_check, '') like '%media%'),
  'toda política do bucket media restringe à pasta da loja do usuário'
);

select ok(
  (select with_check like '%is_manager()%' from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and cmd = 'INSERT'
     and with_check like '%media%' limit 1),
  'só o gerente envia fotos de produto'
);

select ok(
  (select prosecdef from pg_proc where oid = 'public.my_store_id()'::regprocedure)
  and (select pg_get_functiondef('public.my_store_id()'::regprocedure) like '%p.active%'),
  'my_store_id (base de toda a RLS) ignora perfis desativados'
);

select * from finish();
rollback;
