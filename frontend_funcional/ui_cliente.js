// =========================================================================
// UI COMPARTIDA DE LA APP CLIENTES
// =========================================================================
// Barra superior, barra de navegación inferior, avisos (toasts), hojas inferiores y formatos.
// Cada página tiene <header id="appBar">, <main id="contenidoPagina">, <div id="cargandoPagina">
// y <nav id="barraInferior">; montarLayoutCliente() los completa.
import { esBusquedaVencida } from './script_asignacion.js';
import { PAGINAS } from './sesion_cliente.js';

// -------------------------------------------------------------------------
// CATÁLOGOS
// -------------------------------------------------------------------------
export const TIPOS_PAQUETE = [
  { valor: 'Bolsa de Comida', emoji: '🍱', texto: 'Comida' },
  { valor: 'Caja de Pizza', emoji: '🍕', texto: 'Pizza / Empanadas' },
  { valor: 'Paquete Chico', emoji: '📦', texto: 'Paquete chico' },
  { valor: 'Bebidas', emoji: '🍾', texto: 'Bebidas' },
  { valor: 'Farmacia', emoji: '💊', texto: 'Farmacia' }
];

const CHIP_BUSCANDO = 'bg-amber-500/15 text-amber-300';
const CHIP_CANCELADO = 'bg-red-500/15 text-red-300';

const ESTADOS_UI = {
  pendiente: { texto: 'Buscando cadete', clases: CHIP_BUSCANDO },
  libre: { texto: 'Buscando cadete', clases: CHIP_BUSCANDO },
  en_confirmacion: { texto: 'Confirmando cadete', clases: CHIP_BUSCANDO },
  asignado: { texto: 'Cadete asignado', clases: 'bg-blue-500/15 text-blue-300' },
  en_camino_entrega: { texto: 'En camino', clases: 'bg-brand-accent/15 text-brand-accent' },
  entregado: { texto: 'Entregado', clases: 'bg-emerald-500/15 text-emerald-300' },
  rendido: { texto: 'Entregado', clases: 'bg-emerald-500/15 text-emerald-300' },
  cancelado: { texto: 'Cancelado', clases: CHIP_CANCELADO }
};

/** Texto y clases del chip de estado de un pedido */
export function estadoUI(pedido) {
  if (esBusquedaVencida(pedido)) return { texto: 'Sin cadete', clases: CHIP_CANCELADO };
  return ESTADOS_UI[pedido?.estado_pedido] || { texto: pedido?.estado_pedido || '—', clases: 'bg-zinc-500/15 text-zinc-300' };
}

export function emojiPaquete(valor) {
  return TIPOS_PAQUETE.find(t => t.valor === valor)?.emoji || '📦';
}

export const TIPOS_FAVORITA = {
  casa: { emoji: '🏠', texto: 'Casa', nombrePorDefecto: 'Casa' },
  trabajo: { emoji: '💼', texto: 'Trabajo', nombrePorDefecto: 'Trabajo' },
  otro: { emoji: '📍', texto: 'Otro', nombrePorDefecto: '' }
};

export function emojiFavorita(tipo) {
  return TIPOS_FAVORITA[tipo]?.emoji || '📍';
}

// -------------------------------------------------------------------------
// ÍCONOS (trazos de 24x24)
// -------------------------------------------------------------------------
const ICONOS = {
  pedir: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  seguimiento: '<path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  historial: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  refrescar: '<path d="M20 11a8 8 0 0 0-14.9-4M4 4v3.5h3.5M4 13a8 8 0 0 0 14.9 4M20 20v-3.5h-3.5"/>',
  salir: '<path d="M15 12H4m0 0 4-4m-4 4 4 4"/><path d="M13 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5"/>',
  flecha: '<path d="m9 6 6 6-6 6"/>',
  gps: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  buscar: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  perfil: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  estrella: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  editar: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  borrar: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  mas: '<path d="M12 5v14M5 12h14"/>',
  copiar: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'
};

export function icono(nombre, clases = 'w-6 h-6') {
  return `<svg class="${clases}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[nombre] || ''}</svg>`;
}

