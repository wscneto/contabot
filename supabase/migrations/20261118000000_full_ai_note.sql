-- Remove o corte em 300 caracteres do feedback da IA (ai_note) salvo ao concluir a análise.

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
    counted = (x ->> 'counted')::integer
  from jsonb_array_elements(p_items) x
  where i.task_id = c.task_id and i.product_id = (x ->> 'product_id')::uuid;
  perform private.add_event(c.task_id, p_event);
  return true;
end;
$$;
