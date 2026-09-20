// =========================================================================
// SESIÓN DEL CLIENTE Y CONSULTAS COMUNES (APP CLIENTES)
// =========================================================================
// Usado por dashboard.html, crear_pedido.html, pedido_activo.html y configuracion.html.
// login_google.html es la única página que crea la fila en 'Clientes' (pide el teléfono).
import { supabase } from './conexion_supabase.js';
import { ESTADOS_BUSQUEDA, esBusquedaVencida, vencerBusquedasAbandonadas } from './script_asignacion.js';

export const PAGINAS = {
  get login() {
    return (typeof window !== 'undefined' && window.location.pathname.includes('/templates/'))
      ? '../index.html'
      : 'index.html';
  },
  dashboard: 'dashboard.html',
  crearPedido: 'crear_pedido.html',
  pedidoActivo: 'pedido_activo.html',
  configuracion: 'configuracion.html'
};

// Pedidos que todavía se pueden seguir en vivo
export const ESTADOS_EN_CURSO = ['asignado', 'en_camino_entrega', ...ESTADOS_BUSQUEDA];

// Teléfonos de relleno que cargaba el prototipo: se tratan como "sin teléfono"
const TELEFONOS_DE_PRUEBA = ['549264123456', '549264000000'];

export const MAX_FAVORITAS = 10;
export const TIPOS_FAVORITA_VALIDOS = ['casa', 'trabajo', 'otro'];

let limpiezaAntesDeSalir = null;
let saliendo = false;

/** Error con un mensaje apto para mostrarle al usuario */
export function errorParaUsuario(mensaje) {
  const error = new Error(mensaje);
  error.paraUsuario = true;
  return error;
}

// -------------------------------------------------------------------------
// SESIÓN
// -------------------------------------------------------------------------
export function nombreVisible(user) {
  const meta = user?.user_metadata || {};
  return meta.full_name || meta.name || user?.email?.split('@')[0] || 'Cliente';
}

/** Foto de perfil de Google que Supabase Auth guarda en los metadatos del usuario */
export function fotoDeUsuario(user) {
  const meta = user?.user_metadata || {};
  return meta.avatar_url || meta.picture || '';
}

export async function obtenerFilaCliente(idCliente) {
  const { data, error } = await supabase
    .from('Clientes')
    .select('id_cliente, nombre_cliente, telefono_cliente, f_loggueo_cliente, ubicaciones_favs')
    .eq('id_cliente', idCliente)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/** Solo dígitos, entre 8 y 15. Devuelve el teléfono limpio o null si no es válido */
export function validarTelefono(texto) {
  const telefono = String(texto || '').replace(/\D/g, '');
  return telefono.length >= 8 && telefono.length <= 15 ? telefono : null;
}

/** true si el cliente no tiene un teléfono real cargado */
export function telefonoPendiente(telefono) {
  return !validarTelefono(telefono) || TELEFONOS_DE_PRUEBA.includes(String(telefono));
}

/** Actualiza nombre y teléfono del cliente. Devuelve la fila guardada */
export async function actualizarDatosCliente(idCliente, { nombre, telefono }) {
  const { data, error } = await supabase
    .from('Clientes')
    .update({ nombre_cliente: nombre, telefono_cliente: telefono })
    .eq('id_cliente', idCliente)
    .select('id_cliente, nombre_cliente, telefono_cliente')
    .maybeSingle();

  if (error) throw error;
  // Sin filas y sin error: RLS no permite el UPDATE sobre Clientes
  if (!data) throw new Error('No se actualizó la fila de Clientes (revisar la política RLS de UPDATE)');
  return data;
}

export async function registrarCliente(user, { nombre, telefono }) {
  const { error } = await supabase
    .from('Clientes')
    .insert({
      id_cliente: user.id,
      nombre_cliente: nombre,
      telefono_cliente: telefono,
      f_loggueo_cliente: new Date().toISOString()
    });

  // 23505: la fila ya existe (ej: se completó el perfil desde otra pestaña)
  if (error && error.code !== '23505') throw error;
}

/**
 * Exige sesión y fila en 'Clientes'. Si falta alguna, manda a login_google.html y devuelve null.
 * @returns {Promise<{id_cliente, nombre_cliente, telefono_cliente, email} | null>}
 */
export async function requerirCliente() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    window.location.replace(PAGINAS.login);
    return null;
  }

  const fila = await obtenerFilaCliente(session.user.id);
  if (!fila) {
    window.location.replace(PAGINAS.login);
    return null;
  }

  // Pedidos que quedaron buscando cadete sin motor (se cerró la app a mitad): se cancelan antes de
  // mostrar nada, para que no aparezcan "buscando cadete" días después ni se vuelvan a ofrecer
  try {
    const vencidos = await vencerBusquedasAbandonadas(fila.id_cliente);
    if (vencidos.length) console.log(`[Sesión] Búsquedas vencidas canceladas: #${vencidos.join(', #')}`);
  } catch (err) {
    console.warn('[Sesión] No se pudieron cancelar las búsquedas vencidas:', err);
  }

  // Sesión cerrada desde otra pestaña o token vencido
  supabase.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_OUT') salirAlLogin();
  });

  return {
    id_cliente: fila.id_cliente,
    nombre_cliente: fila.nombre_cliente || nombreVisible(session.user),
    telefono_cliente: fila.telefono_cliente,
    email: session.user.email || '',
    foto: fotoDeUsuario(session.user),
    cliente_desde: fila.f_loggueo_cliente,
    favoritas: normalizarFavoritas(fila.ubicaciones_favs)
  };
}