// -------------------------------------------------------------------------
// LAYOUT: BARRA SUPERIOR + BARRA INFERIOR
// -------------------------------------------------------------------------
const PESTANAS = [
  { id: 'solicitar', href: PAGINAS.crearPedido, texto: 'Pedir', icono: 'pedir' },
  { id: 'seguimiento', href: PAGINAS.pedidoActivo, texto: 'Seguimiento', icono: 'seguimiento' },
  { id: 'historial', href: PAGINAS.dashboard, texto: 'Mis pedidos', icono: 'historial' },
  { id: 'perfil', href: PAGINAS.configuracion, texto: 'Perfil', icono: 'perfil' }
];

/**
 * Pinta la barra superior y la de navegación inferior y muestra #contenidoPagina.
 * @param {Object} cliente - resultado de requerirCliente()
 * @param {'solicitar'|'seguimiento'|'historial'|'perfil'} pestanaActiva
 * @param {string} titulo - título de la barra superior
 * @returns {{ acciones: HTMLElement }} contenedor para botones extra de la barra superior
 */
export function montarLayoutCliente(cliente, pestanaActiva, titulo) {
  const appBar = document.getElementById('appBar');
  appBar.className = 'sticky top-0 z-[1100] pt-safe bg-brand-bg/85 backdrop-blur-xl border-b border-brand-border/60';
  appBar.innerHTML = `
    <div class="mx-auto max-w-xl h-14 px-4 flex items-center gap-3">
      <a href="${PAGINAS.dashboard}" aria-label="Todo Delivery, ir a mis pedidos"
        class="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-accent to-brand-accentHover flex items-center justify-center text-brand-bg font-black text-sm shrink-0">TD</a>
      <h1 id="tituloPagina" class="flex-1 min-w-0 text-lg font-extrabold tracking-tight truncate"></h1>
      <div id="accionesAppBar" class="flex items-center gap-1"></div>
      <a id="btnCuenta" href="${PAGINAS.configuracion}" aria-label="Mi perfil"
        class="w-10 h-10 rounded-full overflow-hidden bg-brand-surfaceLight border ${pestanaActiva === 'perfil' ? 'border-brand-accent' : 'border-brand-border'} text-sm font-extrabold text-brand-accent flex items-center justify-center shrink-0 hover:border-brand-accent/60 transition-colors"></a>
    </div>
  `;
  document.getElementById('tituloPagina').textContent = titulo;
  pintarAvatar(document.getElementById('btnCuenta'), cliente);

  const barra = document.getElementById('barraInferior');
  barra.className = 'fixed inset-x-0 bottom-0 z-[1100] pb-safe bg-brand-surface/95 backdrop-blur-xl border-t border-brand-border';
  barra.setAttribute('aria-label', 'Navegación principal');
  barra.innerHTML = `
    <div class="mx-auto max-w-xl grid grid-cols-4" style="height: var(--alto-nav)">
      ${PESTANAS.map(p => {
        const activa = p.id === pestanaActiva;
        const pulso = p.id === 'seguimiento'
          ? `<span id="tabTrackingPulse" class="hidden absolute top-0 right-2 w-2.5 h-2.5 rounded-full bg-brand-accent ring-2 ring-brand-surface">
               <span class="absolute inset-0 rounded-full bg-brand-accent animate-ping"></span>
               <span class="sr-only">(pedido en curso)</span>
             </span>`
          : '';
        return `
          <a href="${p.href}" ${activa ? 'aria-current="page"' : ''}
            class="flex flex-col items-center justify-center gap-1 text-xs font-bold transition-colors ${activa ? 'text-brand-accent' : 'text-brand-textMuted hover:text-white'}">
            <span class="relative flex items-center justify-center w-14 h-8 rounded-full transition-colors ${activa ? 'bg-brand-accent/15' : ''}">
              ${icono(p.icono)}
              ${pulso}
            </span>
            <span>${p.texto}</span>
          </a>`;
      }).join('')}
    </div>
  `;

  document.getElementById('cargandoPagina')?.classList.add('hidden');
  document.getElementById('contenidoPagina')?.classList.remove('hidden');
  return { acciones: document.getElementById('accionesAppBar') };
}

