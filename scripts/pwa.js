// =========================================================================
// PWA: SERVICE WORKER Y AVISO PARA INSTALAR LA APP EN EL CELULAR
// =========================================================================
// Android/Chrome: el navegador avisa con 'beforeinstallprompt' y el botón "Instalar" abre su diálogo.
// iPhone/iPad (Safari): no hay diálogo; se explican los pasos de "Añadir a pantalla de inicio".
// Se importa desde ui_cliente.js, así que el listener está puesto antes de que el evento se dispare.

const CLAVE_RECHAZO = 'td_pwa_rechazo';
const DIAS_SIN_VOLVER_A_PEDIR = 7;
const LOGO = new URL('../images/Logo_svg.svg', import.meta.url).href;

let eventoInstalacion = null; // el evento de Chrome, guardado para dispararlo desde nuestro botón
let avisoMostrado = false;

// ---- Service worker ------------------------------------------------------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('../sw.js', import.meta.url).href)
      .catch(err => console.warn('[PWA] No se pudo registrar el service worker:', err));
  });
}

// ---- Estado del dispositivo ----------------------------------------------
const esMovil = () =>
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)); // iPad que se presenta como Mac

const esIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

const yaInstalada = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

function recientementeRechazado() {
  try {
    const fecha = Number(localStorage.getItem(CLAVE_RECHAZO));
    return Number.isFinite(fecha) && fecha > 0 && Date.now() - fecha < DIAS_SIN_VOLVER_A_PEDIR * 86400000;
  } catch {
    return false;
  }
}

function recordarRechazo() {
  try {
    localStorage.setItem(CLAVE_RECHAZO, String(Date.now()));
  } catch { /* sin almacenamiento: el aviso puede volver a salir, no pasa nada */ }
}

// ---- Eventos del navegador -----------------------------------------------
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // evita la mini barra de Chrome: el aviso lo mostramos nosotros
  eventoInstalacion = e;
  if (avisoPendiente) mostrarAviso();
});

window.addEventListener('appinstalled', () => {
  eventoInstalacion = null;
  cerrarAviso();
  recordarRechazo();
});

// ---- Aviso ---------------------------------------------------------------
let avisoPendiente = false;

/**
 * Muestra el aviso de instalación si corresponde: celular, app sin instalar y sin haberlo
 * rechazado en los últimos días. En Android espera a que el navegador confirme que se puede instalar.
 */
export function iniciarAvisoInstalacion() {
  if (!esMovil() || yaInstalada() || recientementeRechazado()) return;
  avisoPendiente = true;
  if (eventoInstalacion || esIOS()) setTimeout(mostrarAviso, 1500);
}

function mostrarAviso() {
  if (avisoMostrado || !avisoPendiente || yaInstalada()) return;
  if (!eventoInstalacion && !esIOS()) return;
  avisoMostrado = true;

  const ios = !eventoInstalacion;
  const contenedor = document.createElement('div');
  contenedor.id = 'avisoInstalarApp';
  contenedor.className = 'fixed inset-0 z-[1400] flex items-end justify-center bg-black/40 backdrop-blur-[2px]';
  contenedor.setAttribute('role', 'dialog');
  contenedor.setAttribute('aria-modal', 'true');
  contenedor.setAttribute('aria-labelledby', 'tituloInstalarApp');
  contenedor.innerHTML = `
    <div class="w-full max-w-md bg-white rounded-t-3xl shadow-2xl px-5 pt-5 hoja-pb">
      <div class="flex items-center gap-4">
        <span class="w-16 h-16 rounded-2xl bg-white border border-brand-border shadow-card p-2 shrink-0 flex items-center justify-center">
          <img src="${LOGO}" alt="" class="w-full h-full object-contain" />
        </span>
        <div class="min-w-0">
          <h2 id="tituloInstalarApp" class="text-lg font-black text-brand-dark leading-tight">Instalá Todo Delivery</h2>
          <p class="mt-0.5 text-sm text-brand-textMuted">Entrá más rápido desde el inicio de tu celular, sin abrir el navegador.</p>
        </div>
      </div>
      ${ios ? `
        <ol class="mt-4 space-y-2 text-sm text-brand-dark">
          <li class="flex items-center gap-3 p-3 rounded-2xl bg-brand-surfaceLight">
            <span class="w-6 h-6 rounded-full bg-brand-accent text-white text-xs font-black flex items-center justify-center shrink-0">1</span>
            <span>Tocá <strong>Compartir</strong>
              <svg class="inline w-4 h-4 -mt-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>
              en la barra de Safari</span>
          </li>
          <li class="flex items-center gap-3 p-3 rounded-2xl bg-brand-surfaceLight">
            <span class="w-6 h-6 rounded-full bg-brand-accent text-white text-xs font-black flex items-center justify-center shrink-0">2</span>
            <span>Elegí <strong>Añadir a pantalla de inicio</strong></span>
          </li>
        </ol>
        <button type="button" data-cerrar-aviso
          class="mt-4 w-full h-12 rounded-2xl bg-brand-accent text-white font-extrabold shadow-btn active:scale-[0.98] transition-all">Entendido</button>
      ` : `
        <div class="mt-5 flex gap-3">
          <button type="button" data-cerrar-aviso
            class="flex-1 h-12 rounded-2xl bg-brand-surfaceLight border border-brand-border font-bold text-brand-textMuted active:scale-[0.98] transition-all">Ahora no</button>
          <button type="button" data-instalar-app
            class="flex-[1.4] h-12 rounded-2xl bg-brand-accent text-white font-extrabold shadow-btn active:scale-[0.98] transition-all">Instalar</button>
        </div>
      `}
    </div>`;

  contenedor.addEventListener('click', async (e) => {
    if (e.target === contenedor || e.target.closest('[data-cerrar-aviso]')) {
      recordarRechazo();
      cerrarAviso();
    } else if (e.target.closest('[data-instalar-app]') && eventoInstalacion) {
      const evento = eventoInstalacion;
      eventoInstalacion = null; // el evento solo se puede usar una vez
      cerrarAviso();
      evento.prompt();
      const { outcome } = await evento.userChoice;
      if (outcome !== 'accepted') recordarRechazo();
    }
  });

  document.body.append(contenedor);
}

function cerrarAviso() {
  avisoPendiente = false;
  document.getElementById('avisoInstalarApp')?.remove();
}
