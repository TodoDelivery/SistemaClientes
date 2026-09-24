// =========================================================================
// MOTOR DE ASIGNACIÓN SECUENCIAL DE CADETES (APP CLIENTES)
// =========================================================================
// El pedido se ofrece a un único cadete por vez. Estados durante la búsqueda:
//   'pendiente'       + id_cadete = null -> sin oferta vigente (recién creado o entre ofertas)
//   'libre'           + id_cadete = X    -> ofrecido a X, todavía no abrió la oferta
//   'en_confirmacion' + id_cadete = X    -> X tiene el modal abierto
// Fin de la búsqueda:
//   'asignado'        + id_cadete = X    -> X aceptó
//   'cancelado'                          -> sin cadetes, todos rechazaron o nadie se liberó a tiempo
//
// Ningún evento suelto decide: broadcasts, postgres_changes y un latido periódico solo piden
// una revisión, que relee el pedido en BD y actúa. Las escrituras son condicionales (bloqueo
// optimista) para no pisar a un cadete que acepta o rechaza en el mismo instante.
//
// A quién se ofrece: primero al cadete libre más cercano al punto de retiro (Haversine sobre la
// ubicación que cada cadete publica en Presence de 'cadetes-disponibles'). Si RECHAZOS_MAX_CERCANIA
// cadetes seguidos lo rechazan o no responden, se sigue sin tener en cuenta la distancia (por id_cad).
// La disponibilidad siempre sale de la BD (Cadetes.estado_cad); de Presence solo se toma la ubicación.
//
// Módulo aislado: no toca el DOM. La UI se entera de los cambios con suscribirMotorAsignacion().
// Está previsto moverlo a una Supabase Edge Function cuando se haga la UI de cadetes.
import { supabase } from './conexion_supabase.js';

export const CONFIG_ASIGNACION = {
  TIMEOUT_OFERTA_MS: 20000,        // el modal del cadete dura 15s; el resto es margen de red
  INTERVALO_REVISION_MS: 3000,     // latido de respaldo por si se pierde un evento realtime
  ESPERA_MAX_OCUPADOS_MS: 60000,   // cuánto esperar a que se libere un cadete ocupado antes de cancelar
  VENCIMIENTO_BUSQUEDA_MS: 30 * 60 * 1000, // un pedido que sigue sin cadete después de esto quedó abandonado
  RECHAZOS_MAX_CERCANIA: 3,        // ofertas por cercanía sin aceptar antes de pasar a asignar sin distancia
  ESPERA_UBICACIONES_MS: 5000      // cuánto esperar el primer estado de Presence antes de ofrecer sin ubicaciones
};

export const ESTADOS_BUSQUEDA = ['pendiente', 'libre', 'en_confirmacion'];
export const ESTADOS_OFERTA = ['libre', 'en_confirmacion'];
// Filtro PostgREST "sin oferta vigente": nadie asignado o pedido devuelto a 'pendiente'
const FILTRO_SIN_OFERTA = 'id_cadete.is.null,estado_pedido.eq.pendiente';
const MOTIVO_VENCIDA = 'La búsqueda de cadete venció';
// Canal de Presence donde cada cadete en turno publica su ubicación (lo mantiene la app de cadetes)
const CANAL_UBICACIONES_CADETES = 'cadetes-disponibles';

let busqueda = null;
const motivosCancelacion = new Map(); // id_pedido -> motivo mostrado en el panel
const suscriptores = new Set();

// -------------------------------------------------------------------------
// API PÚBLICA
// -------------------------------------------------------------------------

/**
 * Suscribe a los cambios del motor. Todos los eventos traen `idPedido`:
 *   { tipo: 'pedido', pedido }             fila (completa o parcial) leída o escrita en BD
 *   { tipo: 'busqueda', titulo, detalle }  texto para el panel mientras se busca cadete
 *   { tipo: 'finalizada', motivo }         la búsqueda terminó (asignado, cancelado, detenida...)
 * @returns {Function} desuscribir
 */
export function suscribirMotorAsignacion(listener) {
  suscriptores.add(listener);
  return () => suscriptores.delete(listener);
}

export function obtenerBusquedaActiva() {
  return busqueda && !busqueda.finalizada ? busqueda : null;
}

