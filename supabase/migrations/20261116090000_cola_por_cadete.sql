-- =========================================================================
-- COLA DE PEDIDOS POR CADETE (etapa 2 del asignador en el servidor)
-- =========================================================================
-- Si no hay ningún cadete libre, el pedido nuevo se le ofrece a un cadete que está en viaje, para que lo
-- haga apenas termine: primero al que va a quedar más cerca, es decir, aquel cuyo DESTINO actual está más
-- cerca del RETIRO del pedido nuevo.
--   * El cadete tiene que aceptar (misma oferta de 20 s). Si acepta, el pedido queda 'en_cola' a su nombre.
--   * Un solo pedido en cola por cadete.
--   * Al terminar su viaje, el pedido en cola pasa solo a 'asignado'.
--   * Si en 15 minutos no terminó el viaje, el pedido vuelve a la búsqueda.
--   * Rechazar una oferta de cola no lo descarta: cuando quede libre se le puede ofrecer normalmente.
--   * Si nadie puede tomarlo ni encolarlo, el pedido espera hasta 15 minutos (antes 60 s) y se cancela.
-- La vuelta atrás está al final del archivo.

alter table public.ofertas_pedido add column para_cola boolean not null default false;
comment on column public.ofertas_pedido.para_cola is
  'true = se le ofreció a un cadete en viaje, para hacerlo al terminar';

drop index public.pedidos_en_busqueda_idx;
create index pedidos_en_busqueda_idx on public."Pedidos" (creado_en)
  where estado_pedido in ('pendiente', 'libre', 'en_confirmacion', 'en_cola');

-- Un solo pedido en cola por cadete
create unique index pedidos_uno_en_cola_por_cadete on public."Pedidos" (id_cadete)
  where estado_pedido = 'en_cola';

comment on column public."Pedidos".espera_desde is
  'Desde cuándo se espera que se libere un cadete; en ''en_cola'', desde cuándo está en la cola del cadete';

-- -------------------------------------------------------------------------
-- Sin oferta vigente: ofrecer a un libre, encolar a uno en viaje, esperar o cancelar
-- -------------------------------------------------------------------------
create or replace function asignador.ofrecer_siguiente(p_id_pedido bigint)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_pedido       public."Pedidos";
  v_intentos     integer;
  v_cercania     boolean;
  v_id_cadete    bigint;
  v_distancia    double precision;
  v_para_cola    boolean := false;
  v_hay_ocupados boolean;
  v_motivo       text;
