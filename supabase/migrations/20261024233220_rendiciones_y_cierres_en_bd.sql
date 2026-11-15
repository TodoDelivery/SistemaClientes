create table public."Rendiciones" (
  id_rendicion    bigint generated always as identity primary key,
  token           text not null unique,
  id_cadete       bigint not null references public."Cadetes"(id_cad),
  fecha           timestamptz not null default now(),
  cant_pedidos    integer not null,
  total_facturado double precision not null,
  monto_empresa   double precision not null,
  monto_cadete    double precision not null,
  metodo_pago     text not null default 'efectivo',
  notas           text,
  estado          text not null default 'confirmada' check (estado in ('confirmada', 'anulada')),
  fecha_anulacion timestamptz
);
comment on table public."Rendiciones" is 'Rendiciones de caja que hace la administradora desde Dashboard-Admin';

alter table public."Pedidos"
  add column id_rendicion bigint references public."Rendiciones"(id_rendicion);
create index pedidos_id_rendicion_idx on public."Pedidos"(id_rendicion);

create table public."Cierres_jornada" (
  id_cierre       bigint generated always as identity primary key,
  fecha           date not null,
  fecha_cierre    timestamptz not null default now(),
  desde           date,
  hasta           date,
  total_facturado double precision not null,
  total_empresa   double precision not null,
  total_cadetes   double precision not null,
  cant_cadetes    integer not null,
  cant_pedidos    integer not null,
  cadetes_al_dia  integer not null
);

alter table public."Datos_cotiz" add column whatsapp_central text;

create or replace function public.rendir_caja(
  p_id_cadete bigint,
  p_ids_pedidos bigint[],
  p_metodo_pago text default 'efectivo',
  p_notas text default null
) returns public."Rendiciones"
language plpgsql
set search_path = ''
as $$
declare
  v_pct_vigente double precision;
  v_cant integer;
  v_fact double precision;
  v_emp double precision;
  v_cad double precision;
  v_token text;
  v_rend public."Rendiciones";
begin
  select "Porc_Comision" into v_pct_vigente from public."Datos_cotiz" order by id limit 1;

  perform 1 from public."Pedidos" where id_pedido = any(p_ids_pedidos) for update;

  with p as (
    select coalesce(coste_pedido, 0) as monto,
           round((coalesce(coste_pedido, 0) * coalesce(porc_comision, v_pct_vigente, 0) / 100)::numeric) as emp
    from public."Pedidos"
    where id_pedido = any(p_ids_pedidos)
      and id_cadete = p_id_cadete
      and estado_pedido in ('entregado', 'delivered')
      and id_rendicion is null
  )
  select count(*), coalesce(sum(monto), 0), coalesce(sum(emp), 0), coalesce(sum(round((monto - emp)::numeric)), 0)
    into v_cant, v_fact, v_emp, v_cad
  from p;

  if v_cant = 0 or v_cant <> (select count(distinct x) from unnest(p_ids_pedidos) as x) then
    raise exception 'Los pedidos de este cadete cambiaron desde que se abrió la rendición. Recargá la caja.';
  end if;

  loop
    v_token := 'TD-' || p_id_cadete || '-'
      || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYYMMDD') || '-'
      || (1000 + floor(random() * 9000))::int;
    exit when not exists (select 1 from public."Rendiciones" where token = v_token);
  end loop;

  insert into public."Rendiciones" (token, id_cadete, cant_pedidos, total_facturado, monto_empresa, monto_cadete, metodo_pago, notas)
  values (v_token, p_id_cadete, v_cant, v_fact, v_emp, v_cad,
          coalesce(nullif(trim(p_metodo_pago), ''), 'efectivo'), nullif(trim(p_notas), ''))
  returning * into v_rend;

  update public."Pedidos"
  set estado_pedido = 'rendido', id_rendicion = v_rend.id_rendicion
  where id_pedido = any(p_ids_pedidos);

  return v_rend;
end;
$$;

create or replace function public.anular_rendicion(p_id_rendicion bigint)
returns public."Rendiciones"
language plpgsql
set search_path = ''
as $$
declare
  v_rend public."Rendiciones";
begin
  update public."Rendiciones"
  set estado = 'anulada', fecha_anulacion = now()
  where id_rendicion = p_id_rendicion and estado = 'confirmada'
  returning * into v_rend;

  if not found then
    raise exception 'La rendición no existe o ya estaba anulada.';
  end if;

  update public."Pedidos"
  set estado_pedido = 'entregado', id_rendicion = null
  where id_rendicion = p_id_rendicion and estado_pedido = 'rendido';

  return v_rend;
end;
$$;

with grupos as (
  select id_cadete,
         count(*) as n,
         sum(coalesce(coste_pedido, 0)) as fact,
         sum(round((coalesce(coste_pedido, 0) * coalesce(porc_comision, 60) / 100)::numeric)) as emp,
         max(fecha_pedido) as ult
  from public."Pedidos"
  where estado_pedido = 'rendido' and id_rendicion is null and id_cadete is not null
  group by id_cadete
), nuevas as (
  insert into public."Rendiciones" (token, id_cadete, fecha, cant_pedidos, total_facturado, monto_empresa, monto_cadete, notas)
  select 'TD-' || id_cadete || '-MIGRADA', id_cadete, ult, n, fact, emp, round((fact - emp)::numeric),
         'Rendida antes de guardar las rendiciones en la base'
  from grupos
  returning id_rendicion, id_cadete
)
update public."Pedidos" p
set id_rendicion = nuevas.id_rendicion
from nuevas
where p.id_cadete = nuevas.id_cadete and p.estado_pedido = 'rendido' and p.id_rendicion is null;