/** Texto { titulo, detalle } de la búsqueda en curso de ese pedido, o null */
export function obtenerEstadoBusqueda(idPedido) {
  const b = obtenerBusquedaActiva();
  return b && b.idPedido === Number(idPedido) ? b.ui : null;
}

export function obtenerMotivoCancelacion(idPedido) {
  return motivosCancelacion.get(Number(idPedido)) || null;
}

/** true si el pedido sigue sin cadete pero se creó hace más de VENCIMIENTO_BUSQUEDA_MS */
export function esBusquedaVencida(pedido) {
  if (!pedido || !ESTADOS_BUSQUEDA.includes(pedido.estado_pedido)) return false;
  const creado = new Date(pedido.fecha_pedido).getTime();
  return Number.isFinite(creado) && Date.now() - creado > CONFIG_ASIGNACION.VENCIMIENTO_BUSQUEDA_MS;
}

/**
 * Cancela los pedidos del cliente que quedaron buscando cadete sin motor que los atienda (ej: se cerró
 * la app a mitad de la asignación). Sin esto quedan 'pendiente' para siempre y se volverían a ofrecer.
 * @returns {Promise<number[]>} ids cancelados
 */
export async function vencerBusquedasAbandonadas(idCliente) {
  const limite = new Date(Date.now() - CONFIG_ASIGNACION.VENCIMIENTO_BUSQUEDA_MS).toISOString();

  // Se conserva id_cadete, igual que en cancelarBusquedaPorCliente, para que el cadete se entere
  const { data, error } = await supabase
    .from('Pedidos')
    .update({ estado_pedido: 'cancelado' })
    .eq('id_cliente', idCliente)
    .in('estado_pedido', ESTADOS_BUSQUEDA)
    .lt('fecha_pedido', limite)
    .select('id_pedido, id_cadete');

  if (error) throw error;

  const cancelados = data || [];
  for (const p of cancelados) registrarVencimiento(p);
  return cancelados.map(p => Number(p.id_pedido));
}

/**
 * Arranca (o reanuda) la búsqueda de cadete de un pedido. Solo hay una búsqueda activa a la vez.
 * @returns {Object} estado de la búsqueda; `terminada` es una promesa que se resuelve al finalizar
 */
export function iniciarBusquedaCadete(idPedido) {
  if (busqueda) detenerBusqueda(busqueda, 'reemplazada por otra búsqueda');

  const b = {
    idPedido: Number(idPedido),
    intentados: new Set(),        // cadetes que rechazaron o no respondieron: no se les vuelve a ofrecer
    rechazosRecibidos: new Set(), // rechazos avisados por broadcast (por si la BD todavía no los refleja)
    idCadeteOfertado: null,
    nombreCadeteOfertado: '',
    distanciaOfertaKm: null,      // del cadete ofertado al punto de retiro, si se conocía su ubicación
    ofertaExpiraEn: 0,
    esperandoDesde: null,
    modo: 'cercania',             // 'cercania': al más cercano | 'sin_distancia': por id_cad
    rechazosCercania: 0,          // ofertas por cercanía que terminaron sin aceptar (rechazo o sin respuesta)
    canalUbicaciones: null,       // Presence 'cadetes-disponibles' (solo se escucha, no se hace track)
    ubicacionesListas: false,     // llegó el primer estado de Presence (o el canal falló)
    iniciadaEn: Date.now(),
    ui: null,
    latido: null,
    ejecutando: false,
    repetir: false,
    finalizada: false
  };
  b.terminada = new Promise((resolve) => { b.resolverTerminada = resolve; });

  busqueda = b;
  console.log(`[Asignación] Pedido #${b.idPedido}: iniciando búsqueda de cadete.`);
  conectarUbicacionesCadetes(b);
  b.latido = setInterval(() => solicitarRevisionAsignacion(b), CONFIG_ASIGNACION.INTERVALO_REVISION_MS);
  solicitarRevisionAsignacion(b);
  return b;
}

export function detenerBusqueda(b, motivo) {
  if (!b || b.finalizada) return;
  b.finalizada = true;
  clearInterval(b.latido);
  desconectarUbicacionesCadetes(b);
  console.log(`[Asignación] Pedido #${b.idPedido}: búsqueda finalizada (${motivo}).`);
  b.resolverTerminada();
  emitir('finalizada', b.idPedido, { motivo });
}

