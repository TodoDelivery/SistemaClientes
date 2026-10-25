// =========================================================================
// ENVIAR-PUSH: arma y manda las notificaciones push de un pedido
// =========================================================================
// La llama el disparador push_pedidos (tabla Pedidos) con la fila de antes y la de después, cada vez
// que cambia el estado, el cadete o el chat. Decide qué aviso corresponde, busca los celulares del
// destinatario en Push_suscripciones y les manda el aviso. Si un celular ya no existe (404/410), lo borra.
//
// Seguridad: solo acepta llamadas con el header x-push-secreto (lo manda el disparador). Las claves VAPID
// y el secreto están en Vault y se leen con push_config(), que solo puede ejecutar la service_role.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const URL_CADETES = '/Templates/';
const URL_CLIENTES = '/templates/';
const SEGUNDOS_OFERTA = 20;            // lo que dura una oferta antes de que el motor la retire
const UNA_HORA = 3600;
const ESTADOS_BUSQUEDA = ['pendiente', 'libre', 'en_confirmacion'];
const ESTADOS_CHAT = ['asignado', 'en_camino_entrega'];

type Fila = Record<string, any>;
type Aviso = {
  destino: { id_cad?: number; id_cliente?: string };
  titulo: string;
  texto: string;
  url: string;   // relativa a la raíz del sitio de esa app
  tag: string;   // un aviso con la misma etiqueta reemplaza al anterior
  ttl: number;   // segundos: si no llega antes, Google lo descarta
  // Con la app visible el celular no muestra el aviso si esa pantalla ya está abierta; con true, ninguna
  // pantalla de la app abierta lo muestra (ej: la cancelación que hizo el propio cliente desde otra pantalla)
  ocultarSiAbierta?: boolean;
};

let config: Record<string, string> | null = null;

async function leerConfig() {
  if (config) return config;
  const { data, error } = await supabase.rpc('push_config');
  if (error || !data) throw new Error(`No se pudo leer push_config: ${error?.message}`);
  config = data as Record<string, string>;
  webpush.setVapidDetails(Deno.env.get('SUPABASE_URL')!, config.push_vapid_publica, config.push_vapid_privada);
  return config;
}

function pesos(n: number) {
  return '$' + Math.round(n).toLocaleString('es-AR');
}

