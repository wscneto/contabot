-- ContaBot: regras de negócio expostas como RPC (supabase.rpc).
--
-- Cada função reproduz um endpoint do antigo backend FastAPI e devolve o mesmo
-- formato JSON, para que o app mude apenas a camada de acesso (src/services/api.ts).
-- Mídias são devolvidas como caminhos do bucket "media"; o app os troca por
-- URLs assinadas.

-- =========================================================================
-- Serializadores (schema private: não expostos pela API)
-- =========================================================================

create function private.user_json(u public.profiles)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', u.id, 'name', u.name, 'role', u.role, 'email', u.email,
    'active', u.active, 'created_at', u.created_at
  );
$$;

create function private.product_json(p public.products)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select distinct on (se.area_id) se.quantity
    from public.stock_entries se
    where se.product_id = p.id
    order by se.area_id, se.counted_at desc, se.id desc
  ),
  total as (select sum(quantity)::integer as stock from latest)
  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'variant', p.variant,
    'barcode', p.barcode,
    'min_stock', p.min_stock,
    'photos', to_jsonb(p.photos),
    'stock', t.stock,
    'last_counted_at', (select max(se.counted_at) from public.stock_entries se where se.product_id = p.id),
    'low_stock', coalesce(p.min_stock is not null and t.stock is not null and t.stock < p.min_stock, false),
    'area_ids', coalesce(
      (select jsonb_agg(ap.area_id order by ap.area_id) from public.area_products ap where ap.product_id = p.id),
      '[]'::jsonb
    )
  )
  from total t;
$$;

create function private.area_json(a public.areas)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id,
    'name', a.name,
    'description', a.description,
    'product_ids', coalesce(
      (select jsonb_agg(ap.product_id order by ap.position) from public.area_products ap where ap.area_id = a.id),
      '[]'::jsonb
    ),
    'product_count', (select count(*) from public.area_products ap where ap.area_id = a.id),
    'last_counted_at', (
      select max(t.approved_at) from public.tasks t where t.area_id = a.id and t.status = 'approved'
    ),
    'open_task_id', (
      select t.id from public.tasks t
      where t.area_id = a.id and t.status <> 'approved'
      order by t.created_at desc limit 1
    )
  );
$$;

create function private.task_summary_json(t public.tasks)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id,
    'area_id', t.area_id,
    'area_name', (select a.name from public.areas a where a.id = t.area_id),
    'status', t.status,
    'recount_requested', t.recount_requested,
    'due_date', t.due_date,
    'overdue', coalesce(t.due_date < current_date and t.status not in ('submitted', 'approved'), false),
    'assignee', (select jsonb_build_object('id', u.id, 'name', u.name) from public.profiles u where u.id = t.assignee_id),
    'note', t.note,
    'manager_note', t.manager_note,
    'item_count', (select count(*) from public.task_items i where i.task_id = t.id),
    'attention_count', case when t.status = 'review' then (
      select count(*) from public.task_items i
      where i.task_id = t.id and i.ai_status in ('check', 'missing', 'manual') and i.counted is null
    ) else 0 end,
    'created_at', t.created_at,
    'updated_at', t.updated_at,
    'submitted_at', t.submitted_at,
    'approved_at', t.approved_at,
    'submitted_by', (select jsonb_build_object('id', u.id, 'name', u.name) from public.profiles u where u.id = t.submitted_by_id)
  );
$$;