/** Pide una revisión si ese pedido tiene la búsqueda activa (postgres_changes, cambio_estado_pedido) */
export function solicitarRevisionDePedido(idPedido) {
  const b = obtenerBusquedaActiva();
  if (b && b.idPedido === Number(idPedido)) {
    solicitarRevisionAsignacion(b);
  }
}

/** Rechazo avisado por broadcast 'pedido_rechazado': se anota y se revisa con datos frescos de BD */
export function registrarRechazoCadete(idPedido, idCadete) {
  const b = obtenerBusquedaActiva();
  if (!b || b.idPedido !== Number(idPedido) || idCadete == null) return;
  b.rechazosRecibidos.add(Number(idCadete));
  solicitarRevisionAsignacion(b);
}

/**
 * Cancela un pedido que sigue en búsqueda (ej: el cliente lo reemplaza por uno nuevo).
 * Funciona aunque la búsqueda no corra en esta página: la decisión la toma la BD.
 * @returns {Promise<boolean>} false si el pedido ya había salido de la búsqueda (ej: un cadete lo aceptó)
 * @throws si falla la escritura, para que quien llama no siga como si se hubiera cancelado
 */
export async function cancelarBusquedaPorCliente(idPedido) {
  const id = Number(idPedido);
  const b = obtenerBusquedaActiva();
  if (b && b.idPedido === id) detenerBusqueda(b, 'cancelado por el cliente');

  // Se conserva id_cadete para que el cadete con la oferta abierta reciba la cancelación en su canal
  const { data: cancelado, error } = await supabase
    .from('Pedidos')
    .update({ estado_pedido: 'cancelado' })
    .eq('id_pedido', id)
    .in('estado_pedido', ESTADOS_BUSQUEDA)
    .select('id_pedido, id_cadete')
    .maybeSingle();

  if (error) throw error;
  if (!cancelado) return false;

  motivosCancelacion.set(id, 'Cancelado por el cliente');
  emitir('pedido', id, { pedido: { id_pedido: id, id_cadete: cancelado.id_cadete, estado_pedido: 'cancelado' } });

  if (cancelado.id_cadete != null) {
    // Se espera el envío: en la app multipágina quien llama suele navegar justo después
    await enviarBroadcastEfimero(`pedidos-cadete-${cancelado.id_cadete}`, 'pedido_retirado', {
      id_pedido: id,
      id_cadete: Number(cancelado.id_cadete)
    });
  }
  return true;
}

// Broadcast puntual a un canal que este cliente no escucha (ej: el canal privado de un cadete)
export async function enviarBroadcastEfimero(topic, event, payload) {
  try {
    // supabase.channel() devuelve el canal existente si ya hay uno con ese topic, y un canal ya
    // suscrito no vuelve a notificar 'SUBSCRIBED': se elimina el anterior antes de crear uno nuevo
    const previos = typeof supabase.getChannels === 'function'
      ? supabase.getChannels().filter(c => c.topic === `realtime:${topic}`)
      : [];
    for (const ch of previos) await supabase.removeChannel(ch);

    const chan = supabase.channel(topic, { config: { broadcast: { ack: true } } });
    const resultado = await new Promise((resolve) => {
      const limite = setTimeout(() => resolve('timed out'), 8000);
      chan.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(limite);
          try {
            resolve(await chan.send({ type: 'broadcast', event, payload }));
          } catch (errSend) {
            resolve('error');
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(limite);
          resolve(status);
        }
      });
    });

    if (resultado !== 'ok') console.warn(`[Broadcast] '${event}' a ${topic}: ${resultado}`);
    setTimeout(() => supabase.removeChannel(chan), 1000);
    return resultado;
  } catch (err) {
    console.warn(`[Broadcast] Error enviando '${event}' a ${topic}:`, err);
    return 'error';
  }
}

// -------------------------------------------------------------------------
// INTERNOS
// -------------------------------------------------------------------------

function emitir(tipo, idPedido, datos = {}) {
  const evento = { tipo, idPedido: Number(idPedido), ...datos };
  for (const listener of suscriptores) {
    try {
      listener(evento);
    } catch (err) {
      console.error('[Asignación] Error en un suscriptor del motor:', err);
    }
  }
}

