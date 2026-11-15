alter table public."Pedidos" add column porc_comision double precision;
comment on column public."Pedidos".porc_comision is
  '% del pedido que el cadete rinde a la empresa; se copia de Datos_cotiz.Porc_Comision al aceptar (estado -> asignado)';

create or replace function public.congelar_porc_comision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id_cadete is null then
    new.porc_comision := null;
  elsif new.estado_pedido = 'asignado'
        and old.estado_pedido is distinct from 'asignado'
        and new.porc_comision is null then
    select "Porc_Comision" into new.porc_comision
    from public."Datos_cotiz" order by id limit 1;
  end if;
  return new;
end;
$$;

create trigger congelar_porc_comision
before update of estado_pedido, id_cadete on public."Pedidos"
for each row execute function public.congelar_porc_comision();

update public."Pedidos"
set porc_comision = (select "Porc_Comision" from public."Datos_cotiz" order by id limit 1)
where id_cadete is not null
  and estado_pedido not in ('libre', 'en_confirmacion', 'pendiente');

alter publication supabase_realtime add table public."Datos_cotiz";