/** Indicador de pedido en curso en la pestaña Seguimiento */
export function marcarSeguimientoActivo(activo) {
  document.getElementById('tabTrackingPulse')?.classList.toggle('hidden', !activo);
}

/** Botón redondo para la barra superior (ej: refrescar) */
export function crearBotonAppBar(nombreIcono, etiqueta) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', etiqueta);
  btn.title = etiqueta;
  btn.className = 'w-10 h-10 rounded-full flex items-center justify-center text-brand-textMuted hover:text-white hover:bg-brand-surfaceLight transition-colors disabled:opacity-60';
  btn.innerHTML = icono(nombreIcono, 'w-5 h-5');
  return btn;
}

/**
 * Foto de Google del cliente dentro de `contenedor` (que debe tener overflow-hidden y forma redonda).
 * Si no hay foto o no carga, muestra las iniciales.
 */
export function pintarAvatar(contenedor, cliente) {
  const textoIniciales = iniciales(cliente.nombre_cliente);
  contenedor.textContent = textoIniciales;
  if (!cliente.foto) return;

  const img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer'; // las fotos de Google suelen rechazar pedidos con referrer
  img.className = 'w-full h-full object-cover';
  img.addEventListener('load', () => contenedor.replaceChildren(img), { once: true });
  img.src = cliente.foto;
}

// -------------------------------------------------------------------------
// UBICACIONES FAVORITAS: CAMPOS Y HOJA DE NOMBRE
// -------------------------------------------------------------------------

/**
 * Selector de tipo (Casa / Trabajo / Otro) + nombre dentro de `contenedor`.
 * @returns {{ valores: () => { tipo, nombre }, inputNombre: HTMLInputElement }}
 */
export function montarCamposFavorita(contenedor, { tipo = 'casa', nombre = '' } = {}) {
  contenedor.innerHTML = `
    <div role="radiogroup" aria-label="Tipo de ubicación" class="grid grid-cols-3 gap-2" data-tipos>
      ${Object.entries(TIPOS_FAVORITA).map(([clave, t]) => `
        <button type="button" role="radio" data-tipo="${clave}"
          class="h-11 rounded-xl border text-sm font-bold flex items-center justify-center gap-1.5 transition-colors">
          <span aria-hidden="true">${t.emoji}</span>${t.texto}
        </button>`).join('')}
    </div>
    <label for="inpNombreFavorita" class="mt-4 block text-sm font-bold mb-1.5">Nombre</label>
    <input id="inpNombreFavorita" type="text" maxlength="40" autocomplete="off" enterkeyhint="done"
      placeholder="Ej: Casa de mamá"
      class="w-full h-12 px-4 rounded-xl bg-brand-surfaceLight border border-brand-border text-base text-white placeholder:text-brand-textMuted/70 focus:outline-none focus:border-brand-accent" />
  `;

  let tipoActual = TIPOS_FAVORITA[tipo] ? tipo : 'otro';
  const inputNombre = contenedor.querySelector('#inpNombreFavorita');
  inputNombre.value = nombre || TIPOS_FAVORITA[tipoActual].nombrePorDefecto;
  const nombresPorDefecto = Object.values(TIPOS_FAVORITA).map(t => t.nombrePorDefecto).filter(Boolean);

  const render = () => {
    contenedor.querySelectorAll('[data-tipo]').forEach(btn => {
      const activo = btn.dataset.tipo === tipoActual;
      btn.setAttribute('aria-checked', String(activo));
      btn.className = `h-11 rounded-xl border text-sm font-bold flex items-center justify-center gap-1.5 transition-colors ${activo
        ? 'bg-brand-accent/15 border-brand-accent text-brand-accent'
        : 'bg-brand-surfaceLight border-brand-border text-brand-textMuted hover:text-white'}`;
    });
  };

  contenedor.querySelectorAll('[data-tipo]').forEach(btn => {
    btn.addEventListener('click', () => {
      tipoActual = btn.dataset.tipo;
      // Si el nombre era el sugerido por otro tipo, se reemplaza por el del nuevo
      const actual = inputNombre.value.trim();
      if (!actual || nombresPorDefecto.includes(actual)) {
        inputNombre.value = TIPOS_FAVORITA[tipoActual].nombrePorDefecto;
        if (!inputNombre.value) inputNombre.focus();
      }
      render();
    });
  });
  render();

  return { valores: () => ({ tipo: tipoActual, nombre: inputNombre.value.trim() }), inputNombre };
}