// Serializa las revisiones: si llega un evento mientras otra corre, se repite al terminar
async function solicitarRevisionAsignacion(b) {
  if (!b || b.finalizada) return;
  if (b.ejecutando) {
    b.repetir = true;
    return;
  }

  b.ejecutando = true;
  try {
    let vueltas = 0;
    do {
      b.repetir = false;
      await revisarAsignacion(b);
    } while (b.repetir && !b.finalizada && ++vueltas < 5);
  } catch (err) {
    console.error(`[Asignación] Pedido #${b.idPedido}: error en la revisión, se reintenta en el próximo latido.`, err);
  } finally {
    b.ejecutando = false;
  }
}

async function revisarAsignacion(b) {
  const { data: pedido, error } = await supabase
    .from('Pedidos')
    .select('*')
    .eq('id_pedido', b.idPedido)
    .maybeSingle();

  if (error) throw error;
  if (b.finalizada) return;

  if (!pedido) {
    detenerBusqueda(b, 'el pedido ya no existe');
    return;
  }

  // 1. Fuera de la fase de búsqueda (aceptado, cancelado, etc.): terminar
  if (!ESTADOS_BUSQUEDA.includes(pedido.estado_pedido)) {
    detenerBusqueda(b, `estado '${pedido.estado_pedido}'`);
    emitir('pedido', b.idPedido, { pedido });
    return;
  }

  // 1b. Búsqueda abandonada hace rato (ej: se reabrió días después): cancelar en vez de ofrecerla
  if (esBusquedaVencida(pedido)) {
    const { data: vencido, error: errVencido } = await supabase
      .from('Pedidos')
      .update({ estado_pedido: 'cancelado' })
      .eq('id_pedido', b.idPedido)
      .in('estado_pedido', ESTADOS_BUSQUEDA)
      .select('id_pedido, id_cadete')
      .maybeSingle();

    if (errVencido) throw errVencido;
    if (b.finalizada) return;
    if (!vencido) {
      b.repetir = true;
      return;
    }
    registrarVencimiento(vencido);
    return;
  }

  emitir('pedido', b.idPedido, { pedido });

  const idCadeteEnBD = pedido.id_cadete != null ? Number(pedido.id_cadete) : null;
  const hayOfertaEnBD = idCadeteEnBD !== null && ESTADOS_OFERTA.includes(pedido.estado_pedido);

  if (hayOfertaEnBD) {
    // 2. Hay una oferta vigente
    if (idCadeteEnBD !== b.idCadeteOfertado) {
      // Oferta que este motor no registró (ej: se reanudó el seguimiento tras recargar): adoptarla
      if (b.idCadeteOfertado !== null) b.intentados.add(b.idCadeteOfertado);
      b.idCadeteOfertado = idCadeteEnBD;
      b.nombreCadeteOfertado = '';
      b.distanciaOfertaKm = null;
      b.ofertaExpiraEn = Date.now() + CONFIG_ASIGNACION.TIMEOUT_OFERTA_MS;
    }

    const rechazoAvisado = b.rechazosRecibidos.has(idCadeteEnBD);
    const restanteMs = b.ofertaExpiraEn - Date.now();

    if (!rechazoAvisado && restanteMs > 0) {
      const accion = pedido.estado_pedido === 'en_confirmacion' ? 'Viendo la oferta' : 'Enviando oferta';
      renderEstadoBusqueda(
        b,
        `Ofreciendo a ${b.nombreCadeteOfertado || `Cadete #${idCadeteEnBD}`}`,
        `${accion}${textoDistancia(b)} • Intento ${b.intentados.size + 1} • ${Math.ceil(restanteMs / 1000)}s`
      );
      return; // seguir esperando la respuesta de este cadete
    }

    // Rechazó (aviso por broadcast) o no respondió a tiempo: retirar la oferta solo si sigue siendo suya
    const { data: retirado, error: errRetiro } = await supabase
      .from('Pedidos')
      .update({ id_cadete: null, estado_pedido: 'pendiente' })
      .eq('id_pedido', b.idPedido)
      .eq('id_cadete', idCadeteEnBD)
      .in('estado_pedido', ESTADOS_OFERTA)
      .select('id_pedido')
      .maybeSingle();

    if (errRetiro) throw errRetiro;
    if (b.finalizada) return;
    if (!retirado) {
      b.repetir = true; // el cadete respondió en este mismo instante: re-evaluar
      return;
    }

    console.log(`[Asignación] Pedido #${b.idPedido}: cadete #${idCadeteEnBD} ${rechazoAvisado ? 'rechazó' : 'no respondió a tiempo'}.`);
    if (!rechazoAvisado) {
      // Cerrarle el modal si todavía lo tiene abierto
      enviarBroadcastEfimero(`pedidos-cadete-${idCadeteEnBD}`, 'pedido_retirado', { id_pedido: b.idPedido, id_cadete: idCadeteEnBD });
    }
    registrarOfertaTerminada(b, idCadeteEnBD);
    emitir('pedido', b.idPedido, { pedido: { id_pedido: b.idPedido, id_cadete: null, estado_pedido: 'pendiente' } });
  } else if (b.idCadeteOfertado !== null) {
    // 3. Había una oferta y el cadete la devolvió (botón rechazar o fin de su timer)
    console.log(`[Asignación] Pedido #${b.idPedido}: cadete #${b.idCadeteOfertado} rechazó.`);
    registrarOfertaTerminada(b, b.idCadeteOfertado);
  }

  // 4. Sin oferta vigente: pasar al siguiente cadete
  await ofrecerAlSiguienteCadete(b, pedido);
}

