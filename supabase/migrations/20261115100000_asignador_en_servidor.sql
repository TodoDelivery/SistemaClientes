-- =========================================================================
-- ASIGNADOR DE PEDIDOS EN EL SERVIDOR (reemplaza al motor P2P del navegador del cliente)
-- =========================================================================
-- Mismas reglas que scripts/script_asignacion.js (sección 7 del contrato):
--   * el pedido se ofrece a un único cadete por vez, primero al libre más cercano al retiro;
--   * después de 3 ofertas sin aceptar se sigue sin tener en cuenta la distancia (por id_cad);
--   * a un cadete que rechazó o no respondió no se le vuelve a ofrecer ese pedido;
--   * si todos están ocupados se espera hasta 60 s; si no queda nadie, el pedido se cancela con un motivo.
-- Quién está conectado y dónde: lo informa cada cadete con public.cadete_latido() cada ~15 s
-- (antes solo se sabía por Realtime Presence, que la base no ve).
-- Un trigger atiende el pedido al crearse y pg_cron lo revisa cada 3 s (vencimientos y esperas).
-- La vuelta atrás está al final del archivo.

create schema if not exists asignador;
revoke all on schema asignador from public, anon, authenticated;

-- -------------------------------------------------------------------------
-- TABLAS Y COLUMNAS
-- -------------------------------------------------------------------------

-- Señal de vida y última ubicación de cada cadete en turno
create table public.cadetes_senal (
  id_cad        bigint primary key references public."Cadetes"(id_cad) on delete cascade,
  ultima_senal  timestamptz not null default now(),
  lat           double precision,
  lng           double precision,
  ubicacion_en  timestamptz  -- hora del último fix GPS real; null = todavía sin GPS
);
comment on table public.cadetes_senal is
  'Latido de la app de cadetes: sin señal en 75 s el asignador lo considera desconectado';
-- Cerrada a las apps: solo se escribe con cadete_latido() y solo la lee el asignador
alter table public.cadetes_senal enable row level security;
revoke all on public.cadetes_senal from anon, authenticated;

-- Historial de ofertas de cada pedido (reemplaza la memoria de rechazos del navegador)
create table public.ofertas_pedido (
  id_oferta    bigint generated always as identity primary key,
  id_pedido    bigint not null references public."Pedidos"(id_pedido) on delete cascade,
  id_cadete    bigint not null references public."Cadetes"(id_cad) on delete cascade,
  ofrecida_en  timestamptz not null default now(),
  vence_en     timestamptz not null,
  resultado    text check (resultado in ('aceptada', 'rechazada', 'vencida', 'retirada')),  -- null = vigente
  resuelta_en  timestamptz,
  distancia_km double precision,  -- del cadete al retiro, si se conocía su ubicación
  por_cercania boolean not null default true
);
create index ofertas_pedido_id_pedido_idx on public.ofertas_pedido (id_pedido);
create index ofertas_pedido_id_cadete_idx on public.ofertas_pedido (id_cadete);
-- Una sola oferta vigente por pedido
create unique index ofertas_pedido_una_vigente on public.ofertas_pedido (id_pedido) where resultado is null;
alter table public.ofertas_pedido enable row level security;
revoke all on public.ofertas_pedido from anon, authenticated;

alter table public."Pedidos"
  add column creado_en          timestamptz not null default now(),
  add column motivo_cancelacion text,
  add column oferta_vence_en    timestamptz,
  add column espera_desde       timestamptz;
comment on column public."Pedidos".creado_en is
  'Hora del servidor en que se creó (fecha_pedido la manda el celular del cliente y puede estar corrida)';
comment on column public."Pedidos".motivo_cancelacion is 'Por qué se canceló (lo escribe el asignador)';
comment on column public."Pedidos".oferta_vence_en is 'Hasta cuándo tiene el cadete ofertado para responder';
comment on column public."Pedidos".espera_desde is 'Desde cuándo se espera que se libere un cadete ocupado';

create index pedidos_en_busqueda_idx on public."Pedidos" (creado_en)
  where estado_pedido in ('pendiente', 'libre', 'en_confirmacion');

-- -------------------------------------------------------------------------
-- INTERNOS (schema asignador: las apps no pueden llamarlos)
-- -------------------------------------------------------------------------

-- Distancia en línea recta (km), fórmula de Haversine
create function asignador.distancia_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql immutable
set search_path = ''
as $$
  select 2 * 6371 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )));
$$;