begin
  select * into v_pedido from public."Pedidos" where id_pedido = p_id_pedido;

  select count(*) into v_intentos from public.ofertas_pedido where id_pedido = p_id_pedido;
  v_cercania := v_intentos < 3 and v_pedido.latitud_org is not null and v_pedido.longitud_org is not null;

  -- Cadetes en turno (señal en los últimos 75 s) y qué se puede hacer con cada uno:
  --   libre     = 'disponible', sin ofertas, viaje ni cola, y este pedido todavía no se le ofreció para ya;
  --   encolable = en viaje, sin oferta abierta ni pedido en cola, y este pedido nunca se le ofreció;
  --   ocupado   = no está libre pero todavía podría recibir este pedido cuando se libere.
  with en_turno as (
    select c.id_cad, c.estado_cad, s.lat, s.lng, s.ubicacion_en,
           v.id_pedido as id_viaje, v.latitud_dest, v.longitud_dest,
           exists (select 1 from public."Pedidos" p
                   where p.id_cadete = c.id_cad and p.estado_pedido in ('libre', 'en_confirmacion', 'en_cola')) as con_oferta_o_cola,
           exists (select 1 from public.ofertas_pedido o
                   where o.id_pedido = p_id_pedido and o.id_cadete = c.id_cad and not o.para_cola) as ya_ofrecido,
           exists (select 1 from public.ofertas_pedido o
                   where o.id_pedido = p_id_pedido and o.id_cadete = c.id_cad) as ya_ofrecido_alguna_vez
    from public."Cadetes" c
    join public.cadetes_senal s on s.id_cad = c.id_cad
    left join lateral (
      select p.id_pedido, p.latitud_dest, p.longitud_dest
      from public."Pedidos" p
      where p.id_cadete = c.id_cad and p.estado_pedido in ('asignado', 'en_camino_entrega')
      order by p.creado_en limit 1
    ) v on true
    where s.ultima_senal > now() - interval '75 seconds'
      and c.estado_cad in ('disponible', 'en_confirmacion', 'ocupado')
  ), clasificado as (
    select id_cad,
           (estado_cad = 'disponible' and id_viaje is null and not con_oferta_o_cola and not ya_ofrecido) as libre,
           (id_viaje is not null and not con_oferta_o_cola and not ya_ofrecido_alguna_vez) as encolable,
           not ya_ofrecido as pendiente_de_oferta,
           -- libre: desde donde está el cadete hasta el retiro
           case when v_cercania and ubicacion_en is not null and lat is not null and lng is not null
                then asignador.distancia_km(lat, lng, v_pedido.latitud_org, v_pedido.longitud_org) end as distancia,
           -- en viaje: desde el destino de su viaje (donde va a quedar) hasta el retiro
           case when v_cercania and latitud_dest is not null and longitud_dest is not null
                then asignador.distancia_km(latitud_dest, longitud_dest, v_pedido.latitud_org, v_pedido.longitud_org) end as distancia_cola
    from en_turno
  ), elegido as (
    select * from (
      (select id_cad, distancia, false as para_cola from clasificado where libre
       order by distancia nulls last, id_cad limit 1)
      union all
      (select id_cad, distancia_cola, true from clasificado where encolable
       order by distancia_cola nulls last, id_cad limit 1)
    ) x order by para_cola limit 1  -- un libre siempre va antes que encolar
  )
  select (select id_cad from elegido), (select distancia from elegido), coalesce((select para_cola from elegido), false),
         exists (select 1 from clasificado where not libre and pendiente_de_oferta)
    into v_id_cadete, v_distancia, v_para_cola, v_hay_ocupados;

  -- A) Hay a quién ofrecérselo: a un libre (para ya) o a uno en viaje (para su cola)
  if v_id_cadete is not null then
    update public."Pedidos"
    set id_cadete = v_id_cadete, estado_pedido = 'libre',
        oferta_vence_en = now() + interval '20 seconds',
        espera_desde = case when v_para_cola then espera_desde else null end
    where id_pedido = p_id_pedido
    returning * into v_pedido;

    insert into public.ofertas_pedido (id_pedido, id_cadete, vence_en, distancia_km, por_cercania, para_cola)
    values (p_id_pedido, v_id_cadete, v_pedido.oferta_vence_en, v_distancia, v_cercania, v_para_cola);

    perform asignador.avisar('pedidos-cadete-' || v_id_cadete, 'nuevo_pedido',
      to_jsonb(v_pedido) || jsonb_build_object('para_cola', v_para_cola));
    return;
  end if;

  -- B) Nadie disponible ahora, pero hay cadetes ocupados que lo pueden tomar al liberarse: esperar hasta 15 min
  if v_hay_ocupados then
    if v_pedido.espera_desde is null then
      update public."Pedidos" set espera_desde = now() where id_pedido = p_id_pedido;
      return;
    end if;
    if now() - v_pedido.espera_desde < interval '15 minutes' then
      return;
    end if;
    v_motivo := 'Ningún cadete se liberó a tiempo';
  elsif v_intentos > 0 then
    v_motivo := 'Todos los cadetes rechazaron el pedido';
  else
    v_motivo := 'No hay cadetes conectados';
  end if;

  -- C) No queda nadie a quien ofrecerle el pedido
  update public."Pedidos"
  set id_cadete = null, estado_pedido = 'cancelado', motivo_cancelacion = v_motivo,
      oferta_vence_en = null, espera_desde = null
  where id_pedido = p_id_pedido;
end;
$$;