// El cadete no tomó la oferta (rechazo o sin respuesta): no se le vuelve a ofrecer y, si se estaba
// buscando por cercanía, cuenta para pasar a asignar sin tener en cuenta la distancia
function registrarOfertaTerminada(b, idCadete) {
  b.intentados.add(idCadete);
  b.idCadeteOfertado = null;
  b.distanciaOfertaKm = null;
  if (b.modo !== 'cercania') return;

  b.rechazosCercania++;
  if (b.rechazosCercania >= CONFIG_ASIGNACION.RECHAZOS_MAX_CERCANIA) {
    b.modo = 'sin_distancia';
    desconectarUbicacionesCadetes(b); // ya no se usan
    console.log(`[Asignación] Pedido #${b.idPedido}: ${b.rechazosCercania} cadetes cercanos no lo tomaron, se asigna sin tener en cuenta la distancia.`);
  }
}

async function ofrecerAlSiguienteCadete(b, pedido) {
  const { data: cadetes, error } = await supabase
    .from('Cadetes')
    .select('id_cad, nombre_cad, alias_cad, estado_cad')
    .in('estado_cad', ['disponible', 'en_confirmacion', 'ocupado'])
    .order('id_cad', { ascending: true });

  if (error) throw error;
  if (b.finalizada) return;

  const sinIntentar = (cadetes || []).filter(c => !b.intentados.has(Number(c.id_cad)));
  const libres = sinIntentar.filter(c => c.estado_cad === 'disponible');
  const ocupados = sinIntentar.filter(c => c.estado_cad !== 'disponible');

  // A) Hay cadetes libres que todavía no vieron el pedido: ofrecérselo a uno solo
  if (libres.length > 0) {
    // Sin el primer estado de Presence todos parecerían estar sin ubicación y se ofrecería por id
    const esperaRestanteMs = CONFIG_ASIGNACION.ESPERA_UBICACIONES_MS - (Date.now() - b.iniciadaEn);
    if (b.modo === 'cercania' && !b.ubicacionesListas && esperaRestanteMs > 0) {
      renderEstadoBusqueda(b, 'Buscando el cadete más cercano', 'Ubicando a los cadetes en turno');
      return; // el primer sync de Presence (o el latido) vuelve a revisar
    }

    const { cadete, distanciaKm } = elegirCadete(b, libres, pedido);
    const idCadete = Number(cadete.id_cad);

    const { data: pedidoOfertado, error: errOferta } = await supabase
      .from('Pedidos')
      .update({ id_cadete: idCadete, estado_pedido: 'libre' })
      .eq('id_pedido', b.idPedido)
      .in('estado_pedido', ESTADOS_BUSQUEDA)
      .or(FILTRO_SIN_OFERTA)
      .select()
      .maybeSingle();

    if (errOferta) throw errOferta;
    if (b.finalizada) return;
    if (!pedidoOfertado) {
      b.repetir = true; // el pedido cambió mientras tanto: re-evaluar
      return;
    }

    b.idCadeteOfertado = idCadete;
    b.nombreCadeteOfertado = cadete.nombre_cad || cadete.alias_cad || `Cadete #${idCadete}`;
    b.distanciaOfertaKm = distanciaKm;
    b.ofertaExpiraEn = Date.now() + CONFIG_ASIGNACION.TIMEOUT_OFERTA_MS;
    b.esperandoDesde = null;
    emitir('pedido', b.idPedido, { pedido: pedidoOfertado });

    const intento = b.intentados.size + 1;
    const criterio = b.modo !== 'cercania'
      ? 'sin tener en cuenta la distancia'
      : distanciaKm !== null ? `a ${distanciaKm.toFixed(2)} km del retiro` : 'sin ubicación conocida';
    console.log(`[Asignación] Pedido #${b.idPedido}: ofreciendo a cadete #${idCadete} (intento ${intento}, ${criterio}).`);
    renderEstadoBusqueda(b, `Ofreciendo a ${b.nombreCadeteOfertado}`, `Enviando oferta${textoDistancia(b)} • Intento ${intento}`);
    enviarBroadcastEfimero(`pedidos-cadete-${idCadete}`, 'nuevo_pedido', pedidoOfertado);
    return;
  }

  // B) Nadie libre, pero hay cadetes ocupados que aún no lo vieron: esperar a que se libere alguno
  if (ocupados.length > 0) {
    if (!b.esperandoDesde) b.esperandoDesde = Date.now();
    const restanteMs = CONFIG_ASIGNACION.ESPERA_MAX_OCUPADOS_MS - (Date.now() - b.esperandoDesde);
    if (restanteMs > 0) {
      renderEstadoBusqueda(b, 'Todos los cadetes están ocupados', `Esperando que se libere uno • ${Math.ceil(restanteMs / 1000)}s`);
      return; // el latido vuelve a revisar
    }
  }

  // C) No queda nadie a quien ofrecerle el pedido: cancelarlo
  let motivo = 'No hay cadetes conectados';
  if (ocupados.length > 0) motivo = 'Ningún cadete se liberó a tiempo';
  else if (b.intentados.size > 0) motivo = 'Todos los cadetes rechazaron el pedido';

  const { data: cancelado, error: errCancel } = await supabase
    .from('Pedidos')
    .update({ id_cadete: null, estado_pedido: 'cancelado' })
    .eq('id_pedido', b.idPedido)
    .in('estado_pedido', ESTADOS_BUSQUEDA)
    .or(FILTRO_SIN_OFERTA)
    .select('id_pedido')
    .maybeSingle();

  if (errCancel) throw errCancel;
  if (b.finalizada) return;
  if (!cancelado) {
    b.repetir = true;
    return;
  }

  motivosCancelacion.set(b.idPedido, motivo);
  detenerBusqueda(b, motivo);
  emitir('pedido', b.idPedido, { pedido: { id_pedido: b.idPedido, id_cadete: null, estado_pedido: 'cancelado' } });
}

