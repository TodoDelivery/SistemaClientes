// =========================================================================
// BARRA SUPERIOR + BARRA INFERIOR (se pintan al instante, antes de cargar los módulos)
// =========================================================================
// Script clásico y sin dependencias: corre apenas el HTML llega al navegador, así el header y el footer
// ya están en pantalla mientras la pantalla de carga (#cargandoPagina, que va por debajo de ellos) espera
// a la sesión y a los datos. montarLayoutCliente() (ui_cliente.js) reutiliza lo que se pintó acá.
//
// Cada página indica su pestaña y título en el <body>: data-pestana="home" data-titulo="Inicio".
// Para sumar una pestaña a la barra inferior: agregarla a PESTANAS (y su ícono a ICONOS).
(function () {
  const BASE = document.currentScript ? new URL('.', document.currentScript.src).href : '';
  const LOGO_TD = new URL('../images/Logo_svg.svg', BASE).href;

  const ICONOS = {
    casa: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    pedir: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    seguimiento: '<path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    historial: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>'
  };

  const svg = (nombre) =>
    `<svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[nombre] || ''}</svg>`;

  // Pedir va al medio. Perfil usa la foto del cliente en lugar de un ícono (icono: null)
  const PESTANAS = [
    { id: 'home', href: 'home.html', texto: 'Home', icono: 'casa' },
    { id: 'seguimiento', href: 'pedido_activo.html', texto: 'Seguimiento', icono: 'seguimiento' },
    { id: 'solicitar', href: 'crear_pedido.html', texto: 'Pedir', icono: 'pedir' },
    { id: 'historial', href: 'dashboard.html', texto: 'Mis pedidos', icono: 'historial' },
    { id: 'perfil', href: 'configuracion.html', texto: 'Perfil', icono: null }
  ];

  function pintar(pestanaActiva, titulo) {
    const appBar = document.getElementById('appBar');
    const barra = document.getElementById('barraInferior');
    if (!appBar || !barra) return;

    // Encabezado flotante: logo + título y acciones son píldoras sueltas, con un degradado de sombra detrás
    appBar.className = 'sticky top-0 z-[1100] pt-safe pointer-events-none';
    appBar.innerHTML = `
      <div class="absolute inset-x-0 top-0 -bottom-5 pointer-events-none" aria-hidden="true"
        style="background: linear-gradient(to bottom, rgba(15,23,42,0.16) 0%, rgba(213,220,229,0.92) 45%, rgba(213,220,229,0) 100%)"></div>
      <div class="relative mx-auto max-w-xl px-4 pt-2 pb-2 flex items-center gap-2">
        <div class="pointer-events-auto relative flex-1 min-w-0 h-12 px-14 rounded-full bg-brand-surface border border-brand-border shadow-[0_6px_20px_rgba(15,23,42,0.18)] flex items-center justify-center">
          <img src="${LOGO_TD}" alt="TD" class="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-8 object-contain" />
          <h1 id="tituloPagina" class="min-w-0 w-full text-lg font-extrabold tracking-tight truncate text-center text-brand-dark"></h1>
        </div>
        <div id="accionesAppBar" class="pointer-events-auto empty:hidden h-12 px-1 rounded-full bg-brand-surface border border-brand-border shadow-[0_6px_20px_rgba(15,23,42,0.18)] flex items-center gap-1"></div>
      </div>
    `;
    document.getElementById('tituloPagina').textContent = titulo || '';

    // Barra flotante: la pestaña activa sube y queda dentro de un círculo destacado.
    // Detrás lleva un degradado que la separa del contenido que pasa por debajo.
    barra.className = 'fixed inset-x-0 bottom-0 z-[1100] px-4 pointer-events-none';
    barra.style.paddingBottom = 'calc(env(safe-area-inset-bottom) + var(--margen-nav))';
    barra.setAttribute('aria-label', 'Navegación principal');
    barra.innerHTML = `
      <div class="absolute inset-x-0 bottom-0 -top-10 pointer-events-none" aria-hidden="true"
        style="background: linear-gradient(to top, rgba(15,23,42,0.22) 0%, rgba(213,220,229,0.92) 45%, rgba(213,220,229,0) 100%)"></div>
      <div class="relative mx-auto max-w-md grid grid-cols-5 grid-rows-1 rounded-full bg-brand-surface border border-brand-border shadow-[0_10px_30px_rgba(15,23,42,0.28)] pointer-events-auto" style="height: var(--alto-nav)">
        ${PESTANAS.map(p => {
          const activa = p.id === pestanaActiva;
          const pulso = p.id === 'seguimiento'
            ? `<span id="tabTrackingPulse" class="hidden absolute -top-0.5 -right-1 w-2.5 h-2.5 rounded-full bg-brand-accent ring-2 ring-brand-surface">
                 <span class="absolute inset-0 rounded-full bg-brand-accent animate-ping"></span>
                 <span class="sr-only">(pedido en curso)</span>
               </span>`
            : '';
          // El círculo activo va en posición absoluta: sube sin agrandar la fila ni sacar el texto de la barra
          return `
            <a href="${p.href}" ${activa ? 'aria-current="page"' : ''}
              class="relative h-full min-w-0 flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold leading-tight transition-colors ${activa ? 'text-brand-accent' : 'text-brand-textMuted hover:text-brand-dark'}">
              <span class="relative w-8 h-8 flex items-center justify-center">
                <span class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full transition-all duration-300 ease-out ${activa ? 'w-14 h-14 -mt-6 bg-brand-accent text-white ring-4 ring-brand-surface shadow-lg shadow-brand-accent/40' : 'w-8 h-8'}">
                  ${p.icono ? svg(p.icono) : `<span id="avatarCuenta" class="w-full h-full rounded-full overflow-hidden bg-brand-surfaceLight text-[11px] font-extrabold text-brand-accent flex items-center justify-center border-2 ${activa ? 'border-brand-surface' : 'border-brand-border'}"></span>`}
                </span>
                ${pulso}
              </span>
              <span class="truncate max-w-full">${p.texto}</span>
            </a>`;
        }).join('')}
      </div>
    `;
    appBar.dataset.pintado = '1';
  }

  window.TDLayout = { pintar };

  const { pestana, titulo } = document.body.dataset;
  if (pestana) pintar(pestana, titulo);
})();