/**
 * Hoja para elegir tipo y nombre de una favorita. `alGuardar(valores)` se ejecuta con la hoja abierta:
 * si lanza, el error se muestra ahí mismo y el usuario puede reintentar.
 * @returns {Promise<{ tipo, nombre } | null>}
 */
export function hojaDatosFavorita({ titulo, detalle = '', tipo, nombre = '', textoConfirmar = 'Guardar', alGuardar }) {
  return abrirHoja((contenido, cerrar) => {
    contenido.innerHTML = `
      <h2 id="tituloHoja" class="text-lg font-extrabold"></h2>
      <p data-detalle class="mt-1 text-sm text-brand-textMuted"></p>
      <div data-campos class="mt-4"></div>
      <p data-error role="alert" class="hidden mt-3 text-sm font-semibold text-brand-danger"></p>
      <div class="mt-5 grid gap-2">
        <button type="button" data-guardar
          class="h-12 rounded-xl bg-brand-accent text-brand-bg font-extrabold text-sm disabled:opacity-60"></button>
        <button type="button" data-cancelar
          class="h-12 rounded-xl bg-brand-surfaceLight border border-brand-border font-bold text-sm">Cancelar</button>
      </div>
    `;
    contenido.querySelector('#tituloHoja').textContent = titulo;
    contenido.querySelector('[data-detalle]').textContent = detalle;

    const campos = montarCamposFavorita(contenido.querySelector('[data-campos]'), { tipo, nombre });
    const btnGuardar = contenido.querySelector('[data-guardar]');
    const error = contenido.querySelector('[data-error]');
    btnGuardar.textContent = textoConfirmar;

    const guardar = async () => {
      const valores = campos.valores();
      if (!valores.nombre) {
        error.textContent = 'Poné un nombre para reconocerla';
        error.classList.remove('hidden');
        campos.inputNombre.focus();
        return;
      }
      error.classList.add('hidden');
      btnGuardar.disabled = true;
      btnGuardar.textContent = 'Guardando...';
      try {
        await alGuardar?.(valores);
        cerrar(valores);
      } catch (err) {
        console.error('[Favoritas] No se pudo guardar:', err);
        error.textContent = err.paraUsuario ? err.message : 'No pudimos guardar. Probá de nuevo.';
        error.classList.remove('hidden');
        btnGuardar.disabled = false;
        btnGuardar.textContent = textoConfirmar;
      }
    };

    btnGuardar.addEventListener('click', guardar);
    campos.inputNombre.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        guardar();
      }
    });
    contenido.querySelector('[data-cancelar]').addEventListener('click', () => cerrar(null));
    campos.inputNombre.setAttribute('data-autofoco', '');
  }, { etiquetadaPor: 'tituloHoja' }).then(valores => valores || null);
}

// -------------------------------------------------------------------------
// HOJAS INFERIORES (MODALES)
// -------------------------------------------------------------------------

/**
 * Abre una hoja inferior modal. `construir(contenido, cerrar)` la llena; `cerrar(valor)` la cierra.
 * Se cierra también con Escape o tocando el fondo (valor undefined).
 * @returns {Promise<any>} el valor con el que se cerró
 */
