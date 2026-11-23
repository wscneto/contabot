-- Exportação CSV de contagens aprovadas: restrita ao gerente da loja.
create function public.export_approved_task(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me public.profiles := private.require_manager();
  t public.tasks;
  a public.areas;
begin
  select * into t from public.tasks where id = p_id and store_id = me.store_id;
  if t.id is null then
    raise exception 'Contagem não encontrada.' using errcode = 'P0002';
  end if;
  if t.status <> 'approved' then
    raise exception 'Apenas contagens aprovadas podem ser exportadas.' using errcode = '55000';
  end if;

  select * into a from public.areas where id = t.area_id;

  return jsonb_build_object(
    'id', t.id,
    'area_name', coalesce(a.name, 'contagem'),
    'approved_at', t.approved_at,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'barcode', coalesce(p.barcode, ''),
        'name', i.name,
        'variant', i.variant,
        'quantity', coalesce(i.final, i.counted, 0)
      ) order by i.name, i.variant)
      from public.task_items i
      left join public.products p on p.id = i.product_id
      where i.task_id = t.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.export_approved_task(uuid) from public, anon;
grant execute on function public.export_approved_task(uuid) to authenticated;