-- -------------------------------------------------------------------------
-- Pasa a 'asignado' el pedido en cola de un cadete que ya no tiene viaje
-- -------------------------------------------------------------------------
create function asignador.promover(p_id_cad bigint)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_pedido public."Pedidos";
begin
  perform asignador.entrar();

  if exists (select 1 from public."Pedidos"
             where id_cadete = p_id_cad and estado_pedido in ('asignado', 'en_camino_entrega')) then
    return;
  end if;

  update public."Pedidos"
  set estado_pedido = 'asignado', espera_desde = null, oferta_vence_en = null
  where id_cadete = p_id_cad and estado_pedido = 'en_cola'
  returning * into v_pedido;

  if found then
    perform asignador.avisar('pedidos-cadete-' || p_id_cad, 'pedido_en_cola_asignado', to_jsonb(v_pedido));
  end if;
end;
$$;

-- -------------------------------------------------------------------------
-- Revisión de un pedido: ahora también atiende los que están en cola
-- -------------------------------------------------------------------------
create or replace function asignador.revisar(p_id_pedido bigint)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_pedido public."Pedidos";
begin
  perform asignador.entrar();

  select * into v_pedido from public."Pedidos" where id_pedido = p_id_pedido for update;
  if not found or v_pedido.estado_pedido not in ('pendiente', 'libre', 'en_confirmacion', 'en_cola') then
    return;
  end if;

  -- En la cola de un cadete
  if v_pedido.estado_pedido = 'en_cola' then
    if v_pedido.id_cadete is not null and not exists (
         select 1 from public."Pedidos"
         where id_cadete = v_pedido.id_cadete and estado_pedido in ('asignado', 'en_camino_entrega')) then
      -- El cadete ya no tiene viaje (respaldo del trigger asignador_al_terminar_viaje)
      perform asignador.promover(v_pedido.id_cadete);
      return;
    end if;
    if v_pedido.id_cadete is not null and v_pedido.espera_desde is not null
       and now() - v_pedido.espera_desde < interval '15 minutes' then
      return;  -- sigue esperando a que el cadete termine su viaje
    end if;

    -- El cadete no terminó a tiempo: el pedido vuelve a la búsqueda
    update public."Pedidos"
    set id_cadete = null, estado_pedido = 'pendiente', espera_desde = null, oferta_vence_en = null
    where id_pedido = p_id_pedido;
    if v_pedido.id_cadete is not null then
      perform asignador.avisar('pedidos-cadete-' || v_pedido.id_cadete, 'pedido_retirado',
        jsonb_build_object('id_pedido', p_id_pedido, 'id_cadete', v_pedido.id_cadete));
    end if;
    perform asignador.ofrecer_siguiente(p_id_pedido);
    return;
  end if;

  -- Búsqueda que lleva más de 30 minutos (hora del servidor): se cancela en vez de seguir ofreciéndola.
  -- Se conserva id_cadete para que el cadete con la oferta abierta reciba la cancelación en su canal.
  if v_pedido.creado_en < now() - interval '30 minutes' then
    update public."Pedidos"
    set estado_pedido = 'cancelado', motivo_cancelacion = 'La búsqueda de cadete venció',
        oferta_vence_en = null, espera_desde = null
    where id_pedido = p_id_pedido;
    perform asignador.cerrar_oferta(p_id_pedido, 'retirada');
    if v_pedido.id_cadete is not null then
      perform asignador.avisar('pedidos-cadete-' || v_pedido.id_cadete, 'pedido_retirado',
        jsonb_build_object('id_pedido', p_id_pedido, 'id_cadete', v_pedido.id_cadete));
    end if;
    return;
  end if;

  if v_pedido.id_cadete is not null and v_pedido.estado_pedido in ('libre', 'en_confirmacion') then
    if v_pedido.oferta_vence_en is null then
      update public."Pedidos" set oferta_vence_en = now() + interval '20 seconds' where id_pedido = p_id_pedido;
      return;
    end if;
    if now() < v_pedido.oferta_vence_en then
      return;  -- seguir esperando la respuesta de este cadete
    end if;

    -- No respondió a tiempo: retirarle la oferta y cerrarle el modal
    update public."Pedidos"
    set id_cadete = null, estado_pedido = 'pendiente', oferta_vence_en = null
    where id_pedido = p_id_pedido;
    perform asignador.cerrar_oferta(p_id_pedido, 'vencida');
    perform asignador.avisar('pedidos-cadete-' || v_pedido.id_cadete, 'pedido_retirado',
      jsonb_build_object('id_pedido', p_id_pedido, 'id_cadete', v_pedido.id_cadete));
  elsif v_pedido.id_cadete is not null then
    update public."Pedidos" set id_cadete = null, oferta_vence_en = null where id_pedido = p_id_pedido;
    perform asignador.cerrar_oferta(p_id_pedido, 'retirada');
  end if;

  perform asignador.ofrecer_siguiente(p_id_pedido);