create function private.task_detail_json(p_task_id uuid, p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.tasks;
  a public.areas;
  c public.captures;
  result jsonb;
begin
  select * into t from public.tasks where id = p_task_id and store_id = p_store_id;
  if t.id is null then
    raise exception 'Contagem não encontrada.' using errcode = 'P0002';
  end if;
  select * into a from public.areas where id = t.area_id;
  select * into c from public.captures where task_id = t.id order by created_at desc limit 1;

  result := private.task_summary_json(t) || jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id', i.product_id,
        'name', i.name,
        'variant', i.variant,
        'photo', i.photo,
        'ai_quantity', i.ai_quantity,
        'ai_status', i.ai_status,
        'ai_note', i.ai_note,
        'evidence_frame', i.evidence_frame,
        'counted', i.counted,
        'final', i.final,
        'previous', (
          select se.quantity from public.stock_entries se
          where se.area_id = t.area_id and se.product_id = i.product_id
            and se.task_id is distinct from t.id
          order by se.counted_at desc, se.id desc limit 1
        )
      ) order by i.name)
      from public.task_items i where i.task_id = t.id
    ), '[]'::jsonb),
    'capture', case when c.id is null then null else jsonb_build_object(
      'id', c.id,
      'status', c.status,
      'stage', c.stage,
      'error', c.error,
      'frames', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', f ->> 'id', 'url', f ->> 'path', 'timestamp_seconds', (f ->> 'timestamp_seconds')::numeric
        ))
        from jsonb_array_elements(c.result_frames) f
      ), '[]'::jsonb),
      'unknown_products', c.unknown_products,
      'simulated', c.simulated,
      'created_at', c.created_at,
      'by', (select jsonb_build_object('id', u.id, 'name', u.name) from public.profiles u where u.id = c.by_user_id)
    ) end,
    'capture_count', (select count(*) from public.captures x where x.task_id = t.id),
    'area', jsonb_build_object('id', a.id, 'name', a.name, 'description', a.description),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('at', e.created_at, 'text', e.text) order by e.id)
      from public.task_events e where e.task_id = t.id
    ), '[]'::jsonb)
  );
  return result;
end;
$$;

