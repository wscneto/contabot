-- Correções de robustez e custo (branch correcoes).
--
-- 1. Capturas presas expiram sozinhas. Uma captura fica em "processing" para
--    sempre quando o app fecha no meio do envio dos quadros ou quando a Edge
--    Function é interrompida depois de assumir a etapa (pipeline_claim impede
--    nova tentativa). Agora, ao listar ou abrir contagens, capturas paradas há
--    tempo demais falham e a contagem volta para a conferência manual.
-- 2. Limite diário de capturas por loja, para o cadastro aberto não consumir a
--    chave de IA sem controle.

alter table public.stores
  add column daily_capture_limit integer not null default 30 check (daily_capture_limit > 0);

-- Tempo máximo sem progresso, por etapa. O celular fica em "frames" enquanto
-- escolhe e envia os quadros; "identifying" e "counting" são a Edge Function,
-- que atualiza updated_at a cada etapa (até duas chamadas ao modelo).
create function private.expire_stale_captures(p_store_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  expired integer := 0;
begin
  for c in
    select id, stage from public.captures
    where store_id = p_store_id
      and status = 'processing'
      and (
        (stage = 'frames' and updated_at < now() - interval '15 minutes')
        or (stage in ('identifying', 'counting') and updated_at < now() - interval '10 minutes')
      )
  loop
    if private.fail_capture(
      c.id,
      case when c.stage = 'frames'
        then 'O envio dos quadros foi interrompido (app fechado ou sem conexão). Filme novamente ou faça a conferência manual.'
        else 'A análise demorou demais e foi interrompida. Filme novamente ou faça a conferência manual.'
      end
    ) then
      expired := expired + 1;
    end if;
  end loop;
  return expired;
end;
$$;

revoke execute on function private.expire_stale_captures(uuid) from public, anon, authenticated;

-- Leituras usadas pelo app em polling: deixam de ser "stable" para poderem
-- expirar capturas paradas antes de responder. O resto do corpo é o original.

create or replace function public.list_tasks(p_scope text default 'mine', p_statuses text[] default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_member();
  mine boolean := me.role <> 'manager' or coalesce(p_scope, 'mine') = 'mine';
begin
  perform private.expire_stale_captures(me.store_id);
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

create or replace function public.get_task(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_member();
begin
  perform private.expire_stale_captures(me.store_id);
  return private.task_detail_json(p_id, me.store_id);
end;
$$;

-- start_capture: expira capturas paradas antes de travar a contagem e aplica o
-- limite diário da loja (janela de 24 horas, contando todas as capturas).
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
  perform private.expire_stale_captures(me.store_id);
  t := private.lock_task(p_task_id, me.store_id);
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