function kmDelViaje(p: Fila) {
  const { latitud_org: la1, longitud_org: lo1, latitud_dest: la2, longitud_dest: lo2 } = p;
  if ([la1, lo1, la2, lo2].some(v => typeof v !== 'number')) return null;
  const rad = (g: number) => g * Math.PI / 180;
  const a = Math.sin(rad(la2 - la1) / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2;
  return Math.max(0.6, Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10);
}

function leerChat(valor: unknown): Fila[] {
  try {
    const lista = typeof valor === 'string' ? JSON.parse(valor) : valor;
    return Array.isArray(lista) ? lista.filter(m => m && typeof m === 'object' && m.texto) : [];
  } catch {
    return [];
  }
}

function recortar(texto: string, largo = 120) {
  const limpio = String(texto).trim();
  return limpio.length > largo ? `${limpio.slice(0, largo)}…` : limpio;
}

async function nombreCadete(idCadete: number | null) {
  if (!idCadete) return 'Tu cadete';
  const { data } = await supabase.from('Cadetes').select('nombre_cad, alias_cad').eq('id_cad', idCadete).maybeSingle();
  return data?.nombre_cad || data?.alias_cad || 'Tu cadete';
}

async function gananciaCadete(p: Fila) {
  let porcentaje = Number(p.porc_comision);
  if (!Number.isFinite(porcentaje)) {
    const { data } = await supabase.from('Datos_cotiz').select('Porc_Comision').limit(1).maybeSingle();
    porcentaje = Number(data?.Porc_Comision);
  }
  if (!Number.isFinite(porcentaje)) porcentaje = 40;
  return Number(p.coste_pedido || 0) * (1 - porcentaje / 100);
}

/** Qué avisos corresponden a este cambio del pedido */
async function avisosDelCambio(viejo: Fila, nuevo: Fila): Promise<Aviso[]> {
  const avisos: Aviso[] = [];
  const id = nuevo.id_pedido;
  const cambioEstado = viejo.estado_pedido !== nuevo.estado_pedido;
  const idCadete = nuevo.id_cadete ? Number(nuevo.id_cadete) : null;
  const pantallaCadete = (pagina: string) => `${URL_CADETES}${pagina}?id_cad=${idCadete}`;
  const pantallaCliente = (extra = '') => `${URL_CLIENTES}pedido_activo.html?id_pedido=${id}${extra}`;

  // ---- Cadete: le ofrecen el pedido ----
  if (nuevo.estado_pedido === 'libre' && idCadete && (cambioEstado || viejo.id_cadete !== nuevo.id_cadete)) {
    const km = kmDelViaje(nuevo);
    const detalle = [nuevo.tipo_paquete, km ? `${String(km).replace('.', ',')} km de viaje` : null].filter(Boolean).join(' · ');
    avisos.push({
      destino: { id_cad: idCadete },
      titulo: `Nuevo pedido · Ganás ${pesos(await gananciaCadete(nuevo))}`,
      texto: `${detalle ? `${detalle}. ` : ''}Tocá para verlo, tenés ${SEGUNDOS_OFERTA} s`,
      url: pantallaCadete('dashboard.html'),
      tag: `oferta-${id}`,
      ttl: SEGUNDOS_OFERTA
    });
  }

  // ---- Cadete: el cliente canceló (la cancelación del cliente deja id_cadete puesto) ----
  if (cambioEstado && nuevo.estado_pedido === 'cancelado' && idCadete) {
    avisos.push({
      destino: { id_cad: idCadete },
      titulo: `Pedido #${id} cancelado`,
      texto: 'El cliente canceló el pedido. No tenés que hacer nada.',
      url: pantallaCadete('dashboard.html'),
      tag: `oferta-${id}`,
      ttl: UNA_HORA
    });
  }

  // ---- Cliente: avances del pedido ----
  if (cambioEstado && nuevo.id_cliente) {
    const cliente = { id_cliente: String(nuevo.id_cliente) };
    const base = { destino: cliente, url: pantallaCliente(), tag: `pedido-${id}`, ttl: UNA_HORA };
    if (nuevo.estado_pedido === 'asignado') {
      avisos.push({ ...base, titulo: '¡Ya tenés cadete!', texto: `${await nombreCadete(idCadete)} va a retirar tu pedido.` });
    } else if (nuevo.estado_pedido === 'en_camino_entrega') {
      avisos.push({ ...base, titulo: 'Tu pedido va en camino', texto: `${await nombreCadete(idCadete)} ya retiró el paquete y va a tu dirección.` });
    } else if (nuevo.estado_pedido === 'entregado') {
      avisos.push({ ...base, titulo: '¡Pedido entregado!', texto: 'Gracias por usar Todo Delivery.' });
    } else if (nuevo.estado_pedido === 'cancelado' && ESTADOS_BUSQUEDA.includes(viejo.estado_pedido)) {
      // Si lo canceló el propio cliente, tiene la app en pantalla y el celular no muestra el aviso
      avisos.push({ ...base, titulo: 'No encontramos cadete', texto: 'Esta vez no hubo cadetes disponibles. Podés volver a pedirlo.', ocultarSiAbierta: true });
    }
  }

  // ---- Chat: mensajes que no estaban antes ----
  if (viejo.Chat_pedido !== nuevo.Chat_pedido && ESTADOS_CHAT.includes(nuevo.estado_pedido)) {
    const conocidos = new Set(leerChat(viejo.Chat_pedido).map(m => m.id_mensaje));
    const nuevos = leerChat(nuevo.Chat_pedido).filter(m => !conocidos.has(m.id_mensaje));
    // Si llegan varios juntos, alcanza con avisar el último de cada lado (la etiqueta los agrupa igual)
    const ultimoDelCliente = nuevos.filter(m => m.remitente === 'cliente').at(-1);
    const ultimoDelCadete = nuevos.filter(m => m.remitente === 'cadete').at(-1);

    if (ultimoDelCliente && idCadete) {
      avisos.push({
        destino: { id_cad: idCadete },
        titulo: `Mensaje del cliente · Pedido #${id}`,
        texto: recortar(ultimoDelCliente.texto),
        url: `${pantallaCadete('pedido_activo.html')}&chat=1`,
        tag: `chat-${id}`,
        ttl: UNA_HORA
      });
    }
    if (ultimoDelCadete && nuevo.id_cliente) {
      avisos.push({
        destino: { id_cliente: String(nuevo.id_cliente) },
        titulo: `Mensaje de ${await nombreCadete(idCadete)}`,
        texto: recortar(ultimoDelCadete.texto),
        url: pantallaCliente('&chat=1'),
        tag: `chat-${id}`,
        ttl: UNA_HORA
      });
    }
  }

  return avisos;
}

/** Manda un aviso a todos los celulares del destinatario. Devuelve cuántos lo aceptaron */
async function enviar(aviso: Aviso) {
  let consulta = supabase.from('Push_suscripciones').select('endpoint, claves');
  consulta = aviso.destino.id_cad
    ? consulta.eq('id_cad', aviso.destino.id_cad)
    : consulta.eq('id_cliente', aviso.destino.id_cliente!);
  const { data: celulares, error } = await consulta;
  if (error) throw error;

  const contenido = JSON.stringify({
    titulo: aviso.titulo, texto: aviso.texto, url: aviso.url, tag: aviso.tag, ocultarSiAbierta: Boolean(aviso.ocultarSiAbierta)
  });
  let enviados = 0;
  await Promise.all((celulares || []).map(async (c) => {
    try {
      await webpush.sendNotification({ endpoint: c.endpoint, keys: c.claves }, contenido, { TTL: aviso.ttl, urgency: 'high' });
      enviados++;
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        // El celular ya no existe (desinstaló, borró datos o quitó el permiso): se limpia la tabla
        await supabase.from('Push_suscripciones').delete().eq('endpoint', c.endpoint);
      } else {
        console.warn('[enviar-push] Falló un envío:', err?.statusCode, err?.body || err?.message);
      }
    }
  }));
  return enviados;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Método no permitido', { status: 405 });

  try {
    const { push_secreto_disparador: secreto } = await leerConfig();
    if (!secreto || req.headers.get('x-push-secreto') !== secreto) {
      return new Response('No autorizado', { status: 401 });
    }

    const cuerpo = await req.json();
    let avisos: Aviso[];
    if (cuerpo.prueba) {
      // Aviso de prueba a un cadete o cliente: { prueba: { id_cad } } o { prueba: { id_cliente } }
      avisos = [{ destino: cuerpo.prueba, titulo: 'Prueba de Todo Delivery', texto: 'Si ves esto, los avisos funcionan.', url: '/', tag: 'prueba', ttl: 600 }];
    } else {
      avisos = await avisosDelCambio(cuerpo.old || {}, cuerpo.new || {});
    }

    const resultado = [];
    for (const aviso of avisos) {
      resultado.push({ tag: aviso.tag, enviados: await enviar(aviso) });
    }
    if (resultado.length) console.log('[enviar-push]', JSON.stringify(resultado));
    return Response.json({ avisos: resultado });
  } catch (err: any) {
    console.error('[enviar-push] Error:', err?.message || err);
    return Response.json({ error: String(err?.message || err) }, { status: 500 });
  }
});