create function private.add_event(p_task_id uuid, p_text text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.task_events (task_id, text) values (p_task_id, p_text);
$$;

-- Tarefa da loja do chamador, travada para atualização, ou erro 404.
create function private.lock_task(p_task_id uuid, p_store_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tasks;
begin
  select * into t from public.tasks where id = p_task_id and store_id = p_store_id for update;
  if t.id is null then
    raise exception 'Contagem não encontrada.' using errcode = 'P0002';
  end if;
  return t;
end;
$$;

-- =========================================================================
-- Códigos de acesso (mesmo algoritmo da Edge Function join-store)
-- =========================================================================

create function private.new_access_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(8);
  raw text := '';
begin
  -- 256 é múltiplo de 32: o resto não enviesa nenhum caractere.
  for i in 0..7 loop
    raw := raw || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return raw;
end;
$$;

create function private.hash_access_code(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(upper(regexp_replace(p_raw, '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex');
$$;

-- Encerra as sessões do usuário (refresh tokens). Tokens de acesso já emitidos
-- expiram sozinhos (1 h por padrão); as RPCs também recusam perfis inativos.
create function private.revoke_sessions(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.sessions where user_id = p_user_id;
$$;

-- =========================================================================
-- Sessão e equipe
-- =========================================================================

create function public.whoami()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_member();
begin
  return jsonb_build_object(
    'user', private.user_json(me),
    'store', (select jsonb_build_object('id', s.id, 'name', s.name) from public.stores s where s.id = me.store_id)
  );
end;
$$;

create function public.list_team()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_manager();
begin
  return coalesce((
    select jsonb_agg(private.user_json(u) || jsonb_build_object(
      'open_tasks', (select count(*) from public.tasks t where t.assignee_id = u.id and t.status <> 'approved')
    ) order by u.role desc, u.name)
    from public.profiles u where u.store_id = me.store_id
  ), '[]'::jsonb);
end;
$$;

create function public.regenerate_access_code(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_manager();
  target public.profiles;
  raw text;
begin
  select * into target from public.profiles where id = p_user_id and store_id = me.store_id;
  if target.id is null then
    raise exception 'Funcionário não encontrado.' using errcode = 'P0002';
  end if;
  if target.role <> 'employee' then
    raise exception 'Código de acesso só pode ser gerado para funcionários.' using errcode = '22023';
  end if;
  if not target.active then
    raise exception 'Este funcionário foi desativado.' using errcode = '22023';
  end if;

  raw := private.new_access_code();
  insert into public.access_codes (user_id, code_hash) values (target.id, private.hash_access_code(raw))
  on conflict (user_id) do update set code_hash = excluded.code_hash, created_at = now();
  perform private.revoke_sessions(target.id);

  return jsonb_build_object(
    'user', private.user_json(target),
    'access_code', substr(raw, 1, 4) || '-' || substr(raw, 5, 4)
  );
end;
$$;

create function public.deactivate_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_manager();
begin
  if p_user_id = me.id then
    raise exception 'Você não pode desativar seu próprio usuário gerente.' using errcode = '22023';
  end if;
  update public.profiles set active = false where id = p_user_id and store_id = me.store_id;
  if not found then
    raise exception 'Funcionário não encontrado.' using errcode = 'P0002';
  end if;
  delete from public.access_codes where user_id = p_user_id;
  update public.tasks set assignee_id = null where assignee_id = p_user_id;
  perform private.revoke_sessions(p_user_id);
end;
$$;

-- =========================================================================
-- Produtos
-- =========================================================================

create function private.check_product_photos(p_photos text[], p_store_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  photo text;
begin
  if coalesce(cardinality(p_photos), 0) not between 1 and 4 then
    raise exception 'Envie de 1 a 4 fotos do produto.' using errcode = '22023';
  end if;
  foreach photo in array p_photos loop
    if photo not like p_store_id::text || '/products/%'
      or not exists (select 1 from storage.objects o where o.bucket_id = 'media' and o.name = photo) then
      raise exception 'Foto inválida ou não enviada: %', photo using errcode = '22023';
    end if;
  end loop;
end;
$$;

create function public.list_products()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_member();
begin
  return coalesce((
    select jsonb_agg(private.product_json(p) order by p.name)
    from public.products p where p.store_id = me.store_id and not p.archived
  ), '[]'::jsonb);
end;
$$;

create function public.get_product(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_member();
  p public.products;
begin
  select * into p from public.products where id = p_id and store_id = me.store_id;
  if p.id is null then
    raise exception 'Produto não encontrado.' using errcode = 'P0002';
  end if;
  return private.product_json(p) || jsonb_build_object('history', coalesce((
    select jsonb_agg(h order by h.counted_at desc)
    from (
      select se.area_id, a.name as area_name, se.quantity, se.counted_at
      from public.stock_entries se join public.areas a on a.id = se.area_id
      where se.product_id = p.id and se.store_id = me.store_id
      order by se.counted_at desc limit 20
    ) h
  ), '[]'::jsonb));
end;
$$;

create function public.create_product(
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
  p public.products;
begin
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'O nome do produto é obrigatório.' using errcode = '22023';
  end if;
  perform private.check_product_photos(p_photos, me.store_id);
  insert into public.products (store_id, name, variant, barcode, min_stock, photos)
  values (me.store_id, btrim(p_name), btrim(coalesce(p_variant, '')), btrim(coalesce(p_barcode, '')), p_min_stock, p_photos)
  returning * into p;
  return private.product_json(p);
end;
$$;

-- Parâmetros nulos mantêm o valor atual (como o PATCH do backend antigo).
create function public.update_product(
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
  if p_photos is not null then
    perform private.check_product_photos(p_photos, me.store_id);
  end if;
  if p_name is not null and btrim(p_name) = '' then
    raise exception 'O nome do produto é obrigatório.' using errcode = '22023';
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

create function public.archive_product(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_manager();
begin
  update public.products set archived = true, updated_at = now() where id = p_id and store_id = me.store_id;
  if not found then
    raise exception 'Produto não encontrado.' using errcode = 'P0002';
  end if;
  delete from public.area_products where product_id = p_id;
end;
$$;

-- =========================================================================
-- Áreas
-- =========================================================================

create function private.set_area_products(p_area_id uuid, p_product_ids uuid[], p_store_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(cardinality(p_product_ids), 0) <> (select count(distinct x) from unnest(p_product_ids) x) then
    raise exception 'Produtos repetidos na área.' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_product_ids, '{}')) pid
    where not exists (
      select 1 from public.products p where p.id = pid and p.store_id = p_store_id and not p.archived
    )
  ) then
    raise exception 'Produto não encontrado nesta loja.' using errcode = '22023';
  end if;
  delete from public.area_products where area_id = p_area_id;
  insert into public.area_products (area_id, product_id, position)
  select p_area_id, pid, ord - 1 from unnest(coalesce(p_product_ids, '{}')) with ordinality as x(pid, ord);
end;
$$;

create function public.list_areas()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_member();
begin
  return coalesce((
    select jsonb_agg(private.area_json(a) order by a.name)
    from public.areas a where a.store_id = me.store_id
  ), '[]'::jsonb);
end;
$$;

create function public.get_area(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_member();
  a public.areas;
begin
  select * into a from public.areas where id = p_id and store_id = me.store_id;
  if a.id is null then
    raise exception 'Área não encontrada.' using errcode = 'P0002';
  end if;
  return private.area_json(a) || jsonb_build_object('products', coalesce((
    select jsonb_agg(private.product_json(p) || jsonb_build_object('stock', (
      select se.quantity from public.stock_entries se
      where se.store_id = me.store_id and se.area_id = a.id and se.product_id = p.id
      order by se.counted_at desc, se.id desc limit 1
    )) order by ap.position)
    from public.area_products ap join public.products p on p.id = ap.product_id
    where ap.area_id = a.id
  ), '[]'::jsonb));
end;
$$;

create function public.create_area(p_name text, p_description text default '', p_product_ids uuid[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_manager();
  a public.areas;
begin
  insert into public.areas (store_id, name, description)
  values (me.store_id, btrim(p_name), btrim(coalesce(p_description, '')))
  returning * into a;
  perform private.set_area_products(a.id, p_product_ids, me.store_id);
  return private.area_json(a);
end;
$$;

create function public.update_area(
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

create function public.delete_area(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_manager();
begin
  delete from public.areas where id = p_id and store_id = me.store_id;
  if not found then
    raise exception 'Área não encontrada.' using errcode = 'P0002';
  end if;
end;
$$;

-- =========================================================================
-- Contagens
-- =========================================================================

create function public.list_tasks(p_scope text default 'mine', p_statuses text[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_member();
  mine boolean := me.role <> 'manager' or coalesce(p_scope, 'mine') = 'mine';
begin
  return coalesce((
    select jsonb_agg(private.task_summary_json(t) order by t.created_at desc)
    from public.tasks t
    where t.store_id = me.store_id
      and (not mine or (
        (t.assignee_id = me.id or t.assignee_id is null)
        and (t.status <> 'approved' or t.approved_at >= now() - interval '30 days')
      ))
      and (p_statuses is null or cardinality(p_statuses) = 0 or t.status = any (p_statuses))
  ), '[]'::jsonb);
end;
$$;

create function public.get_task(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_member();
begin
  return private.task_detail_json(p_id, me.store_id);
end;
$$;

create function public.create_tasks(
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
  assignee uuid := p_assignee_id;
  v_area_id uuid;
  existing public.tasks;
  t public.tasks;
  result jsonb := '[]'::jsonb;
begin
  if coalesce(cardinality(p_area_ids), 0) = 0 then
    raise exception 'Selecione ao menos uma área.' using errcode = '22023';
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
    values (me.store_id, v_area_id, 'open', p_due_date, assignee, btrim(coalesce(p_note, '')))
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
create function public.update_task(p_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_manager();
  t public.tasks := private.lock_task(p_id, me.store_id);
  new_assignee uuid;
begin
  if p_patch ? 'assignee_id' then
    new_assignee := nullif(p_patch ->> 'assignee_id', '')::uuid;
    if new_assignee is not null and not exists (
      select 1 from public.profiles u where u.id = new_assignee and u.store_id = me.store_id and u.active
    ) then
      raise exception 'Responsável não encontrado nesta loja.' using errcode = '22023';
    end if;
    update public.tasks set assignee_id = new_assignee where id = t.id;
  end if;
  if p_patch ? 'due_date' then
    update public.tasks set due_date = nullif(p_patch ->> 'due_date', '')::date where id = t.id;
  end if;
  if p_patch ? 'note' then
    update public.tasks set note = btrim(coalesce(p_patch ->> 'note', '')) where id = t.id;
  end if;
  update public.tasks set updated_at = now() where id = t.id;
  return private.task_detail_json(t.id, me.store_id);
end;
$$;

create function public.delete_task(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_manager();
  t public.tasks := private.lock_task(p_id, me.store_id);
begin
  if t.status = 'approved' then
    raise exception 'Contagens aprovadas não podem ser excluídas.' using errcode = '55000';
  end if;
  delete from public.tasks where id = t.id;
end;
$$;

-- Falha de análise: nunca deixa a contagem presa em "analyzing".
create function private.fail_capture(p_capture_id uuid, p_error text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.captures;
  clean_error text := left(coalesce(nullif(btrim(p_error), ''), 'Falha desconhecida.'), 700);
begin
  select * into c from public.captures where id = p_capture_id for update;
  if c.id is null or c.status <> 'processing' then
    return false;
  end if;
  update public.captures set status = 'failed', stage = null, error = clean_error, updated_at = now()
  where id = c.id;
  update public.tasks set status = 'review', updated_at = now()
  where id = c.task_id and status = 'analyzing';
  update public.task_items
  set ai_quantity = null, ai_status = 'manual', ai_note = 'Análise falhou. Faça a conferência manual.'
  where task_id = c.task_id;
  perform private.add_event(c.task_id, 'Falha na análise do vídeo: ' || left(clean_error, 100));
  return true;
end;
$$;

create function public.switch_to_manual(p_id uuid)
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

-- p_counts: {"<product_id>": inteiro >= 0 | null} com exatamente os produtos da contagem.
create function private.check_counts(p_task_id uuid, p_counts jsonb, p_exact boolean)
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
  if jsonb_typeof(p_counts) <> 'object' then
    raise exception 'Envie as contagens como objeto {produto: quantidade}.' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(p_counts) loop
    if not exists (select 1 from public.task_items i where i.task_id = p_task_id and i.product_id::text = k) then
      raise exception 'Produto fora desta contagem: %', k using errcode = '22023';
    end if;
    if jsonb_typeof(v) not in ('number', 'null')
      or (jsonb_typeof(v) = 'number' and (v::numeric < 0 or v::numeric <> trunc(v::numeric))) then
      raise exception 'Quantidades devem ser inteiros não negativos ou vazias.' using errcode = '22023';
    end if;
  end loop;
  if p_exact and (select count(*) from public.task_items i where i.task_id = p_task_id)
     <> (select count(*) from jsonb_object_keys(p_counts)) then
    raise exception 'A lista de contagem deve incluir exatamente todos os produtos da área.' using errcode = '22023';
  end if;
end;
$$;

create function public.submit_task(p_id uuid, p_counts jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_member();
  t public.tasks := private.lock_task(p_id, me.store_id);
begin
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

create function public.approve_task(p_id uuid, p_counts jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_manager();
  t public.tasks := private.lock_task(p_id, me.store_id);
  counts jsonb := coalesce(p_counts, '{}'::jsonb);
begin
  if t.status not in ('submitted', 'review') then
    raise exception 'Apenas contagens enviadas ou em revisão podem ser aprovadas.' using errcode = '55000';
  end if;
  perform private.check_counts(t.id, counts, false);
  update public.task_items i set final = case
    when counts ? i.product_id::text then (counts ->> i.product_id::text)::integer
    else i.counted
  end
  where i.task_id = t.id;
  insert into public.stock_entries (store_id, area_id, product_id, quantity, task_id)
  select me.store_id, t.area_id, i.product_id, i.final, t.id
  from public.task_items i where i.task_id = t.id and i.final is not null;
  update public.tasks set status = 'approved', recount_requested = false, updated_at = now(), approved_at = now()
  where id = t.id;
  perform private.add_event(t.id, 'Aprovada pelo gerente ' || me.name);
  return private.task_detail_json(t.id, me.store_id);
end;
$$;

create function public.request_recount(p_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_manager();
  t public.tasks := private.lock_task(p_id, me.store_id);
  v_note text := btrim(coalesce(p_note, ''));
begin
  if t.status <> 'submitted' then
    raise exception 'Apenas contagens enviadas podem receber solicitação de recontagem.' using errcode = '55000';
  end if;
  if length(v_note) not between 1 and 500 then
    raise exception 'Descreva o motivo da recontagem (até 500 caracteres).' using errcode = '22023';
  end if;
  update public.tasks set status = 'open', recount_requested = true, manager_note = v_note, updated_at = now()
  where id = t.id;
  perform private.add_event(t.id, 'Recontagem solicitada por ' || me.name || ': ' || left(v_note, 100));
  return private.task_detail_json(t.id, me.store_id);
end;
$$;

-- =========================================================================
-- Capturas: o celular cria a captura, envia os quadros e chama a Edge Function
-- =========================================================================

create function public.start_capture(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_member();
  t public.tasks := private.lock_task(p_task_id, me.store_id);
  c public.captures;
begin
  if t.status not in ('open', 'review') then
    raise exception 'Capturas só podem ser enviadas para contagens em aberto ou em revisão.' using errcode = '55000';
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

-- p_frames: [{id: "f0001", path, timestamp_seconds, metrics, fingerprint, ...}]
create function public.register_capture_frames(
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
  if c.status <> 'processing' or c.stage <> 'frames' then
    raise exception 'Esta captura não aceita mais quadros.' using errcode = '55000';
  end if;
  if c.by_user_id is distinct from me.id then
    raise exception 'Somente quem iniciou a captura pode enviar os quadros.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_frames) <> 'array' or jsonb_array_length(p_frames) not between 1 and 40 then
    raise exception 'Envie entre 1 e 40 quadros.' using errcode = '22023';
  end if;

  prefix := me.store_id::text || '/captures/' || c.id::text || '/';
  for f in select * from jsonb_array_elements(p_frames) loop
    if coalesce(f ->> 'id', '') !~ '^f[0-9]{4}$'
      or f ->> 'path' is distinct from prefix || (f ->> 'id') || '.jpg'
      or jsonb_typeof(f -> 'timestamp_seconds') <> 'number'
      or (f ->> 'timestamp_seconds')::numeric < 0
      or not exists (select 1 from storage.objects o where o.bucket_id = 'media' and o.name = f ->> 'path') then
      raise exception 'Quadro inválido ou não enviado: %', coalesce(f ->> 'id', '?') using errcode = '22023';
    end if;
  end loop;

  select array_agg(x ->> 'id') into ids from jsonb_array_elements(p_frames) x;
  if cardinality(ids) <> (select count(distinct i) from unnest(ids) i) then
    raise exception 'Quadros com identificadores repetidos.' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_selected_frame_ids), 0) not between 1 and 10
    or not (p_selected_frame_ids <@ ids)
    or not (p_primary_frame_id = any (p_selected_frame_ids)) then
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

-- O celular informa que não conseguiu extrair ou enviar os quadros.
create function public.fail_capture(p_capture_id uuid, p_error text)
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
  perform private.fail_capture(c.id, p_error);
  return private.task_detail_json(c.task_id, me.store_id);
end;
$$;

-- =========================================================================
-- Pipeline de IA (somente service role, chamado pela Edge Function)
-- =========================================================================

-- Marca a etapa como em execução; false se outra invocação já a assumiu.
create function public.pipeline_claim(p_capture_id uuid, p_stage text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.captures set claimed_stage = p_stage, updated_at = now()
  where id = p_capture_id and status = 'processing' and stage = p_stage
    and claimed_stage is distinct from p_stage;
  return found;
end;
$$;

create function public.pipeline_set_stage(p_capture_id uuid, p_stage text, p_identification jsonb default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.captures set
    stage = p_stage,
    identification = coalesce(p_identification, identification),
    updated_at = now()
  where id = p_capture_id and status = 'processing';
  return found;
end;
$$;

create function public.pipeline_fail(p_capture_id uuid, p_error text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select private.fail_capture(p_capture_id, p_error);
$$;

-- p_items: [{product_id, ai_quantity, ai_status, ai_note, evidence_frame, counted}]
create function public.pipeline_finish(
  p_capture_id uuid,
  p_result_frames jsonb,
  p_unknown_products jsonb,
  p_items jsonb,
  p_event text,
  p_model text default null,
  p_usage jsonb default '{}',
  p_simulated boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.captures;
begin
  select * into c from public.captures where id = p_capture_id for update;
  if c.id is null or c.status <> 'processing' then
    return false; -- cancelada (ex.: contagem manual) enquanto o modelo respondia
  end if;
  update public.captures set
    status = 'done', stage = null, result_frames = p_result_frames, unknown_products = p_unknown_products,
    model = p_model, usage = coalesce(p_usage, '{}'::jsonb), simulated = p_simulated, updated_at = now()
  where id = c.id;
  update public.tasks set status = 'review', updated_at = now()
  where id = c.task_id and status = 'analyzing';
  update public.task_items i set
    ai_quantity = (x ->> 'ai_quantity')::integer,
    ai_status = x ->> 'ai_status',
    ai_note = left(coalesce(x ->> 'ai_note', ''), 300),
    evidence_frame = x ->> 'evidence_frame',
    counted = (x ->> 'counted')::integer
  from jsonb_array_elements(p_items) x
  where i.task_id = c.task_id and i.product_id = (x ->> 'product_id')::uuid;
  perform private.add_event(c.task_id, p_event);
  return true;
end;
$$;

-- =========================================================================
-- Painel do gerente
-- =========================================================================

create function public.get_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_manager();
begin
  return jsonb_build_object(
    'counts', jsonb_build_object(
      'to_approve', (select count(*) from public.tasks where store_id = me.store_id and status = 'submitted'),
      'in_progress', (select count(*) from public.tasks where store_id = me.store_id and status in ('analyzing', 'review')),
      'open', (select count(*) from public.tasks where store_id = me.store_id and status = 'open'),
      'overdue', (
        select count(*) from public.tasks
        where store_id = me.store_id and due_date < current_date and status not in ('submitted', 'approved')
      )
    ),
    'to_approve', coalesce((
      select jsonb_agg(private.task_summary_json(t) order by t.submitted_at desc)
      from (select * from public.tasks where store_id = me.store_id and status = 'submitted'
            order by submitted_at desc limit 5) t
    ), '[]'::jsonb),
    'low_stock', coalesce((
      select jsonb_agg(y.j order by y.name)
      from (
        select x.j, x.name
        from (
          select private.product_json(p) as j, p.name
          from public.products p
          where p.store_id = me.store_id and not p.archived and p.min_stock is not null
        ) x
        where (x.j ->> 'low_stock')::boolean
        order by x.name
        limit 10
      ) y
    ), '[]'::jsonb),
    'stale_areas', coalesce((
      select jsonb_agg(y.j order by y.name)
      from (
        select x.j, x.name
        from (
          select private.area_json(a) as j, a.name
          from public.areas a where a.store_id = me.store_id
        ) x
        where x.j ->> 'last_counted_at' is null
           or (x.j ->> 'last_counted_at')::timestamptz < now() - interval '7 days'
        order by x.name
        limit 5
      ) y
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(private.task_summary_json(t) order by t.approved_at desc)
      from (select * from public.tasks where store_id = me.store_id and status = 'approved'
            order by approved_at desc limit 5) t
    ), '[]'::jsonb)
  );
end;
$$;

-- =========================================================================
-- Permissões de execução
-- =========================================================================

revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

grant execute on function
  public.my_store_id(),
  public.is_manager(),
  public.whoami(),
  public.list_team(),
  public.regenerate_access_code(uuid),
  public.deactivate_member(uuid),
  public.list_products(),
  public.get_product(uuid),
  public.create_product(text, text[], text, text, integer),
  public.update_product(uuid, text, text, text, integer, text[]),
  public.archive_product(uuid),
  public.list_areas(),
  public.get_area(uuid),
  public.create_area(text, text, uuid[]),
  public.update_area(uuid, text, text, uuid[]),
  public.delete_area(uuid),
  public.list_tasks(text, text[]),
  public.get_task(uuid),
  public.create_tasks(uuid[], uuid, date, text),
  public.update_task(uuid, jsonb),
  public.delete_task(uuid),
  public.switch_to_manual(uuid),
  public.submit_task(uuid, jsonb),
  public.approve_task(uuid, jsonb),
  public.request_recount(uuid, text),
  public.start_capture(uuid),
  public.register_capture_frames(uuid, jsonb, text[], text, jsonb),
  public.fail_capture(uuid, text),
  public.get_dashboard()
to authenticated;

grant execute on function
  public.pipeline_claim(uuid, text),
  public.pipeline_set_stage(uuid, text, jsonb),
  public.pipeline_fail(uuid, text),
  public.pipeline_finish(uuid, jsonb, jsonb, jsonb, text, text, jsonb, boolean)
to service_role;

-- Novas funções criadas por migrations futuras não ficam públicas por padrão.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