// Motivo, fin de la búsqueda si corría y aviso al cadete si tenía la oferta abierta
function registrarVencimiento({ id_pedido, id_cadete }) {
  const id = Number(id_pedido);
  motivosCancelacion.set(id, MOTIVO_VENCIDA);
  if (busqueda && busqueda.idPedido === id) detenerBusqueda(busqueda, MOTIVO_VENCIDA);
  emitir('pedido', id, { pedido: { id_pedido: id, id_cadete, estado_pedido: 'cancelado' } });

  if (id_cadete != null) {
    enviarBroadcastEfimero(`pedidos-cadete-${id_cadete}`, 'pedido_retirado', { id_pedido: id, id_cadete: Number(id_cadete) });
  }
}

function renderEstadoBusqueda(b, titulo, detalle) {
  b.ui = { titulo, detalle };
  emitir('busqueda', b.idPedido, { titulo, detalle });
}

function textoDistancia(b) {
  const km = b.distanciaOfertaKm;
  if (km === null) return '';
  return km < 1
    ? ` • a ${Math.round(km * 1000)} m del retiro`
    : ` • a ${km.toLocaleString('es-AR', { maximumFractionDigits: 1 })} km del retiro`;
}

// -------------------------------------------------------------------------
// ASIGNACIÓN POR CERCANÍA (UBICACIONES POR REALTIME PRESENCE)
// -------------------------------------------------------------------------
// La app de cadetes publica en Presence de 'cadetes-disponibles' { id_cad, coords: { lat, lng }, coords_ts, ... }
// y lo actualiza con cada lectura del GPS. coords_ts es la hora del último fix: vale null mientras el
// cadete todavía transmite la ubicación por defecto, y esas coords no sirven para medir distancias.

