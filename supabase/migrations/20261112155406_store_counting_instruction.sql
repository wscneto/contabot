-- Instrução padrão compartilhada pelos membros da loja. Só o gerente altera.
alter table public.stores add column default_counting_instruction text not null
  default 'Filme somente a prateleira desta contagem, com os produtos parados. Comece com uma vista geral de cima e mova o celular devagar, mostrando a frente e as laterais das embalagens. Mantenha boa iluminação, evite reflexos e imagens tremidas. Mostre as unidades do fundo quando estiverem visíveis, sem mudar de prateleira.'
  check (length(btrim(default_counting_instruction)) between 1 and 2000);

create function public.get_store_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles := private.require_member();
begin
  return (select jsonb_build_object('default_counting_instruction', s.default_counting_instruction)
    from public.stores s where s.id = me.store_id);
end;
$$;

create function public.update_counting_instruction(p_instruction text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me public.profiles := private.require_manager();
begin
  if p_instruction is null or length(btrim(p_instruction)) not between 1 and 2000 then
    raise exception 'A instrução deve ter entre 1 e 2000 caracteres.' using errcode = '22023';
  end if;
  update public.stores set default_counting_instruction = btrim(p_instruction) where id = me.store_id;
  return public.get_store_settings();
end;
$$;

revoke all on function public.get_store_settings() from public, anon;
revoke all on function public.update_counting_instruction(text) from public, anon;
grant execute on function public.get_store_settings() to authenticated;
grant execute on function public.update_counting_instruction(text) to authenticated;
