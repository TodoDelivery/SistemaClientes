// =========================================================================
// AVISOS PUSH: notificaciones con la app cerrada o la pantalla apagada
// =========================================================================
// Funcionan en Chrome para Android sin instalar la app: alcanza con el service worker (sw.js, lo registra
// pwa.js) y el permiso de la persona. En iPhone solo con la app agregada al inicio, así que ahí no se ofrecen.
// El celular queda registrado en Push_suscripciones a través de la Edge Function suscribir-push
// (la tabla está cerrada a la clave pública). Los avisos los manda enviar-push cuando cambia el pedido.
//
// La app de cadetes tiene una versión de este módulo (Scripts/avisos_push.js): cambiarlas juntas.
import { supabase } from './conexion_supabase.js';

const CLAVE_AHORA_NO = 'td_push_ahora_no';
const DIAS_SIN_VOLVER_A_PREGUNTAR = 7;

/** El navegador puede recibir avisos push (Chrome/Android sí; iPhone sin instalar no) */
export function avisosDisponibles() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** 'granted' | 'denied' | 'default' | 'no-disponible' */
export function permisoAvisos() {
  return avisosDisponibles() ? Notification.permission : 'no-disponible';
}

export function dijoAhoraNo() {
  try {
    const fecha = Number(localStorage.getItem(CLAVE_AHORA_NO));
    return Number.isFinite(fecha) && fecha > 0 && Date.now() - fecha < DIAS_SIN_VOLVER_A_PREGUNTAR * 86400000;
  } catch {
    return false;
  }
}

export function recordarAhoraNo() {
  try {
    localStorage.setItem(CLAVE_AHORA_NO, String(Date.now()));
  } catch { /* sin almacenamiento: se puede volver a preguntar, no pasa nada */ }
}

function base64UrlABytes(texto) {
  const base64 = (texto + '='.repeat((4 - texto.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

async function llamar(cuerpo) {
  const { data, error } = await supabase.functions.invoke('suscribir-push', { body: cuerpo });
  if (error) throw error;
  return data;
}

/**
 * Pide el permiso y registra este celular a nombre del cliente con sesión iniciada.
 * Llamarla desde un toque de la persona (Chrome no muestra el permiso si no).
 * @returns {Promise<boolean>} true si los avisos quedaron activos
 */
export async function activarAvisos() {
  if (!avisosDisponibles()) return false;
  if (await Notification.requestPermission() !== 'granted') return false;

  const registro = await navigator.serviceWorker.ready;
  let suscripcion = await registro.pushManager.getSubscription();
  if (!suscripcion) {
    const { clave } = await llamar({ accion: 'clave' });
    suscripcion = await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlABytes(clave)
    });
  }
  // El token de sesión viaja solo con invoke: la función saca de ahí el id_cliente
  await llamar({ accion: 'alta', suscripcion: suscripcion.toJSON() });
  return true;
}

/** Con el permiso ya dado, vuelve a registrar el celular (por si cambió la suscripción o la persona) */
export async function sincronizarAvisos() {
  if (permisoAvisos() !== 'granted') return;
  try {
    await activarAvisos();
  } catch (err) {
    console.warn('[Avisos] No se pudo registrar el celular:', err);
  }
}

/** Al cerrar sesión: este celular deja de recibir los avisos de esta cuenta */
export async function desactivarAvisos() {
  if (!avisosDisponibles()) return;
  try {
    const registro = await navigator.serviceWorker.getRegistration();
    const suscripcion = await registro?.pushManager.getSubscription();
    if (!suscripcion) return;
    await llamar({ accion: 'baja', suscripcion: { endpoint: suscripcion.endpoint } });
    await suscripcion.unsubscribe();
  } catch (err) {
    console.warn('[Avisos] No se pudo dar de baja el celular:', err);
  }
}
