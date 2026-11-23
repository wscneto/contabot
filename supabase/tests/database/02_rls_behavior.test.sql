-- Comportamento da RLS e das RPCs com usuários simulados (pgTAP).
--
-- Cria duas lojas pelo gatilho de cadastro e "entra" como cada usuário trocando
-- o papel para authenticated e definindo as claims do JWT, como o PostgREST faz.
-- Tudo roda numa transação desfeita no final.
--
--   pnpm dlx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(23);

-- ---------------------------------------------------------------------------
-- Cenário
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('a0000000-0000-4000-8000-000000000001', 'gerente-a@teste.contabot.app',
   '{"name": "Gerente A", "store_name": "Loja A"}', 'authenticated', 'authenticated'),
  ('b0000000-0000-4000-8000-000000000001', 'gerente-b@teste.contabot.app',
   '{"name": "Gerente B", "store_name": "Loja B", "role": "employee"}', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000002', 'func-a@contabot.invalid', '{}', 'authenticated', 'authenticated'),
  ('a0000000-0000-4000-8000-000000000003', 'func-a2@contabot.invalid', '{}', 'authenticated', 'authenticated');

select is(
  (select count(*) from public.profiles where role = 'manager'
     and id in ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001')),
  2::bigint,
  'cadastro com store_name cria loja e gerente (metadado "role" é ignorado)'
);

select is(
  (select count(*) from public.profiles
   where id in ('a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003')),
  0::bigint,
  'usuário sem store_name não ganha perfil sozinho'
);

-- Funcionários da loja A (a Edge Function create-employee faz isto com o service role).
insert into public.profiles (id, store_id, name, role)
select u.id, p.store_id, u.name, 'employee'
from (values ('a0000000-0000-4000-8000-000000000002'::uuid, 'Ana'),
             ('a0000000-0000-4000-8000-000000000003'::uuid, 'Bruno')) u(id, name)
cross join public.profiles p where p.id = 'a0000000-0000-4000-8000-000000000001';

-- Foto de produto já "enviada" para cada loja.
insert into storage.objects (bucket_id, name)
select 'media', p.store_id || '/products/foto.jpg' from public.profiles p where p.role = 'manager'
  and p.id in ('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001');

create function pg_temp.store_of(p_user uuid) returns uuid language sql as
  $$ select store_id from public.profiles where id = p_user $$;
-- Funções novas nascem sem EXECUTE para a API (20261123000000_hardening.sql).
grant execute on function pg_temp.store_of(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Gerente A
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select lives_ok(
  $$ select public.create_product('Café', array[pg_temp.store_of(auth.uid()) || '/products/foto.jpg']) $$,
  'gerente A cadastra produto com foto da própria loja'
);
select lives_ok(
  $$ select public.create_area('Corredor A', '', array(select id from public.products)) $$,
  'gerente A cria área'
);
select lives_ok(
  $$ select public.create_tasks(array(select id from public.areas), 'a0000000-0000-4000-8000-000000000002') $$,
  'gerente A cria contagem para a Ana'
);
select is((select count(*) from public.stores), 1::bigint, 'gerente A enxerga só a própria loja');
select is((select count(*) from public.profiles), 3::bigint, 'gerente A enxerga só a própria equipe');

select throws_ok(
  $$ insert into public.products (store_id, name) values (pg_temp.store_of(auth.uid()), 'direto') $$,
  '42501', null, 'escrita direta na tabela é negada mesmo para o gerente'
);
select throws_ok(
  $$ select public.pipeline_fail(gen_random_uuid(), 'x') $$,
  '42501', null, 'gerente não chama funções do pipeline'
);
select throws_ok(
  $$ select public.update_task((select id from public.tasks limit 1), '{"due_date": "amanhã"}') $$,
  '22023', 'Data de entrega inválida. Use o formato AAAA-MM-DD.', 'data inválida vira mensagem amigável'
);
select throws_ok(
  $$ select public.create_area(repeat('x', 101)) $$,
  '22023', 'O nome da área deve ter no máximo 100 caracteres.', 'limite de tamanho com mensagem amigável'
);

-- ---------------------------------------------------------------------------
-- Gerente B (outra loja)
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "b0000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select is_empty($$ select id from public.products $$, 'gerente B não vê produtos da loja A');
select is_empty($$ select id from public.tasks $$, 'gerente B não vê contagens da loja A');
select is_empty($$ select id from storage.objects where name not like pg_temp.store_of(auth.uid()) || '/%' $$,
  'gerente B não vê arquivos da loja A no storage');

reset role;
create temp table alvo on commit drop as
  select t.id as task_id, a.id as area_id, p.id as product_id
  from public.tasks t join public.areas a on a.id = t.area_id join public.products p on p.store_id = t.store_id
  where t.store_id = pg_temp.store_of('a0000000-0000-4000-8000-000000000001') limit 1;
grant select on alvo to authenticated;
set local role authenticated;

select throws_ok(
  $$ select public.get_task((select task_id from alvo)) $$,
  'P0002', 'Contagem não encontrada.', 'gerente B não abre contagem da loja A pelo id'
);
select throws_ok(
  $$ select public.create_area('Roubo', '', array[(select product_id from alvo)]) $$,
  '22023', 'Produto não encontrado nesta loja.', 'gerente B não usa produto da loja A'
);

-- ---------------------------------------------------------------------------
-- Funcionários da loja A
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000003", "role": "authenticated"}';

select throws_ok(
  $$ select public.create_area('Bruno tenta') $$,
  '42501', 'Acesso restrito ao gerente da loja.', 'funcionário não executa RPC de gerente'
);
select throws_ok(
  $$ select email from public.profiles $$,
  '42501', null, 'funcionário não lê e-mails da equipe'
);
select throws_ok(
  $$ select public.switch_to_manual((select task_id from alvo)) $$,
  '42501', 'Esta contagem está atribuída a outro funcionário.', 'Bruno não assume a contagem da Ana'
);

set local request.jwt.claims = '{"sub": "a0000000-0000-4000-8000-000000000002", "role": "authenticated"}';

select is(
  (public.switch_to_manual((select task_id from alvo)) ->> 'status'),
  'review',
  'a Ana, responsável, muda a contagem para manual'
);

-- Ana é desativada: a sessão (JWT ainda válido) perde acesso imediatamente.
reset role;
update public.profiles set active = false where id = 'a0000000-0000-4000-8000-000000000002';
set local role authenticated;

select throws_ok($$ select public.whoami() $$, '28000', 'Este usuário foi desativado.', 'desativado: RPC recusada');
select is_empty($$ select id from public.tasks $$, 'desativado: RLS esconde todas as linhas');

-- ---------------------------------------------------------------------------
-- Anônimo
-- ---------------------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';

select throws_ok($$ select * from public.stores $$, '42501', null, 'anon não lê tabelas');

reset role;
select * from finish();
rollback;