end;
$$;

create or replace function asignador.tick()
returns void
language plpgsql
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select id_pedido from public."Pedidos"
    where estado_pedido in ('pendiente', 'libre', 'en_confirmacion', 'en_cola')
    order by creado_en
  loop
    begin
      perform asignador.revisar(r.id_pedido);
    exception when others then
      raise warning 'asignador.tick: pedido #%: %', r.id_pedido, sqlerrm;
    end;
  end loop;
end;
$$;

-- -------------------------------------------------------------------------
-- Guardia: 'en_cola' también es del servidor
-- -------------------------------------------------------------------------
create or replace function public.asignador_guardia()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('asignador.interno', true), '') = '1' then
    return new;
  end if;

  if old.estado_pedido in ('pendiente', 'libre', 'en_confirmacion', 'en_cola')
     and (new.estado_pedido is distinct from old.estado_pedido or new.id_cadete is distinct from old.id_cadete) then
    raise exception 'La asignación de pedidos la maneja el servidor. Actualizá la app.'
      using errcode = 'P0001', hint = 'Usar cadete_aceptar_pedido / cadete_rechazar_pedido / cancelar_pedido_cliente';
  end if;

  if new.estado_pedido in ('pendiente', 'libre', 'en_confirmacion', 'en_cola')
     and old.estado_pedido is distinct from new.estado_pedido then
    raise exception 'Un pedido no puede volver a la búsqueda de cadete.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- -------------------------------------------------------------------------
-- Al terminar un viaje, el pedido en cola de ese cadete pasa a ser su viaje
-- -------------------------------------------------------------------------
create function public.asignador_al_terminar_viaje()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform asignador.promover(old.id_cadete);
  exception when others then
    -- Un problema con la cola nunca puede frenar la entrega; el latido lo retoma a los 3 s
    raise warning 'asignador_al_terminar_viaje: cadete #%: %', old.id_cadete, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.asignador_al_terminar_viaje() from public, anon, authenticated;

create trigger asignador_al_terminar_viaje
after update of estado_pedido on public."Pedidos"
for each row
when (old.estado_pedido in ('asignado', 'en_camino_entrega')
      and new.estado_pedido not in ('asignado', 'en_camino_entrega')
      and old.id_cadete is not null)
execute function public.asignador_al_terminar_viaje();

-- -------------------------------------------------------------------------
-- Funciones para las apps
-- -------------------------------------------------------------------------