/** Lo que la página tiene que liberar antes de salir por logout (ej: detener la búsqueda de cadete) */
export function registrarLimpiezaAntesDeSalir(fn) {
  limpiezaAntesDeSalir = fn;
}

async function ejecutarLimpieza() {
  try {
    await limpiezaAntesDeSalir?.();
  } catch (err) {
    console.warn('[Sesión] Error liberando recursos antes de salir:', err);
  }
}

async function salirAlLogin() {
  if (saliendo) return;
  saliendo = true;
  await ejecutarLimpieza();
  window.location.replace(PAGINAS.login);
}

export async function cerrarSesion() {
  if (saliendo) return;
  saliendo = true;
  await ejecutarLimpieza();
  try {
    await supabase.auth.signOut();
  } catch (err) {
    console.warn('[Sesión] Error al cerrar sesión en Supabase:', err);
  }
  window.location.replace(PAGINAS.login);
}

// -------------------------------------------------------------------------
// UBICACIONES FAVORITAS (Clientes.ubicaciones_favs, jsonb)
// -------------------------------------------------------------------------
// Formato: [{ id, tipo: 'casa'|'trabajo'|'otro', nombre, direccion, zona, lat, lng }]

/** Convierte lo que haya en la columna en una lista válida (ignora entradas rotas) */
export function normalizarFavoritas(valor) {
  const lista = Array.isArray(valor) ? valor : [];
  return lista
    .map(f => {
      const lat = Number(f?.lat);
      const lng = Number(f?.lng);
      if (f?.lat == null || f?.lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        id: String(f.id || `${lat.toFixed(5)},${lng.toFixed(5)}`),
        tipo: TIPOS_FAVORITA_VALIDOS.includes(f.tipo) ? f.tipo : 'otro',
        nombre: String(f.nombre || '').trim().slice(0, 40) || 'Ubicación',
        direccion: String(f.direccion || '').slice(0, 120),
        zona: String(f.zona || '').slice(0, 120),
        lat,
        lng
      };
    })
    .filter(Boolean)
    .slice(0, MAX_FAVORITAS);
}

export function nuevaFavorita({ tipo, nombre, direccion = '', zona = '', lat, lng }) {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return { id, tipo, nombre, direccion, zona, lat, lng };
}

/**
 * Relee las favoritas de la BD, aplica `cambio(lista)` y guarda el resultado.
 * Se relee antes de escribir para no pisar cambios hechos desde otra pestaña.
 * @returns {Promise<Array>} la lista guardada
 */
export async function modificarFavoritas(idCliente, cambio) {
  const { data: fila, error } = await supabase
    .from('Clientes')
    .select('ubicaciones_favs')
    .eq('id_cliente', idCliente)
    .maybeSingle();

  if (error) throw error;
  if (!fila) throw new Error('No se encontró la fila del cliente');

  const nuevaLista = cambio(normalizarFavoritas(fila.ubicaciones_favs));
  if (nuevaLista.length > MAX_FAVORITAS) {
    throw errorParaUsuario(`Podés guardar hasta ${MAX_FAVORITAS} ubicaciones favoritas`);
  }

  const { data, error: errorGuardar } = await supabase
    .from('Clientes')
    .update({ ubicaciones_favs: normalizarFavoritas(nuevaLista) })
    .eq('id_cliente', idCliente)
    .select('ubicaciones_favs')
    .maybeSingle();

  if (errorGuardar) throw errorGuardar;
  if (!data) throw new Error('No se actualizó la fila de Clientes (revisar la política RLS de UPDATE)');
  return normalizarFavoritas(data.ubicaciones_favs);
}

// -------------------------------------------------------------------------
// PEDIDOS
// -------------------------------------------------------------------------

/** En curso = con cadete y sin entregar, o buscando cadete sin haber vencido */
export function esPedidoEnCurso(pedido) {
  return Boolean(pedido && ESTADOS_EN_CURSO.includes(pedido.estado_pedido) && !esBusquedaVencida(pedido));
}

export async function buscarPedidoEnCurso(idCliente) {
  const { data, error } = await supabase
    .from('Pedidos')
    .select('*')
    .eq('id_cliente', idCliente)
    .in('estado_pedido', ESTADOS_EN_CURSO)
    .order('fecha_pedido', { ascending: false })
    .limit(5);

  if (error) throw error;
  // Si no se pudo cancelar una búsqueda vencida, igual no se la trata como en curso
  return (data || []).find(esPedidoEnCurso) || null;
}
