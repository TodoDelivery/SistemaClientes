-- =========================================================================
-- El cliente puede cancelar también con el cadete ya asignado, hasta que retira
-- =========================================================================
-- Decisión del 16/11/2026: se puede cancelar mientras se busca cadete (como antes) y en 'asignado'
-- (el cadete va camino al local). En 'en_camino_entrega' ya no. Sin cargo por ahora.
--
-- Con 'asignado' -> 'cancelado' corre el trigger asignador_al_terminar_viaje: si el cadete tenía un
-- pedido en su cola, pasa a ser su viaje. La app de cadetes se entera por postgres_changes y además
-- por el aviso 'cambio_estado_pedido' en el canal del pedido.

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
    and estado_pedido in ('pendiente', 'libre', 'en_confirmacion', 'en_cola', 'asignado')
  for update;
  if not found then
    return false;
  end if;

  -- Se conserva id_cadete para que el cadete (oferta abierta, pedido en cola o viaje asignado) reciba la cancelación
  update public."Pedidos"
  set estado_pedido = 'cancelado', motivo_cancelacion = 'Cancelado por el cliente',
      oferta_vence_en = null, espera_desde = null
  where id_pedido = p_id_pedido;
  perform asignador.cerrar_oferta(p_id_pedido, 'retirada');

  if v_pedido.id_cadete is not null then
    if v_pedido.estado_pedido = 'asignado' then
      -- El cadete tiene la pantalla del viaje abierta: escucha el canal del pedido
      perform asignador.avisar('pedido-en-curso-' || p_id_pedido, 'cambio_estado_pedido',
        jsonb_build_object('id_pedido', p_id_pedido, 'estado_pedido', 'cancelado', 'id_cadete', v_pedido.id_cadete));
    else
      perform asignador.avisar('pedidos-cadete-' || v_pedido.id_cadete, 'pedido_retirado',
        jsonb_build_object('id_pedido', p_id_pedido, 'id_cadete', v_pedido.id_cadete));
    end if;
  end if;
  return true;
end;
$$;

-- =========================================================================
-- VUELTA ATRÁS: volver a aplicar cancelar_pedido_cliente de 20261116090000_cola_por_cadete.sql
-- =========================================================================