/**
 * Por cercanía: el cadete libre más cerca del punto de retiro. Los que no tienen ubicación solo se
 * eligen si ninguno la tiene, y entonces (igual que sin distancia) va el primero por id_cad.
 * @returns {{ cadete: Object, distanciaKm: number|null }}
 */
function elegirCadete(b, libres, pedido) {
  const latRetiro = pedido.latitud_org == null ? NaN : Number(pedido.latitud_org);
  const lngRetiro = pedido.longitud_org == null ? NaN : Number(pedido.longitud_org);
  let elegido = { cadete: libres[0], distanciaKm: null };
  if (b.modo !== 'cercania' || !Number.isFinite(latRetiro) || !Number.isFinite(lngRetiro)) return elegido;

  const ubicaciones = leerUbicacionesCadetes(b);
  for (const cadete of libres) {
    const ubicacion = ubicaciones.get(Number(cadete.id_cad));
    if (!ubicacion) continue;
    const distanciaKm = distanciaHaversineKm(ubicacion.lat, ubicacion.lng, latRetiro, lngRetiro);
    // Con '<' estricto, a igual distancia gana el de menor id_cad (libres viene ordenado por id)
    if (elegido.distanciaKm === null || distanciaKm < elegido.distanciaKm) {
      elegido = { cadete, distanciaKm };
    }
  }
  return elegido;
}

/** id_cad -> { lat, lng, ts } de los cadetes en Presence con GPS real (si tiene varias pestañas, el fix más nuevo) */
function leerUbicacionesCadetes(b) {
  const ubicaciones = new Map();
  if (!b.canalUbicaciones) return ubicaciones;

  for (const presencias of Object.values(b.canalUbicaciones.presenceState())) {
    for (const p of presencias) {
      const id = Number(p.id_cad);
      const ts = Number(p.coords_ts);
      const lat = Number(p.coords?.lat);
      const lng = Number(p.coords?.lng);
      if (!id || !ts || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const previa = ubicaciones.get(id);
      if (!previa || ts > previa.ts) ubicaciones.set(id, { lat, lng, ts });
    }
  }
  return ubicaciones;
}

// Solo escucha: sin track(), así el cliente no aparece como un cadete más en el canal
async function conectarUbicacionesCadetes(b) {
  const marcarListas = () => {
    if (b.ubicacionesListas) return;
    b.ubicacionesListas = true;
    solicitarRevisionAsignacion(b);
  };

  try {
    // supabase.channel() devolvería el canal de una búsqueda anterior que todavía se está cerrando
    const previos = typeof supabase.getChannels === 'function'
      ? supabase.getChannels().filter(c => c.topic === `realtime:${CANAL_UBICACIONES_CADETES}`)
      : [];
    for (const ch of previos) await supabase.removeChannel(ch);
    if (b.finalizada || b.modo !== 'cercania') return;

    const canal = supabase.channel(CANAL_UBICACIONES_CADETES);
    b.canalUbicaciones = canal;
    canal
      // Solo importa el primero: después cada movimiento del GPS de un cadete dispara otro sync,
      // y las ubicaciones se leen recién al elegir a quién ofrecer
      .on('presence', { event: 'sync' }, marcarListas)
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`[Asignación] Pedido #${b.idPedido}: Presence '${CANAL_UBICACIONES_CADETES}' en ${status}, se ofrece sin ubicaciones.`, err);
          marcarListas();
        }
      });
  } catch (err) {
    console.warn(`[Asignación] Pedido #${b.idPedido}: no se pudo escuchar la ubicación de los cadetes, se ofrece sin ubicaciones.`, err);
    marcarListas();
  }
}

function desconectarUbicacionesCadetes(b) {
  const canal = b.canalUbicaciones;
  if (!canal) return;
  b.canalUbicaciones = null;
  supabase.removeChannel(canal).catch(err => console.warn('[Asignación] Error cerrando el canal de ubicaciones:', err));
}

/** Distancia en línea recta (km) entre dos puntos, fórmula de Haversine */
function distanciaHaversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // radio medio de la Tierra en km
  const rad = (grados) => grados * Math.PI / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
