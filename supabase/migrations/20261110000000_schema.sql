-- ContaBot: schema, segurança (RLS) e storage.
--
-- Leitura direta das tabelas é liberada só para membros ativos da mesma loja.
-- Toda escrita passa por funções RPC (security definer) em 20261110000100_rpc.sql,
-- que validam papel, loja e transições de estado como o antigo backend FastAPI.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- =========================================================================
-- Tabelas
-- =========================================================================

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  role text not null check (role in ('manager', 'employee')),
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index profiles_store_idx on public.profiles (store_id);

-- Hash SHA-256 do código de acesso do funcionário. Sem políticas: só funções
-- security definer e o service role (Edge Functions) enxergam esta tabela.
create table public.access_codes (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  code_hash text not null unique,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 150),
  variant text not null default '',
  barcode text not null default '',
  min_stock integer check (min_stock >= 0),
  -- Caminhos no bucket "media": {store_id}/products/{arquivo}.jpg
  photos text[] not null default '{}',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_store_idx on public.products (store_id, archived);

create table public.areas (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index areas_store_idx on public.areas (store_id);

create table public.area_products (
  area_id uuid not null references public.areas (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  position integer not null default 0,
  primary key (area_id, product_id)
);
create index area_products_product_idx on public.area_products (product_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  area_id uuid not null references public.areas (id) on delete cascade,
  status text not null check (status in ('open', 'analyzing', 'review', 'submitted', 'approved')),
  recount_requested boolean not null default false,
  due_date date,
  assignee_id uuid references public.profiles (id) on delete set null,
  note text not null default '',
  manager_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  submitted_by_id uuid references public.profiles (id) on delete set null
);
create index tasks_store_status_idx on public.tasks (store_id, status);
create index tasks_area_idx on public.tasks (area_id);
create index tasks_assignee_idx on public.tasks (assignee_id);

create table public.task_items (
  task_id uuid not null references public.tasks (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null,
  variant text not null default '',
  photo text,
  ai_quantity integer,
  ai_status text not null default 'manual' check (ai_status in ('ok', 'check', 'missing', 'manual')),
  ai_note text not null default '',
  evidence_frame text,
  counted integer check (counted >= 0),
  final integer check (final >= 0),
  primary key (task_id, product_id)
);

create table public.task_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks (id) on delete cascade,
  created_at timestamptz not null default now(),
  text text not null
);
create index task_events_task_idx on public.task_events (task_id);

-- Uma captura = um vídeo. O celular escolhe os quadros e envia só as imagens
-- (bucket "media": {store_id}/captures/{capture_id}/{frame_id}.jpg).
create table public.captures (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  status text not null check (status in ('processing', 'done', 'failed')),
  -- frames: celular selecionando/enviando; identifying/counting: Edge Function.
  stage text check (stage in ('frames', 'identifying', 'counting')),
  -- Etapa já assumida por uma execução da Edge Function (evita análise duplicada).
  claimed_stage text,
  error text,
  -- Quadros enviados: [{id, path, timestamp_seconds, metrics, fingerprint, ...}]
  frames jsonb not null default '[]',
  selected_frame_ids text[] not null default '{}',
  primary_frame_id text,
  selection jsonb not null default '{}',
  identification jsonb,
  -- Quadros usados na contagem, exibidos na revisão: [{id, path, timestamp_seconds}]
  result_frames jsonb not null default '[]',
  unknown_products jsonb not null default '[]',
  simulated boolean not null default false,
  model text,
  usage jsonb not null default '{}',
  by_user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index captures_task_idx on public.captures (task_id, created_at desc);

create table public.stock_entries (
  id bigint generated always as identity primary key,
  store_id uuid not null references public.stores (id) on delete cascade,
  area_id uuid not null references public.areas (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  quantity integer not null check (quantity >= 0),
  task_id uuid references public.tasks (id) on delete set null,
  counted_at timestamptz not null default now()
);
create index stock_entries_lookup_idx on public.stock_entries (store_id, product_id, area_id, counted_at desc);

-- =========================================================================
-- Identidade do usuário logado
-- =========================================================================

create function public.my_store_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.store_id from public.profiles p where p.id = auth.uid() and p.active;
$$;

create function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.role = 'manager' from public.profiles p where p.id = auth.uid() and p.active),
    false
  );
$$;

-- Perfil ativo do chamador, ou erro. Usado por todas as RPCs.
create function private.require_member()
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then
    raise exception 'Sessão inválida ou expirada. Faça login novamente.' using errcode = '28000';
  end if;
  if not me.active then
    raise exception 'Este usuário foi desativado.' using errcode = '28000';
  end if;
  return me;
end;
$$;

create function private.require_manager()
returns public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_member();
begin
  if me.role <> 'manager' then
    raise exception 'Acesso restrito ao gerente da loja.' using errcode = '42501';
  end if;
  return me;
end;
$$;

-- =========================================================================
-- Cadastro do gerente: o signUp com {name, store_name} cria a loja e o perfil.
-- Funcionários não passam por aqui: a Edge Function create-employee cria o
-- usuário e insere o perfil com o service role.
-- =========================================================================

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_store_id uuid;
  user_name text := btrim(coalesce(new.raw_user_meta_data ->> 'name', ''));
  store_name text := btrim(coalesce(new.raw_user_meta_data ->> 'store_name', ''));
begin
  if store_name = '' then
    return new; -- usuário sem loja (ex.: funcionário criado pelo service role)
  end if;
  if user_name = '' then
    raise exception 'Informe o nome do gerente.';
  end if;
  insert into public.stores (name) values (store_name) returning id into new_store_id;
  insert into public.profiles (id, store_id, name, role, email)
  values (new.id, new_store_id, user_name, 'manager', lower(new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- =========================================================================
-- RLS: leitura apenas dentro da própria loja; nenhuma escrita direta
-- =========================================================================

alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.access_codes enable row level security;
alter table public.products enable row level security;
alter table public.areas enable row level security;
alter table public.area_products enable row level security;
alter table public.tasks enable row level security;
alter table public.task_items enable row level security;
alter table public.task_events enable row level security;
alter table public.captures enable row level security;
alter table public.stock_entries enable row level security;

create policy "membros leem a loja" on public.stores
  for select to authenticated using (id = public.my_store_id());
create policy "membros leem a equipe" on public.profiles
  for select to authenticated using (store_id = public.my_store_id());
create policy "membros leem produtos" on public.products
  for select to authenticated using (store_id = public.my_store_id());
create policy "membros leem áreas" on public.areas
  for select to authenticated using (store_id = public.my_store_id());
create policy "membros leem produtos das áreas" on public.area_products
  for select to authenticated using (
    exists (select 1 from public.areas a where a.id = area_id and a.store_id = public.my_store_id())
  );
create policy "membros leem contagens" on public.tasks
  for select to authenticated using (store_id = public.my_store_id());
create policy "membros leem itens" on public.task_items
  for select to authenticated using (
    exists (select 1 from public.tasks t where t.id = task_id and t.store_id = public.my_store_id())
  );
create policy "membros leem eventos" on public.task_events
  for select to authenticated using (
    exists (select 1 from public.tasks t where t.id = task_id and t.store_id = public.my_store_id())
  );
create policy "membros leem capturas" on public.captures
  for select to authenticated using (store_id = public.my_store_id());
create policy "membros leem estoque" on public.stock_entries
  for select to authenticated using (store_id = public.my_store_id());

revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on public.access_codes from anon, authenticated;

-- =========================================================================
-- Storage: bucket privado, uma pasta por loja
-- =========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "membros leem mídia da loja" on storage.objects
  for select to authenticated using (
    bucket_id = 'media' and (storage.foldername(name))[1] = public.my_store_id()::text
  );

create policy "membros enviam mídia da loja" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = public.my_store_id()::text
    and (
      (storage.foldername(name))[2] = 'captures'
      or ((storage.foldername(name))[2] = 'products' and public.is_manager())
    )
  );