export function abrirHoja(construir, { etiquetadaPor } = {}) {
  return new Promise((resolve) => {
    const focoPrevio = document.activeElement;
    const overflowPrevio = document.body.style.overflow;

    const capa = document.createElement('div');
    capa.className = 'fixed inset-0 z-[1200] flex items-end sm:items-center justify-center sm:p-4';

    const fondo = document.createElement('div');
    fondo.className = 'hoja-fondo absolute inset-0 bg-black/60';

    const panel = document.createElement('div');
    panel.className = 'hoja-panel hoja-pb relative w-full sm:max-w-md max-h-[90dvh] overflow-y-auto bg-brand-surface border-t sm:border border-brand-border rounded-t-3xl sm:rounded-3xl px-5 pt-3 shadow-2xl focus:outline-none';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    if (etiquetadaPor) panel.setAttribute('aria-labelledby', etiquetadaPor);
    panel.tabIndex = -1;

    const asa = document.createElement('div');
    asa.className = 'mx-auto mb-4 w-10 h-1.5 rounded-full bg-brand-border sm:invisible';
    const contenido = document.createElement('div');
    panel.append(asa, contenido);
    capa.append(fondo, panel);

    let cerrada = false;
    const cerrar = (valor) => {
      if (cerrada) return;
      cerrada = true;
      document.removeEventListener('keydown', onTecla, true);
      capa.remove();
      document.body.style.overflow = overflowPrevio;
      focoPrevio?.focus?.({ preventScroll: true });
      resolve(valor);
    };

    const onTecla = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cerrar(undefined);
      } else if (e.key === 'Tab') {
        // Mantener el foco dentro de la hoja
        const enfocables = [...panel.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])')];
        if (enfocables.length === 0) return;
        const primero = enfocables[0];
        const ultimo = enfocables[enfocables.length - 1];
        if (e.shiftKey && (document.activeElement === primero || document.activeElement === panel)) {
          e.preventDefault();
          ultimo.focus();
        } else if (!e.shiftKey && document.activeElement === ultimo) {
          e.preventDefault();
          primero.focus();
        }
      }
    };

    fondo.addEventListener('click', () => cerrar(undefined));
    document.addEventListener('keydown', onTecla, true);

    construir(contenido, cerrar);
    document.body.style.overflow = 'hidden';
    document.body.appendChild(capa);
    (contenido.querySelector('[data-autofoco]') || panel).focus({ preventScroll: true });
  });
}

/**
 * Pregunta de confirmación en hoja inferior (reemplaza a confirm()).
 * @returns {Promise<boolean>}
 */
export function confirmar({ titulo, mensaje = '', textoConfirmar = 'Confirmar', textoCancelar = 'Volver', peligro = false }) {
  return abrirHoja((contenido, cerrar) => {
    contenido.innerHTML = `
      <h2 id="tituloHoja" class="text-lg font-extrabold"></h2>
      <p data-mensaje class="mt-1.5 text-sm text-brand-textMuted whitespace-pre-line"></p>
      <div class="mt-5 grid gap-2">
        <button type="button" data-si ${peligro ? '' : 'data-autofoco'}
          class="h-12 rounded-xl font-extrabold text-sm ${peligro ? 'bg-brand-danger text-white' : 'bg-brand-accent text-brand-bg'}"></button>
        <button type="button" data-no ${peligro ? 'data-autofoco' : ''}
          class="h-12 rounded-xl bg-brand-surfaceLight border border-brand-border font-bold text-sm"></button>
      </div>
    `;
    contenido.querySelector('#tituloHoja').textContent = titulo;
    contenido.querySelector('[data-mensaje]').textContent = mensaje;
    const si = contenido.querySelector('[data-si]');
    const no = contenido.querySelector('[data-no]');
    si.textContent = textoConfirmar;
    no.textContent = textoCancelar;
    si.addEventListener('click', () => cerrar(true));
    no.addEventListener('click', () => cerrar(false));
  }, { etiquetadaPor: 'tituloHoja' }).then(valor => valor === true);
}

// -------------------------------------------------------------------------
// AVISOS (TOASTS)
// -------------------------------------------------------------------------
const ESTILOS_TOAST = {
  info: { clases: 'bg-brand-surface/95 border-brand-border text-white', icono: 'ℹ️' },
  exito: { clases: 'bg-emerald-950/95 border-emerald-500/40 text-emerald-50', icono: '✅' },
  aviso: { clases: 'bg-amber-950/95 border-amber-500/40 text-amber-50', icono: '⚠️' },
  error: { clases: 'bg-red-950/95 border-red-500/40 text-red-50', icono: '⚠️' }
};

/**
 * Aviso breve arriba de la pantalla (reemplaza a alert()).
 * @param {string} mensaje
 * @param {{ tipo?: 'info'|'exito'|'aviso'|'error', duracionMs?: number, icono?: string, alTocar?: Function }} opciones
 */
