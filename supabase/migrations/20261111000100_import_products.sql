-- Adiciona suporte a importação de produtos em lote (CSV/XLSX)
-- e indicador de fotos pendentes.

create or replace function private.product_json(p public.products)
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
    'pending_photos', coalesce(cardinality(p.photos) = 0, true),
    'area_ids', coalesce(
      (select jsonb_agg(ap.area_id order by ap.area_id) from public.area_products ap where ap.product_id = p.id),
      '[]'::jsonb
    )
  )
  from total t;
$$;

create or replace function public.import_products(
  p_items jsonb
)
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
  created_count integer := 0;
  p public.products;
  result jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A lista de produtos para importação não pode ser vazia.' using errcode = '22023';
  end if;

  for item in select * from jsonb_array_elements(p_items) loop
    v_name := btrim(coalesce(item ->> 'name', ''));
    if v_name = '' then
      continue;
    end if;
    if length(v_name) > 150 then
      v_name := substring(v_name from 1 for 150);
    end if;

    v_variant := btrim(coalesce(item ->> 'variant', ''));
    v_barcode := btrim(coalesce(item ->> 'barcode', ''));
    v_min_stock := null;
    if item ? 'min_stock' and (item ->> 'min_stock') ~ '^[0-9]+$' then
      v_min_stock := (item ->> 'min_stock')::integer;
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

  return jsonb_build_object(
    'count', created_count,
    'products', result
  );
end;
$$;

grant execute on function public.import_products(jsonb) to authenticated;