-- Aceptar. Devuelve { ok: true, pedido } (viaje nuevo), { ok: true, en_cola: true, pedido, id_pedido_en_curso }
-- (quedó en su cola), { ok: false, motivo: 'no_vigente' } o { ok: false, motivo: 'viaje_en_curso', id_pedido_en_curso }.
create or replace function public.cadete_aceptar_pedido(p_id_pedido bigint, p_id_cad bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido    public."Pedidos";
  v_viaje     bigint;
  v_para_cola boolean;
begin
  perform asignador.entrar();

  select id_pedido into v_viaje
  from public."Pedidos"
  where id_cadete = p_id_cad and estado_pedido in ('asignado', 'en_camino_entrega') and id_pedido <> p_id_pedido
  limit 1;

  if v_viaje is not null then
    select para_cola into v_para_cola
    from public.ofertas_pedido
    where id_pedido = p_id_pedido and id_cadete = p_id_cad and resultado is null;

    -- Oferta de cola: queda a su nombre para cuando termine el viaje (un solo pedido en cola por cadete)
    if coalesce(v_para_cola, false) and not exists (
         select 1 from public."Pedidos" where id_cadete = p_id_cad and estado_pedido = 'en_cola') then
      update public."Pedidos"
      set estado_pedido = 'en_cola', oferta_vence_en = null, espera_desde = now()
      where id_pedido = p_id_pedido and id_cadete = p_id_cad and estado_pedido in ('libre', 'en_confirmacion')
      returning * into v_pedido;

      if not found then
        return jsonb_build_object('ok', false, 'motivo', 'no_vigente');
      end if;
      perform asignador.cerrar_oferta(p_id_pedido, 'aceptada');
      return jsonb_build_object('ok', true, 'en_cola', true, 'pedido', to_jsonb(v_pedido), 'id_pedido_en_curso', v_viaje);
    end if;

    -- Oferta normal con un viaje en curso (dashboard en dos pestañas): nunca dos viajes, se devuelve
    update public."Pedidos"
    set id_cadete = null, estado_pedido = 'pendiente', oferta_vence_en = null
    where id_pedido = p_id_pedido and id_cadete = p_id_cad and estado_pedido in ('libre', 'en_confirmacion');
    if found then
      perform asignador.cerrar_oferta(p_id_pedido, 'rechazada');
      perform asignador.revisar(p_id_pedido);
    end if;
    return jsonb_build_object('ok', false, 'motivo', 'viaje_en_curso', 'id_pedido_en_curso', v_viaje);
  end if;

  -- Sin viaje en curso: es su viaje (también si era una oferta de cola y el viaje terminó mientras tanto)
  update public."Pedidos"
  set estado_pedido = 'asignado', oferta_vence_en = null, espera_desde = null
  where id_pedido = p_id_pedido and id_cadete = p_id_cad and estado_pedido in ('libre', 'en_confirmacion')
  returning * into v_pedido;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_vigente');
  end if;

  perform asignador.cerrar_oferta(p_id_pedido, 'aceptada');
  return jsonb_build_object('ok', true, 'pedido', to_jsonb(v_pedido));
end;
$$;

-- El cliente cancela un pedido propio que sigue buscando cadete o está en la cola de uno
create or replace function public.cancelar_pedido_cliente(p_id_pedido bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido public."Pedidos";
begin
  perform asignador.entrar();

  select * into v_pedido
  from public."Pedidos"
  where id_pedido = p_id_pedido and id_cliente = (select auth.uid())
    and estado_pedido in ('pendiente', 'libre', 'en_confirmacion', 'en_cola')
  for update;
  if not found then
    return false;
  end if;

  -- Se conserva id_cadete para que el cadete (con la oferta abierta o con el pedido en cola) reciba la cancelación
  update public."Pedidos"
  set estado_pedido = 'cancelado', motivo_cancelacion = 'Cancelado por el cliente',
      oferta_vence_en = null, espera_desde = null
  where id_pedido = p_id_pedido;
  perform asignador.cerrar_oferta(p_id_pedido, 'retirada');

  if v_pedido.id_cadete is not null then
    perform asignador.avisar('pedidos-cadete-' || v_pedido.id_cadete, 'pedido_retirado',
      jsonb_build_object('id_pedido', p_id_pedido, 'id_cadete', v_pedido.id_cadete));
  end if;
  return true;
end;
$$;

-- =========================================================================
-- VUELTA ATRÁS (a la etapa 1, sin cola): correr esto, volver a aplicar las funciones de
-- 20261115100000_asignador_en_servidor.sql (ofrecer_siguiente, revisar, tick, asignador_guardia,
-- cadete_aceptar_pedido, cancelar_pedido_cliente) y publicar las apps de antes de este cambio
-- =========================================================================
-- update public."Pedidos" set estado_pedido = 'pendiente', id_cadete = null, espera_desde = null where estado_pedido = 'en_cola';  -- con set_config('asignador.interno','1',true)
-- drop trigger asignador_al_terminar_viaje on public."Pedidos";
-- drop function public.asignador_al_terminar_viaje();
-- drop function asignador.promover(bigint);
-- drop index public.pedidos_uno_en_cola_por_cadete;
-- drop index public.pedidos_en_busqueda_idx;
-- create index pedidos_en_busqueda_idx on public."Pedidos" (creado_en) where estado_pedido in ('pendiente', 'libre', 'en_confirmacion');
-- alter table public.ofertas_pedido drop column para_cola;