-- Aviso en vivo por Realtime Broadcast (los mismos canales públicos que usaban las apps).
-- Un problema con el aviso nunca frena la asignación: las apps también se enteran por la BD.
create function asignador.avisar(p_canal text, p_evento text, p_datos jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform realtime.send(p_datos, p_evento, p_canal, false);
exception when others then
  raise warning 'asignador.avisar(%, %): %', p_canal, p_evento, sqlerrm;
end;
$$;

-- Todas las decisiones del asignador van de a una (el volumen es chico y así no hay carreras entre
-- pedidos por el mismo cadete) y con la marca que deja pasar la guardia de "Pedidos".
create function asignador.entrar()
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(74110015);
  perform set_config('asignador.interno', '1', true);
end;
$$;

create function asignador.cerrar_oferta(p_id_pedido bigint, p_resultado text)
returns void
language sql
set search_path = ''
as $$
  update public.ofertas_pedido
  set resultado = p_resultado, resuelta_en = now()
  where id_pedido = p_id_pedido and resultado is null;
$$;

-- Sin oferta vigente: ofrecer al siguiente cadete, esperar a que se libere uno o cancelar
create function asignador.ofrecer_siguiente(p_id_pedido bigint)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_pedido      public."Pedidos";
  v_intentos    integer;
  v_cercania    boolean;
  v_id_cadete   bigint;
  v_distancia   double precision;
  v_hay_ocupados boolean;
  v_motivo      text;
begin
  select * into v_pedido from public."Pedidos" where id_pedido = p_id_pedido;

  select count(*) into v_intentos from public.ofertas_pedido where id_pedido = p_id_pedido;
  v_cercania := v_intentos < 3 and v_pedido.latitud_org is not null and v_pedido.longitud_org is not null;

  -- Cadetes en turno (con señal reciente) a los que todavía no se les ofreció este pedido.
  -- La señal llega cada 15 s; se toleran 75 s porque con la app en segundo plano el navegador
  -- puede demorar los temporizadores hasta un minuto.
  -- Libre = 'disponible' y sin ninguna oferta ni viaje a su nombre.
  with en_turno as (
    select c.id_cad,
           (c.estado_cad = 'disponible' and not exists (
              select 1 from public."Pedidos" p
              where p.id_cadete = c.id_cad
                and p.estado_pedido in ('libre', 'en_confirmacion', 'asignado', 'en_camino_entrega')
           )) as libre,
           case when v_cercania and s.ubicacion_en is not null and s.lat is not null and s.lng is not null
                then asignador.distancia_km(s.lat, s.lng, v_pedido.latitud_org, v_pedido.longitud_org)
           end as distancia
    from public."Cadetes" c
    join public.cadetes_senal s on s.id_cad = c.id_cad
    where s.ultima_senal > now() - interval '75 seconds'
      and c.estado_cad in ('disponible', 'en_confirmacion', 'ocupado')
      and not exists (
        select 1 from public.ofertas_pedido o where o.id_pedido = p_id_pedido and o.id_cadete = c.id_cad
      )
  ), elegido as (
    -- Por cercania: el más cercano; los que no tienen ubicación van al final. Si no, por id_cad.
    select id_cad, distancia from en_turno where libre order by distancia nulls last, id_cad limit 1
  )
  select (select id_cad from elegido), (select distancia from elegido),
         exists (select 1 from en_turno where not libre)
    into v_id_cadete, v_distancia, v_hay_ocupados;

  -- A) Hay un cadete libre que todavía no vio el pedido: ofrecérselo solo a él
  if v_id_cadete is not null then
    update public."Pedidos"
    set id_cadete = v_id_cadete, estado_pedido = 'libre',
        oferta_vence_en = now() + interval '20 seconds', espera_desde = null
    where id_pedido = p_id_pedido
    returning * into v_pedido;

    insert into public.ofertas_pedido (id_pedido, id_cadete, vence_en, distancia_km, por_cercania)
    values (p_id_pedido, v_id_cadete, v_pedido.oferta_vence_en, v_distancia, v_cercania);

    perform asignador.avisar('pedidos-cadete-' || v_id_cadete, 'nuevo_pedido', to_jsonb(v_pedido));
    return;
  end if;

  -- B) Nadie libre, pero hay cadetes ocupados que aún no lo vieron: esperar hasta 60 s
  if v_hay_ocupados then
    if v_pedido.espera_desde is null then
      update public."Pedidos" set espera_desde = now() where id_pedido = p_id_pedido;
      return;
    end if;
    if now() - v_pedido.espera_desde < interval '60 seconds' then
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