export function mostrarToast(mensaje, { tipo = 'info', duracionMs = 4000, icono: emoji, alTocar } = {}) {
  let contenedor = document.getElementById('contenedorToasts');
  if (!contenedor) {
    contenedor = document.createElement('div');
    contenedor.id = 'contenedorToasts';
    contenedor.className = 'toasts-top fixed inset-x-0 z-[1300] flex flex-col items-center gap-2 px-4 pointer-events-none';
    document.body.appendChild(contenedor);
  }

  const estilo = ESTILOS_TOAST[tipo] || ESTILOS_TOAST.info;
  const toast = document.createElement('div');
  toast.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  toast.className = `toast-entrada pointer-events-auto w-full max-w-md flex items-start gap-3 px-4 py-3 rounded-2xl border shadow-2xl backdrop-blur-xl text-sm font-semibold cursor-pointer ${estilo.clases}`;

  const iconoEl = document.createElement('span');
  iconoEl.setAttribute('aria-hidden', 'true');
  iconoEl.textContent = emoji || estilo.icono;
  const textoEl = document.createElement('span');
  textoEl.className = 'flex-1 min-w-0 break-words';
  textoEl.textContent = mensaje;
  toast.append(iconoEl, textoEl);

  contenedor.appendChild(toast);
  while (contenedor.children.length > 3) contenedor.firstElementChild.remove();

  let quitado = false;
  const quitar = () => {
    if (quitado) return;
    quitado = true;
    toast.classList.add('toast-salida');
    setTimeout(() => toast.remove(), 200);
  };
  toast.addEventListener('click', () => {
    alTocar?.();
    quitar();
  });
  setTimeout(quitar, duracionMs);
}

/** Reemplaza el contenido de la página por un mensaje de error con botón para reintentar */
export function mostrarErrorPagina(mensaje) {
  document.getElementById('cargandoPagina')?.classList.add('hidden');
  const contenido = document.getElementById('contenidoPagina');
  if (!contenido) return;

  contenido.classList.remove('hidden');
  contenido.innerHTML = `
    <div class="min-h-[60dvh] flex flex-col items-center justify-center text-center px-6">
      <div class="w-20 h-20 rounded-3xl bg-brand-danger/10 border border-brand-danger/30 flex items-center justify-center text-4xl" aria-hidden="true">⚠️</div>
      <h2 class="mt-5 text-xl font-extrabold">No pudimos cargar la página</h2>
      <p id="detalleErrorPagina" class="mt-2 text-sm text-brand-textMuted max-w-xs"></p>
      <button type="button" onclick="location.reload()"
        class="mt-6 h-12 px-6 rounded-xl bg-brand-accent text-brand-bg font-extrabold text-sm">Reintentar</button>
    </div>
  `;
  document.getElementById('detalleErrorPagina').textContent = mensaje;
}

// -------------------------------------------------------------------------
// FORMATOS
// -------------------------------------------------------------------------
export function formatearPesos(valor) {
  return `$${Math.round(Number(valor) || 0).toLocaleString('es-AR')}`;
}

/** "Hoy, 14:30" · "Ayer, 09:10" · "12 sept, 18:00" · "12 sept 2025, 18:00" */
export function formatearFechaPedido(iso) {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';

  const hora = fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const hoy = new Date();
  const inicioDelDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dias = Math.round((inicioDelDia(hoy) - inicioDelDia(fecha)) / 86400000);

  if (dias === 0) return `Hoy, ${hora}`;
  if (dias === 1) return `Ayer, ${hora}`;
  const opciones = { day: 'numeric', month: 'short' };
  if (fecha.getFullYear() !== hoy.getFullYear()) opciones.year = 'numeric';
  return `${fecha.toLocaleDateString('es-AR', opciones)}, ${hora}`;
}

export function iniciales(nombre) {
  return String(nombre || '').split(/\s+/).filter(Boolean).map(p => p[0]).join('').substring(0, 2).toUpperCase() || 'TD';
}

export function primerNombre(nombre) {
  return String(nombre || '').trim().split(/\s+/)[0] || '';
}

export function escaparHtml(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
