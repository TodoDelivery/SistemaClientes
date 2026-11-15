create index if not exists pedidos_id_cadete_idx on public."Pedidos"(id_cadete);
create index if not exists pedidos_id_cliente_idx on public."Pedidos"(id_cliente);
create index if not exists rendiciones_id_cadete_idx on public."Rendiciones"(id_cadete);

drop trigger if exists "webhook-asignar-pedidos" on public."Pedidos";