-- Revisa un pedido en búsqueda y actúa. Es idempotente: la llaman el trigger de alta, pg_cron y los rechazos.
create function asignador.revisar(p_id_pedido bigint)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_pedido public."Pedidos";
begin
  perform asignador.entrar();

  select * into v_pedido from public."Pedidos" where id_pedido = p_id_pedido for update;
  if not found or v_pedido.estado_pedido not in ('pendiente', 'libre', 'en_confirmacion') then
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
    -- Oferta vigente
    if v_pedido.oferta_vence_en is null then
      -- Oferta que no hizo este asignador (ej: quedó de antes de la migración): se le da el plazo normal
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
    -- 'pendiente' con cadete: estado inconsistente, se normaliza
    update public."Pedidos" set id_cadete = null, oferta_vence_en = null where id_pedido = p_id_pedido;
    perform asignador.cerrar_oferta(p_id_pedido, 'retirada');
  end if;

  perform asignador.ofrecer_siguiente(p_id_pedido);
end;
$$;

-- Latido: revisa todos los pedidos en búsqueda (lo corre pg_cron cada 3 s)
create function asignador.tick()
returns void
language plpgsql
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select id_pedido from public."Pedidos"
    where estado_pedido in ('pendiente', 'libre', 'en_confirmacion')
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
-- TRIGGERS SOBRE "Pedidos"
-- -------------------------------------------------------------------------

-- Guardia: durante la búsqueda solo el asignador mueve el estado y el cadete del pedido. Una pestaña
-- vieja con el motor P2P (o una app de cadetes sin actualizar) recibe este error en vez de competir.
create function public.asignador_guardia()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('asignador.interno', true), '') = '1' then
    return new;
  end if;

  if old.estado_pedido in ('pendiente', 'libre', 'en_confirmacion')
     and (new.estado_pedido is distinct from old.estado_pedido or new.id_cadete is distinct from old.id_cadete) then
    raise exception 'La asignación de pedidos la maneja el servidor. Actualizá la app.'
      using errcode = 'P0001', hint = 'Usar cadete_aceptar_pedido / cadete_rechazar_pedido / cancelar_pedido_cliente';
  end if;

  if new.estado_pedido in ('pendiente', 'libre', 'en_confirmacion')
     and old.estado_pedido is distinct from new.estado_pedido then
    raise exception 'Un pedido no puede volver a la búsqueda de cadete.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;
revoke all on function public.asignador_guardia() from public, anon, authenticated;

create trigger asignador_guardia
before update of estado_pedido, id_cadete on public."Pedidos"
for each row execute function public.asignador_guardia();

-- Alta de un pedido: primera oferta en el momento. Si algo falla, el latido lo retoma a los 3 s.
create function public.asignador_al_crear_pedido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform asignador.revisar(new.id_pedido);
  exception when others then
    raise warning 'asignador_al_crear_pedido: pedido #%: %', new.id_pedido, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.asignador_al_crear_pedido() from public, anon, authenticated;

create trigger asignador_al_crear_pedido
after insert on public."Pedidos"
for each row
when (new.estado_pedido = 'pendiente')
execute function public.asignador_al_crear_pedido();

-- -------------------------------------------------------------------------
-- FUNCIONES PARA LAS APPS (RPC)
-- -------------------------------------------------------------------------

