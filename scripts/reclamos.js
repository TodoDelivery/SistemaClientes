// =========================================================================
// RECLAMOS DEL CLIENTE (POR AHORA SOLO LA INTERFAZ)
// =========================================================================
// Hoja inferior con los motivos, igual a la de la app de cadetes. Decisión del 16/11/2026: primero la
// interfaz; el reclamo TODAVÍA NO SE GUARDA ni llega a la central. Cuando exista el sistema de tickets
// (ver PENDIENTES_DASHBOARD.md, punto 2) solo hay que completar enviarReclamo().
import { abrirHoja, mostrarToast } from './ui_cliente.js';

export const MOTIVOS_RECLAMO = [
  { id: 'no_llego', icono: '📭', texto: 'El pedido no llegó' },
  { id: 'incompleto', icono: '📦', texto: 'Llegó incompleto o en mal estado' },
  { id: 'demora', icono: '⏱️', texto: 'Demora excesiva' },
  { id: 'cadete', icono: '🛵', texto: 'Problema con el cadete' },
  { id: 'cobro', icono: '💵', texto: 'Problema con el cobro' },
  { id: 'otro', icono: '✏️', texto: 'Otro' }
];
const LARGO_MAX_DETALLE = 500;

/**
 * Abre la hoja de reclamo de un pedido. Devuelve { motivo, detalle } o null si la cerró sin enviar.
 * @param {{ id_pedido: number }} pedido
 */
export function abrirHojaReclamo(pedido) {
  return abrirHoja((contenido, cerrar) => {
    contenido.innerHTML = `
      <div class="flex items-start gap-3">
        <span class="w-11 h-11 rounded-2xl bg-red-50 text-brand-danger flex items-center justify-center text-xl shrink-0" aria-hidden="true">🚩</span>
        <div class="min-w-0">
          <h2 id="tituloReclamo" class="text-lg font-extrabold text-brand-dark">¿Qué pasó con tu pedido?</h2>
          <p class="text-sm text-brand-textMuted">Pedido #<span data-id></span> · Elegí el motivo del reclamo</p>
        </div>
      </div>
      <div data-motivos class="mt-4 grid gap-2" role="radiogroup" aria-labelledby="tituloReclamo"></div>
      <div data-caja-detalle class="hidden mt-3">
        <label for="detalleReclamo" class="block text-sm font-bold text-brand-dark">Contanos qué pasó</label>
        <textarea id="detalleReclamo" rows="3" maxlength="${LARGO_MAX_DETALLE}"
          class="mt-1.5 w-full px-4 py-3 rounded-xl bg-brand-surfaceLight border border-brand-border text-base text-brand-dark placeholder:text-brand-textMuted/70 focus:outline-none focus:border-brand-accent focus:bg-white transition-colors resize-none"
          placeholder="Escribí el detalle (opcional si elegiste un motivo)"></textarea>
      </div>
      <div class="mt-5 grid gap-2">
        <button type="button" data-enviar disabled
          class="h-12 rounded-xl bg-brand-danger text-white font-extrabold text-sm hover:bg-red-600 transition-colors disabled:opacity-50">Enviar reclamo</button>
        <button type="button" data-cancelar data-autofoco
          class="h-12 rounded-xl bg-brand-surfaceLight border border-brand-border text-brand-dark font-bold text-sm hover:bg-brand-surfaceHover transition-colors">Volver</button>
      </div>`;

    contenido.querySelector('[data-id]').textContent = String(pedido.id_pedido);
    const lista = contenido.querySelector('[data-motivos]');
    const cajaDetalle = contenido.querySelector('[data-caja-detalle]');
    const detalle = contenido.querySelector('#detalleReclamo');
    const enviar = contenido.querySelector('[data-enviar]');
    let elegido = null;

    const puedeEnviar = () => Boolean(elegido) && (elegido.id !== 'otro' || detalle.value.trim().length > 0);

    MOTIVOS_RECLAMO.forEach(motivo => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', 'false');
      btn.className = 'w-full p-3.5 rounded-xl bg-brand-surfaceLight border border-brand-border text-left text-sm font-bold text-brand-dark flex items-center gap-3 transition-colors hover:border-brand-danger/50 aria-checked:border-brand-danger aria-checked:bg-red-50';
      btn.innerHTML = '<span class="text-lg" aria-hidden="true"></span><span class="flex-1"></span>';
      btn.firstElementChild.textContent = motivo.icono;
      btn.lastElementChild.textContent = motivo.texto;
      btn.addEventListener('click', () => {
        elegido = motivo;
        lista.querySelectorAll('[role="radio"]').forEach(b => b.setAttribute('aria-checked', String(b === btn)));
        cajaDetalle.classList.remove('hidden');
        detalle.placeholder = motivo.id === 'otro' ? 'Escribí qué pasó' : 'Si querés, sumá un detalle';
        enviar.disabled = !puedeEnviar();
        if (motivo.id === 'otro') detalle.focus();
      });
      lista.append(btn);
    });

    detalle.addEventListener('input', () => { enviar.disabled = !puedeEnviar(); });
    enviar.addEventListener('click', () => {
      if (!puedeEnviar()) return;
      cerrar({ motivo: elegido.texto, detalle: detalle.value.trim().slice(0, LARGO_MAX_DETALLE) });
    });
    contenido.querySelector('[data-cancelar]').addEventListener('click', () => cerrar(null));
  }, { etiquetadaPor: 'tituloReclamo' }).then(valor => valor || null);
}

/**
 * Envía el reclamo a la central. PENDIENTE: todavía no hay tabla de tickets, así que no se guarda;
 * se avisa con sinceridad para no hacerle creer al cliente que la central lo recibió.
 */
export async function enviarReclamo(pedido, { motivo, detalle }) {
  console.info('[Reclamos] Pendiente de conectar con la central:', { id_pedido: pedido.id_pedido, motivo, detalle });
  mostrarToast('Los reclamos desde la app todavía están en preparación: por ahora contactá a la central.', {
    tipo: 'aviso', icono: '🚩', duracionMs: 6000
  });
  return false;
}

/** Hoja + envío en un solo paso, para los botones "Reclamo" */
export async function iniciarReclamo(pedido) {
  const datos = await abrirHojaReclamo(pedido);
  if (!datos) return false;
  navigator.vibrate?.([100, 50, 100]);
  return enviarReclamo(pedido, datos);
}
