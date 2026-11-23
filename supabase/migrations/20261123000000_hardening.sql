-- Endurecimento de segurança e validação.
--
-- Correções dos achados da suíte de pentest (supabase/tests/security.test.ts) e
-- dos testes de banco (supabase/tests/database/*.test.sql):
--
-- 1. EXECUTE padrão de PUBLIC: "alter default privileges in schema public revoke
--    ... from public" (20261110000100_rpc.sql) não tem efeito sobre o privilégio
--    padrão de PUBLIC, que só é removido na forma global. Por isso
--    import_products ficou executável pelo papel anon. Agora a forma global vale
--    para funções futuras e uma varredura remove o EXECUTE de PUBLIC/anon das
--    funções existentes (cada RPC do app já tem GRANT explícito a authenticated).
-- 2. anon não tem nenhum privilégio de tabela no schema public (antes a RLS
--    devolvia listas vazias; agora a recusa acontece antes, na camada de GRANT).
-- 3. A coluna profiles.email deixa de ser legível pela API. whoami e list_team
--    (gerente) continuam devolvendo o e-mail; o app não lê tabelas diretamente.
-- 4. Validação com mensagens amigáveis: antes, textos sem limite eram aceitos
--    (ex.: variação com 100 mil caracteres) e entradas inválidas devolviam o erro
--    cru do Postgres, com nomes de tabelas e constraints.
-- 5. Contagens e estoque mínimo: inteiros entre 0 e 1.000.000.
-- 6. Importação: no máximo 1.000 produtos por chamada (20 mil itens estouravam
--    o statement_timeout do banco).
-- 7. Autorização entre funcionários: só o responsável (ou qualquer um, se a
--    contagem não tem responsável) inicia captura, muda para manual ou envia a
--    contagem; só quem iniciou a captura (ou o gerente) pode cancelá-la.
-- 8. Condição de corrida no limite diário de análises: start_capture contava as
--    capturas e depois inseria, travando só a contagem. Oito chamadas
--    simultâneas em contagens diferentes passavam com limite 3 (teste em
--    supabase/tests/concurrency.test.ts). Agora a linha da loja é travada antes.
-- 9. register_capture_frames aceitava p_frames ou p_primary_frame_id nulos por
--    causa da lógica de três valores do SQL (achado do fuzzing da API).

-- =========================================================================
-- 1 a 3. Privilégios
-- =========================================================================

alter default privileges revoke execute on functions from public;
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;

revoke all on all tables in schema public from anon;
revoke references, trigger, truncate on all tables in schema public from authenticated;
alter default privileges in schema public revoke all on tables from anon;

revoke select on public.profiles from authenticated;
grant select (id, store_id, name, role, active, created_at) on public.profiles to authenticated;

-- =========================================================================
-- 4 e 5. Validadores
-- =========================================================================

-- Texto aparado, com limite de tamanho. p_label leva o artigo ("o nome da área").
create function private.clean_text(p_value text, p_label text, p_max integer, p_required boolean default false)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := btrim(coalesce(p_value, ''));
begin
  if p_required and v = '' then
    raise exception 'Informe %.', p_label using errcode = '22023';
  end if;
  if length(v) > p_max then
    raise exception '% deve ter no máximo % caracteres.', upper(left(p_label, 1)) || substr(p_label, 2), p_max
      using errcode = '22023';
  end if;
  return v;
end;
$$;

create function private.check_quantity(p_value integer, p_label text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is not null and p_value not between 0 and 1000000 then
    raise exception '% deve ser um número inteiro entre 0 e 1.000.000.', p_label using errcode = '22023';
  end if;
  return p_value;
end;
$$;

-- Funcionário só age sobre contagem atribuída a ele ou sem responsável.
create function private.require_task_actor(me public.profiles, t public.tasks)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if me.role = 'employee' and t.assignee_id is not null and t.assignee_id <> me.id then
    raise exception 'Esta contagem está atribuída a outro funcionário.' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function
  private.clean_text(text, text, integer, boolean),
  private.check_quantity(integer, text),
  private.require_task_actor(public.profiles, public.tasks)
from public, anon, authenticated;

-- p_counts: {"<product_id>": inteiro entre 0 e 1.000.000 | null}.
create or replace function private.check_counts(p_task_id uuid, p_counts jsonb, p_exact boolean)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k text;
  v jsonb;
begin
  if jsonb_typeof(p_counts) is distinct from 'object' then
    raise exception 'Envie as contagens como objeto {produto: quantidade}.' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(p_counts) loop
    if not exists (select 1 from public.task_items i where i.task_id = p_task_id and i.product_id::text = k) then
      raise exception 'Produto fora desta contagem: %', left(k, 60) using errcode = '22023';
    end if;
    if jsonb_typeof(v) not in ('number', 'null')
      or (jsonb_typeof(v) = 'number'
          and (v::numeric < 0 or v::numeric > 1000000 or v::numeric <> trunc(v::numeric))) then
      raise exception 'Quantidades devem ser inteiros não negativos (até 1.000.000) ou vazias.' using errcode = '22023';
    end if;
  end loop;
  if p_exact and (select count(*) from public.task_items i where i.task_id = p_task_id)
     <> (select count(*) from jsonb_object_keys(p_counts)) then
    raise exception 'A lista de contagem deve incluir exatamente todos os produtos da área.' using errcode = '22023';
  end if;
end;
$$;

-- =========================================================================
-- Produtos
-- =========================================================================

create or replace function public.create_product(
  p_name text,
  p_photos text[],
  p_variant text default '',
  p_barcode text default '',
  p_min_stock integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_manager();
  v_name text := private.clean_text(p_name, 'o nome do produto', 150, true);
  v_variant text := private.clean_text(p_variant, 'a variação', 100);
  v_barcode text := private.clean_text(p_barcode, 'o código de barras', 64);
  v_min_stock integer := private.check_quantity(p_min_stock, 'O estoque mínimo');
  p public.products;
begin
  perform private.check_product_photos(p_photos, me.store_id);
  insert into public.products (store_id, name, variant, barcode, min_stock, photos)
  values (me.store_id, v_name, v_variant, v_barcode, v_min_stock, p_photos)
  returning * into p;
  return private.product_json(p);
end;
$$;

-- Parâmetros nulos mantêm o valor atual.
create or replace function public.update_product(
  p_id uuid,
  p_name text default null,
  p_variant text default null,
  p_barcode text default null,
  p_min_stock integer default null,
  p_photos text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_manager();
  p public.products;
begin
  if p_name is not null then
    perform private.clean_text(p_name, 'o nome do produto', 150, true);
  end if;
  perform private.clean_text(p_variant, 'a variação', 100);
  perform private.clean_text(p_barcode, 'o código de barras', 64);
  perform private.check_quantity(p_min_stock, 'O estoque mínimo');
  if p_photos is not null then
    perform private.check_product_photos(p_photos, me.store_id);
  end if;
  update public.products set
    name = coalesce(btrim(p_name), name),
    variant = coalesce(btrim(p_variant), variant),
    barcode = coalesce(btrim(p_barcode), barcode),
    min_stock = coalesce(p_min_stock, min_stock),
    photos = coalesce(p_photos, photos),
    updated_at = now()
  where id = p_id and store_id = me.store_id
  returning * into p;
  if p.id is null then
    raise exception 'Produto não encontrado.' using errcode = 'P0002';
  end if;
  return private.product_json(p);
end;
$$;

create or replace function public.import_products(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_manager();
  item jsonb;
  v_name text;
  v_variant text;
  v_barcode text;
  v_min_stock integer;
  v_raw_min text;
  created_count integer := 0;
  p public.products;
  result jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A lista de produtos para importação não pode ser vazia.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 1000 then
    raise exception 'Importe no máximo 1.000 produtos por vez.' using errcode = '22023';
  end if;

  for item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) <> 'object' then
      continue;
    end if;
    v_name := btrim(coalesce(item ->> 'name', ''));
    if v_name = '' then
      continue;
    end if;
    v_name := left(v_name, 150);

    v_variant := btrim(coalesce(item ->> 'variant', ''));
    v_barcode := btrim(coalesce(item ->> 'barcode', ''));
    if length(v_variant) > 100 or length(v_barcode) > 64 then
      raise exception 'Produto "%": variação até 100 caracteres e código de barras até 64.', left(v_name, 40)
        using errcode = '22023';
    end if;

    v_min_stock := null;
    v_raw_min := btrim(coalesce(item ->> 'min_stock', ''));
    if v_raw_min ~ '^[0-9]+$' then
      if length(v_raw_min) > 7 or v_raw_min::integer > 1000000 then
        raise exception 'Produto "%": estoque mínimo deve ficar entre 0 e 1.000.000.', left(v_name, 40)
          using errcode = '22023';
      end if;
      v_min_stock := v_raw_min::integer;
    end if;

    insert into public.products (store_id, name, variant, barcode, min_stock, photos)
    values (me.store_id, v_name, v_variant, v_barcode, v_min_stock, '{}')
    returning * into p;

    result := result || jsonb_build_array(private.product_json(p));
    created_count := created_count + 1;
  end loop;

  if created_count = 0 then
    raise exception 'Nenhum produto válido encontrado para importação.' using errcode = '22023';
  end if;

  return jsonb_build_object('count', created_count, 'products', result);
end;
$$;

-- =========================================================================
-- Áreas
-- =========================================================================

create or replace function public.create_area(p_name text, p_description text default '', p_product_ids uuid[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_manager();
  v_name text := private.clean_text(p_name, 'o nome da área', 100, true);
  v_description text := private.clean_text(p_description, 'a descrição da área', 500);
  a public.areas;
begin
  insert into public.areas (store_id, name, description)
  values (me.store_id, v_name, v_description)
  returning * into a;
  perform private.set_area_products(a.id, p_product_ids, me.store_id);
  return private.area_json(a);
end;
$$;

create or replace function public.update_area(
  p_id uuid,
  p_name text default null,
  p_description text default null,
  p_product_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_manager();
  a public.areas;
begin
  if p_name is not null then
    perform private.clean_text(p_name, 'o nome da área', 100, true);
  end if;
  perform private.clean_text(p_description, 'a descrição da área', 500);
  update public.areas set
    name = coalesce(btrim(p_name), name),
    description = coalesce(btrim(p_description), description),
    updated_at = now()
  where id = p_id and store_id = me.store_id
  returning * into a;
  if a.id is null then
    raise exception 'Área não encontrada.' using errcode = 'P0002';
  end if;
  if p_product_ids is not null then
    perform private.set_area_products(a.id, p_product_ids, me.store_id);
  end if;
  return private.area_json(a);
end;
$$;

-- =========================================================================
-- Contagens
-- =========================================================================

create or replace function public.create_tasks(
  p_area_ids uuid[],
  p_assignee_id uuid default null,
  p_due_date date default null,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_member();
  v_note text := private.clean_text(p_note, 'a observação', 1000);
  assignee uuid := p_assignee_id;
  v_area_id uuid;
  existing public.tasks;
  t public.tasks;
  result jsonb := '[]'::jsonb;
begin
  if coalesce(cardinality(p_area_ids), 0) = 0 then
    raise exception 'Selecione ao menos uma área.' using errcode = '22023';
  end if;
  if cardinality(p_area_ids) > 200 then
    raise exception 'Selecione no máximo 200 áreas por vez.' using errcode = '22023';
  end if;
  if me.role = 'employee' then
    if cardinality(p_area_ids) <> 1 then
      raise exception 'Funcionários só podem iniciar contagem para uma área de cada vez.' using errcode = '42501';
    end if;
    assignee := me.id;
  elsif assignee is not null and not exists (
    select 1 from public.profiles u where u.id = assignee and u.store_id = me.store_id and u.active
  ) then
    raise exception 'Responsável não encontrado nesta loja.' using errcode = '22023';
  end if;

  foreach v_area_id in array p_area_ids loop
    -- Serializa a criação por área para não abrir duas contagens simultâneas.
    perform 1 from public.areas a where a.id = v_area_id and a.store_id = me.store_id for update;
    if not found then
      continue;
    end if;

    select * into existing from public.tasks x
    where x.area_id = v_area_id and x.status <> 'approved'
    order by x.created_at desc limit 1;
    if existing.id is not null then
      result := result || jsonb_build_array(private.task_summary_json(existing));
      continue;
    end if;

    insert into public.tasks (store_id, area_id, status, due_date, assignee_id, note)
    values (me.store_id, v_area_id, 'open', p_due_date, assignee, v_note)
    returning * into t;

    insert into public.task_items (task_id, product_id, name, variant, photo, ai_status, ai_note)
    select t.id, p.id, p.name, p.variant, p.photos[1], 'manual', ''
    from public.area_products ap join public.products p on p.id = ap.product_id
    where ap.area_id = t.area_id;

    perform private.add_event(t.id, 'Criada por ' || me.name);
    result := result || jsonb_build_array(private.task_summary_json(t));
  end loop;
  return result;
end;
$$;

-- p_patch aceita as chaves assignee_id, due_date e note; null limpa o campo.
create or replace function public.update_task(p_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_manager();
  t public.tasks := private.lock_task(p_id, me.store_id);
  new_assignee uuid;
  new_due date;
begin
  if jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'Envie as alterações como objeto {assignee_id, due_date, note}.' using errcode = '22023';
  end if;
  if p_patch ? 'assignee_id' then
    begin
      new_assignee := nullif(p_patch ->> 'assignee_id', '')::uuid;
    exception when others then
      raise exception 'Responsável não encontrado nesta loja.' using errcode = '22023';
    end;
    if new_assignee is not null and not exists (
      select 1 from public.profiles u where u.id = new_assignee and u.store_id = me.store_id and u.active
    ) then
      raise exception 'Responsável não encontrado nesta loja.' using errcode = '22023';
    end if;
    update public.tasks set assignee_id = new_assignee where id = t.id;
  end if;
  if p_patch ? 'due_date' then
    begin
      new_due := nullif(p_patch ->> 'due_date', '')::date;
    exception when others then
      raise exception 'Data de entrega inválida. Use o formato AAAA-MM-DD.' using errcode = '22023';
    end;
    update public.tasks set due_date = new_due where id = t.id;
  end if;
  if p_patch ? 'note' then
    update public.tasks set note = private.clean_text(p_patch ->> 'note', 'a observação', 1000) where id = t.id;
  end if;
  update public.tasks set updated_at = now() where id = t.id;
  return private.task_detail_json(t.id, me.store_id);
end;
$$;

create or replace function public.switch_to_manual(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_member();
  t public.tasks := private.lock_task(p_id, me.store_id);
  c record;
begin
  perform private.require_task_actor(me, t);
  if t.status not in ('open', 'review', 'analyzing') then
    raise exception 'Ação não permitida para o status atual da contagem.' using errcode = '55000';
  end if;
  -- Cancela análises pendentes (ex.: app fechado no meio da seleção de quadros).
  for c in select id from public.captures where task_id = t.id and status = 'processing' loop
    update public.captures
    set status = 'failed', stage = null, error = 'Análise cancelada: contagem manual selecionada.', updated_at = now()
    where id = c.id;
  end loop;
  update public.tasks
  set status = 'review', updated_at = now(), assignee_id = coalesce(assignee_id, me.id)
  where id = t.id;
  update public.task_items
  set ai_status = 'manual', ai_quantity = null, ai_note = 'Contagem manual iniciada'
  where task_id = t.id;
  perform private.add_event(t.id, 'Contagem manual selecionada por ' || me.name);
  return private.task_detail_json(t.id, me.store_id);
end;
$$;

create or replace function public.submit_task(p_id uuid, p_counts jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_member();
  t public.tasks := private.lock_task(p_id, me.store_id);
begin
  perform private.require_task_actor(me, t);
  if t.status <> 'review' then
    raise exception 'Apenas contagens em revisão podem ser enviadas.' using errcode = '55000';
  end if;
  perform private.check_counts(t.id, p_counts, true);
  update public.task_items i set counted = (p_counts ->> i.product_id::text)::integer
  where i.task_id = t.id;
  update public.tasks set
    status = 'submitted', recount_requested = false, updated_at = now(),
    submitted_at = now(), submitted_by_id = me.id
  where id = t.id;
  perform private.add_event(t.id, 'Enviada para aprovação por ' || me.name);
  return private.task_detail_json(t.id, me.store_id);
end;
$$;

-- =========================================================================
-- Capturas
-- =========================================================================

create or replace function public.start_capture(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_member();
  t public.tasks;
  c public.captures;
  v_limit integer;
  v_used integer;
begin
  -- Serializa as capturas da loja: sem esta trava, chamadas simultâneas em
  -- contagens diferentes liam a mesma contagem de uso e furavam o limite diário.
  perform 1 from public.stores s where s.id = me.store_id for update;
  perform private.expire_stale_captures(me.store_id);
  t := private.lock_task(p_task_id, me.store_id);
  perform private.require_task_actor(me, t);
  if t.status not in ('open', 'review') then
    raise exception 'Capturas só podem ser enviadas para contagens em aberto ou em revisão.' using errcode = '55000';
  end if;

  select s.daily_capture_limit into v_limit from public.stores s where s.id = me.store_id;
  select count(*) into v_used from public.captures x
  where x.store_id = me.store_id and x.created_at > now() - interval '24 hours';
  if v_used >= v_limit then
    raise exception 'Limite de % análises por dia desta loja atingido. Faça a conferência manual ou tente mais tarde.', v_limit
      using errcode = '53400';
  end if;

  insert into public.captures (task_id, store_id, status, stage, by_user_id)
  values (t.id, me.store_id, 'processing', 'frames', me.id)
  returning * into c;
  update public.tasks
  set status = 'analyzing', updated_at = now(), assignee_id = coalesce(assignee_id, me.id)
  where id = t.id;
  update public.task_items set counted = null where task_id = t.id;
  perform private.add_event(t.id, 'Vídeo enviado por ' || me.name);
  return jsonb_build_object(
    'capture_id', c.id,
    'upload_prefix', me.store_id::text || '/captures/' || c.id::text || '/'
  );
end;
$$;

-- O celular informa que não conseguiu extrair ou enviar os quadros.
create or replace function public.fail_capture(p_capture_id uuid, p_error text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_member();
  c public.captures;
begin
  select * into c from public.captures where id = p_capture_id and store_id = me.store_id;
  if c.id is null then
    raise exception 'Captura não encontrada.' using errcode = 'P0002';
  end if;
  if me.role = 'employee' and c.by_user_id is distinct from me.id then
    raise exception 'Somente quem iniciou a captura pode cancelá-la.' using errcode = '42501';
  end if;
  perform private.fail_capture(c.id, p_error);
  return private.task_detail_json(c.task_id, me.store_id);
end;
$$;

-- p_frames: [{id: "f0001", path, timestamp_seconds, metrics, fingerprint, ...}]
-- Antes, comparações com NULL ("jsonb_typeof(null) <> 'array'" é NULL, não true)
-- deixavam p_frames ou p_primary_frame_id nulos passarem pela validação
-- (achado do fuzzing em supabase/tests/fuzz.test.ts).
create or replace function public.register_capture_frames(
  p_capture_id uuid,
  p_frames jsonb,
  p_selected_frame_ids text[],
  p_primary_frame_id text,
  p_selection jsonb default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_member();
  c public.captures;
  prefix text;
  f jsonb;
  ids text[];
begin
  select * into c from public.captures where id = p_capture_id and store_id = me.store_id for update;
  if c.id is null then
    raise exception 'Captura não encontrada.' using errcode = 'P0002';
  end if;
  if c.status <> 'processing' or c.stage is distinct from 'frames' then
    raise exception 'Esta captura não aceita mais quadros.' using errcode = '55000';
  end if;
  if c.by_user_id is distinct from me.id then
    raise exception 'Somente quem iniciou a captura pode enviar os quadros.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_frames) is distinct from 'array' or jsonb_array_length(p_frames) not between 1 and 40 then
    raise exception 'Envie entre 1 e 40 quadros.' using errcode = '22023';
  end if;
  if p_selection is not null and jsonb_typeof(p_selection) <> 'object' then
    raise exception 'Seleção de quadros inválida.' using errcode = '22023';
  end if;

  prefix := me.store_id::text || '/captures/' || c.id::text || '/';
  for f in select * from jsonb_array_elements(p_frames) loop
    if jsonb_typeof(f) is distinct from 'object'
      or coalesce(f ->> 'id', '') !~ '^f[0-9]{4}$'
      or f ->> 'path' is distinct from prefix || (f ->> 'id') || '.jpg'
      or jsonb_typeof(f -> 'timestamp_seconds') is distinct from 'number'
      or (f ->> 'timestamp_seconds')::numeric < 0
      or not exists (select 1 from storage.objects o where o.bucket_id = 'media' and o.name = f ->> 'path') then
      raise exception 'Quadro inválido ou não enviado: %',
        case when jsonb_typeof(f) = 'object' then left(coalesce(f ->> 'id', '?'), 20) else '?' end
        using errcode = '22023';
    end if;
  end loop;

  select array_agg(x ->> 'id') into ids from jsonb_array_elements(p_frames) x;
  if cardinality(ids) <> (select count(distinct i) from unnest(ids) i) then
    raise exception 'Quadros com identificadores repetidos.' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_selected_frame_ids), 0) not between 1 and 10
    or not coalesce(p_selected_frame_ids <@ ids, false)
    or p_primary_frame_id is null
    or not coalesce(p_primary_frame_id = any (p_selected_frame_ids), false) then
    raise exception 'Seleção de quadros inválida.' using errcode = '22023';
  end if;

  update public.captures set
    frames = p_frames,
    selected_frame_ids = p_selected_frame_ids,
    primary_frame_id = p_primary_frame_id,
    selection = coalesce(p_selection, '{}'::jsonb),
    stage = 'identifying',
    updated_at = now()
  where id = c.id;
end;
$$;