-- App de cadetes, cada ~15 s mientras está en turno. p_gps_ms = hora (ms) del último fix GPS real;
-- null si todavía no hay GPS (la ubicación no se usa para medir distancias).
create function public.cadete_latido(
  p_id_cad bigint,
  p_lat double precision default null,
  p_lng double precision default null,
  p_gps_ms bigint default null
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.cadetes_senal (id_cad, ultima_senal, lat, lng, ubicacion_en)
  values (
    p_id_cad, now(),
    case when p_gps_ms is not null then p_lat end,
    case when p_gps_ms is not null then p_lng end,
    case when p_gps_ms is not null and p_lat is not null and p_lng is not null then to_timestamp(p_gps_ms / 1000.0) end
  )
  on conflict (id_cad) do update
  set ultima_senal = excluded.ultima_senal, lat = excluded.lat, lng = excluded.lng, ubicacion_en = excluded.ubicacion_en;
$$;

-- El cadete abrió la oferta en su pantalla. false = la oferta ya no es suya (cerrar el modal).
create function public.cadete_ver_oferta(p_id_pedido bigint, p_id_cad bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform asignador.entrar();
  update public."Pedidos"
  set estado_pedido = 'en_confirmacion'
  where id_pedido = p_id_pedido and id_cadete = p_id_cad and estado_pedido in ('libre', 'en_confirmacion');
  return found;
end;
$$;

-- El cadete acepta. Devuelve { ok: true, pedido } o { ok: false, motivo: 'no_vigente' | 'viaje_en_curso', id_pedido_en_curso }.
-- Nunca dos viajes a la vez: si ya tiene uno, la oferta se devuelve y pasa al siguiente cadete.
create function public.cadete_aceptar_pedido(p_id_pedido bigint, p_id_cad bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pedido public."Pedidos";
  v_viaje  bigint;
begin
  perform asignador.entrar();

  select id_pedido into v_viaje
  from public."Pedidos"
  where id_cadete = p_id_cad and estado_pedido in ('asignado', 'en_camino_entrega') and id_pedido <> p_id_pedido
  limit 1;

  if v_viaje is not null then
    update public."Pedidos"
    set id_cadete = null, estado_pedido = 'pendiente', oferta_vence_en = null
    where id_pedido = p_id_pedido and id_cadete = p_id_cad and estado_pedido in ('libre', 'en_confirmacion');
    if found then
      perform asignador.cerrar_oferta(p_id_pedido, 'rechazada');
      perform asignador.revisar(p_id_pedido);
    end if;
    return jsonb_build_object('ok', false, 'motivo', 'viaje_en_curso', 'id_pedido_en_curso', v_viaje);
  end if;

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

-- El cadete rechaza (botón o fin de su timer): el pedido pasa en el momento al siguiente cadete.
-- false = la oferta ya no era suya (no se toca nada).
create function public.cadete_rechazar_pedido(p_id_pedido bigint, p_id_cad bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform asignador.entrar();

  update public."Pedidos"
  set id_cadete = null, estado_pedido = 'pendiente', oferta_vence_en = null
  where id_pedido = p_id_pedido and id_cadete = p_id_cad and estado_pedido in ('libre', 'en_confirmacion');
  if not found then
    return false;
  end if;

  perform asignador.cerrar_oferta(p_id_pedido, 'rechazada');
  perform asignador.revisar(p_id_pedido);
  return true;
end;
$$;

-- El cliente cancela un pedido propio que sigue buscando cadete.
-- false = ya había salido de la búsqueda (ej: un cadete lo aceptó) o no es suyo.
create function public.cancelar_pedido_cliente(p_id_pedido bigint)
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
    and estado_pedido in ('pendiente', 'libre', 'en_confirmacion')
  for update;
  if not found then
    return false;
  end if;

  -- Se conserva id_cadete para que el cadete con la oferta abierta reciba la cancelación en su canal
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

revoke all on function public.cadete_latido(bigint, double precision, double precision, bigint) from public;
revoke all on function public.cadete_ver_oferta(bigint, bigint) from public;
revoke all on function public.cadete_aceptar_pedido(bigint, bigint) from public;
revoke all on function public.cadete_rechazar_pedido(bigint, bigint) from public;
revoke all on function public.cancelar_pedido_cliente(bigint) from public;
-- La app de cadetes no usa Supabase Auth (entra con la clave pública); la de clientes sí
grant execute on function public.cadete_latido(bigint, double precision, double precision, bigint) to anon, authenticated;
grant execute on function public.cadete_ver_oferta(bigint, bigint) to anon, authenticated;
grant execute on function public.cadete_aceptar_pedido(bigint, bigint) to anon, authenticated;
grant execute on function public.cadete_rechazar_pedido(bigint, bigint) to anon, authenticated;
grant execute on function public.cancelar_pedido_cliente(bigint) to authenticated;

-- -------------------------------------------------------------------------
-- LATIDO (pg_cron)
-- -------------------------------------------------------------------------
select cron.schedule('asignador-tick', '3 seconds', 'select asignador.tick()');
-- El latido deja una fila por corrida en el registro de pg_cron: se limpia cada hora
select cron.schedule('asignador-limpiar-registro', '17 * * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '6 hours'$$);

-- =========================================================================
-- VUELTA ATRÁS (volver al motor P2P): correr esto y publicar las apps del tag antes-asignador-servidor
-- =========================================================================
-- select cron.unschedule('asignador-tick');
-- select cron.unschedule('asignador-limpiar-registro');
-- drop trigger asignador_al_crear_pedido on public."Pedidos";
-- drop trigger asignador_guardia on public."Pedidos";
-- drop function public.asignador_al_crear_pedido();
-- drop function public.asignador_guardia();
-- drop function public.cadete_latido(bigint, double precision, double precision, bigint);
-- drop function public.cadete_ver_oferta(bigint, bigint);
-- drop function public.cadete_aceptar_pedido(bigint, bigint);
-- drop function public.cadete_rechazar_pedido(bigint, bigint);
-- drop function public.cancelar_pedido_cliente(bigint);
-- drop schema asignador cascade;
-- drop index public.pedidos_en_busqueda_idx;
-- alter table public."Pedidos" drop column creado_en, drop column motivo_cancelacion, drop column oferta_vence_en, drop column espera_desde;
-- drop table public.ofertas_pedido;
-- drop table public.cadetes_senal;
