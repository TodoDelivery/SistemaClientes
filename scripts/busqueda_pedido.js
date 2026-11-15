// =========================================================================
// BÚSQUEDA DE CADETE (APP CLIENTES): SOLO LECTURA
// =========================================================================
// La asignación la hace el servidor (funciones de Postgres + pg_cron, ver
// supabase/migrations/20261115100000_asignador_en_servidor.sql): el pedido se ofrece a un cadete por vez,
// primero al libre más cercano al retiro. Esta app ya no decide nada: crea el pedido, mira cómo avanza
// en la BD y, si el cliente quiere, lo cancela con cancelar_pedido_cliente().
//
// Estados durante la búsqueda:
//   'pendiente'       + id_cadete = null -> sin oferta vigente (recién creado, entre ofertas o esperando
//                                           que se libere un cadete: espera_desde tiene la hora)
//   'libre'           + id_cadete = X    -> ofrecido a X, todavía no abrió la oferta (vence en oferta_vence_en)
//   'en_confirmacion' + id_cadete = X    -> X tiene el modal abierto
// Fin de la búsqueda:
//   'asignado'        + id_cadete = X    -> X aceptó
//   'cancelado'                          -> motivo_cancelacion dice por qué
import { supabase } from './conexion_supabase.js';

export const ESTADOS_BUSQUEDA = ['pendiente', 'libre', 'en_confirmacion'];
export const ESTADOS_OFERTA = ['libre', 'en_confirmacion'];

// Los mismos plazos que usa el asignador del servidor (acá solo para mostrar las cuentas regresivas)
const TIMEOUT_OFERTA_S = 20;
const ESPERA_MAX_OCUPADOS_S = 60;
const VENCIMIENTO_BUSQUEDA_MS = 30 * 60 * 1000;

/**
 * true si el pedido sigue sin cadete pero se creó hace más de 30 minutos. El servidor lo cancela solo;
 * esto cubre el instante previo (o un servidor demorado) para no mostrarlo como "buscando".
 */
export function esBusquedaVencida(pedido) {
  if (!pedido || !ESTADOS_BUSQUEDA.includes(pedido.estado_pedido)) return false;
  const creado = new Date(pedido.fecha_pedido).getTime();
  return Number.isFinite(creado) && Date.now() - creado > VENCIMIENTO_BUSQUEDA_MS;
}

/**
 * Cancela un pedido propio que sigue buscando cadete. La decisión la toma el servidor.
 * @returns {Promise<boolean>} false si el pedido ya había salido de la búsqueda (ej: un cadete lo aceptó)
 * @throws si falla la llamada, para que quien llama no siga como si se hubiera cancelado
 */
export async function cancelarBusquedaPorCliente(idPedido) {
  const { data, error } = await supabase.rpc('cancelar_pedido_cliente', { p_id_pedido: Number(idPedido) });
  if (error) throw error;
  return Boolean(data);
}

/**
 * Texto del panel mientras se busca cadete, a partir de la fila del pedido.
 * @param {Object} pedido fila de Pedidos
 * @param {string} [nombreCadete] nombre del cadete al que se le está ofreciendo, si ya se conoce
 * @returns {{ titulo: string, detalle: string }}
 */
export function textoBusqueda(pedido, nombreCadete = '') {
  if (ESTADOS_OFERTA.includes(pedido?.estado_pedido) && pedido.id_cadete != null) {
    const accion = pedido.estado_pedido === 'en_confirmacion' ? 'Viendo la oferta' : 'Enviando oferta';
    const restante = segundosHasta(pedido.oferta_vence_en, TIMEOUT_OFERTA_S);
    return {
      titulo: `Ofreciendo a ${nombreCadete || 'un cadete'}`,
      detalle: restante > 0 ? `${accion} • ${restante}s` : accion
    };
  }

  if (pedido?.espera_desde) {
    const desde = new Date(pedido.espera_desde).getTime();
    const hasta = Number.isFinite(desde) ? new Date(desde + ESPERA_MAX_OCUPADOS_S * 1000).toISOString() : null;
    const restante = segundosHasta(hasta, ESPERA_MAX_OCUPADOS_S);
    return {
      titulo: 'Todos los cadetes están ocupados',
      detalle: restante > 0 ? `Esperando que se libere uno • ${restante}s` : 'Esperando que se libere uno'
    };
  }

  return { titulo: 'Buscando cadete', detalle: 'Estamos ofreciendo tu pedido a los cadetes disponibles' };
}

// Segundos que faltan para una hora del servidor, acotados al plazo (el reloj del celular puede estar corrido)
function segundosHasta(fechaIso, maximo) {
  const hasta = fechaIso ? new Date(fechaIso).getTime() : NaN;
  if (!Number.isFinite(hasta)) return 0;
  return Math.max(0, Math.min(maximo, Math.ceil((hasta - Date.now()) / 1000)));
}
