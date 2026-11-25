-- Contagem por marcação: o modelo desenha uma caixa por unidade e o servidor
-- conta as caixas. As marcações ficam em task_items.ai_marks para a tela de
-- conferência desenhá-las sobre o quadro de evidência.
--
-- ai_marks: {frame, width, height, boxes: [[x_min, y_min, x_max, y_max] em 0–1000],
--            marked, duplicates_removed, method: marked|layout, facings, depth, depth_frame}

alter table public.task_items add column ai_marks jsonb;

create or replace function public.pipeline_finish(
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
    ai_note = coalesce(x ->> 'ai_note', ''),
    evidence_frame = x ->> 'evidence_frame',
    ai_marks = case when jsonb_typeof(x -> 'ai_marks') = 'object' then x -> 'ai_marks' end,
    counted = (x ->> 'counted')::integer
  from jsonb_array_elements(p_items) x
  where i.task_id = c.task_id and i.product_id = (x ->> 'product_id')::uuid;
  perform private.add_event(c.task_id, p_event);
  return true;
end;
$$;

create or replace function private.task_detail_json(p_task_id uuid, p_store_id uuid)
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
        'ai_marks', i.ai_marks,
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
