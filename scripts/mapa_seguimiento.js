// =========================================================================
// MAPA DE SEGUIMIENTO DEL CLIENTE (MapLibre, igual al de la app de cadetes)
// =========================================================================
// Mismo estilo oscuro, pines y ruta por calles que ve el cadete (scripts/mapa_td.js), con:
//   * selector 3D / 2D (se recuerda entre visitas; si inclina con dos dedos, el selector acompaña)
//   * botón para seguir al cadete en vivo o volver a ver todo el recorrido
//   * botón "mi ubicación" (pide el GPS del celular solo si el cliente lo toca)
//   * el cadete como "puck" con flecha de rumbo que se desliza suave entre una posición y la siguiente
// Si no hay MapLibre o WebGL devuelve null y la página oculta el mapa.
import { cargarEstiloMapa, crearPin, rutaOSRM, ponerRuta } from './mapa_td.js';

const PREFS = 'td_mapa_prefs_cliente';
const PITCH_VISTA = 50;
const PITCH_SEGUIR = 55;
const ZOOM_SEGUIR = 16.5;
const COLOR_RETIRO = '#00E58F';   // como en cadetes: verde mientras va al local
const COLOR_ENTREGA = '#FFC800';  // amarillo cuando va hacia el cliente
const DURACION_DESLIZ_MS = 1000;

const ICONO_SEGUIR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>';
const ICONO_YO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="currentColor"></circle><circle cx="12" cy="12" r="7.5"></circle><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"></path></svg>';
const ICONO_RECORRIDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"></path></svg>';

const leerPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS)) || {}; } catch { return {}; } };
const coord = (lat, lng) => {
  const la = Number(lat), ln = Number(lng);
  return Number.isFinite(la) && Number.isFinite(ln) && la && ln ? [ln, la] : null; // [lng, lat]
};
const rumboEntre = ([lng1, lat1], [lng2, lat2]) => {
  const r = Math.PI / 180;
  const y = Math.sin((lng2 - lng1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lng2 - lng1) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
};
const metrosEntre = ([lng1, lat1], [lng2, lat2]) => {
  const dx = (lng2 - lng1) * 111320 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  const dy = (lat2 - lat1) * 111320;
  return Math.hypot(dx, dy);
};

/**
 * Arma el mapa dentro de `marco` (un elemento con position: relative).
 * @param {HTMLElement} marco
 * @param {Object} pedido fila de Pedidos (latitud_org, longitud_org, latitud_dest, longitud_dest)
 * @param {{ interactivo?: boolean, controles?: boolean }} [opciones] interactivo=false: mapa quieto (historial)
 * @returns {Promise<null | { moverCadete, setEstado, encuadrar, destruir }>}
 */
export async function crearMapaSeguimiento(marco, pedido, { interactivo = true, controles = true } = {}) {
  const org = coord(pedido.latitud_org, pedido.longitud_org);
  const dest = coord(pedido.latitud_dest, pedido.longitud_dest);
  if (typeof maplibregl === 'undefined' || !marco || !dest) return null;

  const prefs = leerPrefs();
  const cam = { modo: 'vista', inclinado: prefs.inclinado !== false, transicion: 0 };

  const lienzo = document.createElement('div');
  lienzo.className = 'td-mapa absolute inset-0';
  marco.prepend(lienzo);

  let map;
  try {
    map = new maplibregl.Map({
      container: lienzo,
      style: await cargarEstiloMapa(),
      center: dest,
      zoom: 14,
      pitch: cam.inclinado ? PITCH_VISTA : 0,
      maxPitch: 65,
      interactive: interactivo,
      attributionControl: false,
      fadeDuration: 150
    });
  } catch (e) {
    console.warn('[Mapa] No se pudo crear (¿sin WebGL?):', e);
    lienzo.remove();
    return null;
  }
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
  map.once('idle', () => lienzo.querySelector('.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show'));

  // ---------------- Pines y ruta ----------------
  const pinLocal = org && crearPin('local', '🏪', 'Retiro');
  const pinCliente = crearPin('cliente', '🏠', 'Entrega');
  if (pinLocal) new maplibregl.Marker({ element: pinLocal.raiz, anchor: 'bottom' }).setLngLat(org).addTo(map);
  new maplibregl.Marker({ element: pinCliente.raiz, anchor: 'bottom' }).setLngLat(dest).addTo(map);

  let estado = pedido.estado_pedido;
  let rutaCoords = org ? [org, dest] : [];
  const colorRuta = () => (estado === 'en_camino_entrega' ? COLOR_ENTREGA : COLOR_RETIRO);

  const listo = map.loaded() ? Promise.resolve() : new Promise(r => map.once('load', r));
  listo.then(() => {
    ponerRuta(map, rutaCoords, colorRuta());
    encuadrar(false);
  });
  if (org) {
    rutaOSRM({ lng: org[0], lat: org[1] }, { lng: dest[0], lat: dest[1] }).then(async ruta => {
      if (!ruta) return;
      rutaCoords = ruta.coordinates;
      await listo;
      if (map.getStyle()) ponerRuta(map, rutaCoords, colorRuta());
      if (cam.modo === 'vista') encuadrar();
    });
  }

  // ---------------- Cadete (puck animado) ----------------
  let puckMarker = null;
  let puckEl = null;
  const anim = { desde: null, hasta: null, t0: 0, pos: null, rumbo: null, frame: 0 };

  function crearPuck(pos) {
    const raiz = document.createElement('div');
    raiz.innerHTML = `
      <div class="td-puck sin-rumbo">
        <div class="td-puck__halo"></div>
        <div class="td-puck__cono"></div>
        <div class="td-puck__punto"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.5 18.5 19 12 15.2 5.5 19z"/></svg></div>
      </div>`;
    puckEl = raiz.firstElementChild;
    puckMarker = new maplibregl.Marker({ element: raiz, rotationAlignment: 'map', pitchAlignment: 'map' })
      .setLngLat(pos).addTo(map);
    anim.pos = pos;
    actualizarBotones();
  }

  function moverCadete(lat, lng, rumboGps = null) {
    const nueva = coord(lat, lng);
    if (!nueva) return;
    if (!puckMarker) {
      crearPuck(nueva);
      if (cam.modo === 'vista') encuadrar();
      else if (cam.modo === 'seguir') seguir();
      return;
    }
    const actual = anim.pos || nueva;
    const rumbo = Number.isFinite(Number(rumboGps)) && rumboGps !== null && Number(rumboGps) >= 0
      ? Number(rumboGps)
      : (metrosEntre(actual, nueva) > 4 ? rumboEntre(actual, nueva) : anim.rumbo);
    if (rumbo != null) {
      anim.rumbo = rumbo;
      puckMarker.setRotation(rumbo);
      puckEl.classList.remove('sin-rumbo');
    }
    anim.desde = actual;
    anim.hasta = nueva;
    anim.t0 = performance.now();
    if (!anim.frame) anim.frame = requestAnimationFrame(paso);
  }

  function paso(ahora) {
    const t = Math.min(1, (ahora - anim.t0) / DURACION_DESLIZ_MS);
    const s = 1 - Math.pow(1 - t, 3);
    anim.pos = [anim.desde[0] + (anim.hasta[0] - anim.desde[0]) * s, anim.desde[1] + (anim.hasta[1] - anim.desde[1]) * s];
    puckMarker?.setLngLat(anim.pos);
    if (cam.modo === 'seguir' && !cam.transicion) map.jumpTo({ center: anim.pos });
    anim.frame = t < 1 ? requestAnimationFrame(paso) : 0;
  }

  function quitarCadete() {
    cancelAnimationFrame(anim.frame);
    anim.frame = 0;
    puckMarker?.remove();
    puckMarker = null;
    anim.pos = null;
    if (cam.modo === 'seguir') cam.modo = 'vista';
    actualizarBotones();
  }

  // ---------------- Mi ubicación (opcional) ----------------
  let yoMarker = null;
  let yoPos = null;
  let yoWatch = null;

  function alternarMiUbicacion() {
    if (yoWatch !== null) {
      navigator.geolocation.clearWatch(yoWatch);
      yoWatch = null;
      yoMarker?.remove();
      yoMarker = null;
      yoPos = null;
      actualizarBotones();
      if (cam.modo === 'vista') encuadrar();
      return;
    }
    if (!('geolocation' in navigator)) return;
    let primera = true;
    yoWatch = navigator.geolocation.watchPosition(
      (p) => {
        yoPos = [p.coords.longitude, p.coords.latitude];
        if (!yoMarker) {
          const el = document.createElement('div');
          el.className = 'td-yo';
          el.setAttribute('aria-label', 'Tu ubicación');
          yoMarker = new maplibregl.Marker({ element: el }).setLngLat(yoPos).addTo(map);
        } else {
          yoMarker.setLngLat(yoPos);
        }
        if (primera) {
          primera = false;
          cam.modo = 'vista';
          encuadrar();
        }
      },
      (err) => {
        console.warn('[Mapa] Sin ubicación del cliente:', err.message);
        if (yoWatch !== null) navigator.geolocation.clearWatch(yoWatch);
        yoWatch = null;
        actualizarBotones();
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
    actualizarBotones();
  }

  // ---------------- Cámara ----------------
  function nuevaTransicion() {
    const token = ++cam.transicion;
    map.once('moveend', () => { if (cam.transicion === token) cam.transicion = 0; });
  }

  function encuadrar(animado = true) {
    const caja = new maplibregl.LngLatBounds(dest, dest);
    rutaCoords.forEach(c => caja.extend(c));
    if (anim.pos) caja.extend(anim.pos);
    if (yoPos) caja.extend(yoPos);
    map.resize();
    const camara = map.cameraForBounds(caja, { padding: { top: 56, bottom: 36, left: 40, right: controles ? 70 : 40 }, bearing: 0 });
    const pitch = cam.inclinado ? PITCH_VISTA : 0;
    const destino = {
      center: camara?.center ?? caja.getCenter(),
      zoom: Math.min(16, (camara?.zoom ?? 14) - (cam.inclinado ? 0.6 : 0)),
      pitch, bearing: 0
    };
    nuevaTransicion();
    if (animado) map.easeTo({ ...destino, duration: 900, essential: true });
    else map.jumpTo(destino);
  }

  function seguir() {
    if (!anim.pos) return;
    cam.modo = 'seguir';
    nuevaTransicion();
    map.easeTo({ center: anim.pos, zoom: ZOOM_SEGUIR, pitch: cam.inclinado ? PITCH_SEGUIR : 0, bearing: 0, duration: 1000, essential: true });
    actualizarBotones();
  }

  function verRecorrido() {
    cam.modo = 'vista';
    encuadrar();
    actualizarBotones();
  }

  function alternarInclinacion() {
    cam.inclinado = !cam.inclinado;
    try { localStorage.setItem(PREFS, JSON.stringify({ inclinado: cam.inclinado })); } catch { /* sin almacenamiento */ }
    if (cam.modo === 'vista') encuadrar();
    else {
      nuevaTransicion();
      map.easeTo({ pitch: cam.inclinado ? (cam.modo === 'seguir' ? PITCH_SEGUIR : PITCH_VISTA) : 0, duration: 700 });
    }
    actualizarBotones();
  }

  if (interactivo) {
    // Si el cliente mueve el mapa con el dedo, la cámara deja de seguir/encuadrar sola
    ['dragstart', 'rotatestart', 'pitchstart', 'zoomstart'].forEach(ev =>
      map.on(ev, (e) => {
        if (!e.originalEvent || cam.modo === 'libre') return;
        cam.modo = 'libre';
        cam.transicion = 0;
        actualizarBotones();
      })
    );
    map.on('pitchend', (e) => {
      if (!e.originalEvent) return;
      const inclinado = map.getPitch() > 15;
      if (inclinado === cam.inclinado) return;
      cam.inclinado = inclinado;
      try { localStorage.setItem(PREFS, JSON.stringify({ inclinado })); } catch { /* sin almacenamiento */ }
      actualizarBotones();
    });
  }

  // ---------------- Controles ----------------
  const ui = {};
  if (controles && interactivo) {
    const caja = document.createElement('div');
    caja.className = 'td-mapa-controles';
    caja.innerHTML = `
      <button type="button" data-tilt class="td-tilt" title="Vista del mapa: 2D o 3D">
        <i class="td-tilt__marca" aria-hidden="true"></i>
        <span class="td-tilt__op" data-op="3d">3D</span>
        <span class="td-tilt__op" data-op="2d">2D</span>
      </button>
      <button type="button" data-yo class="td-map-btn" title="Mi ubicación" aria-label="Mostrar mi ubicación">${ICONO_YO}</button>
      <button type="button" data-seguir class="td-map-btn" title="Seguir al cadete" aria-label="Seguir al cadete">${ICONO_SEGUIR}</button>`;
    marco.append(caja);
    ui.caja = caja;
    ui.tilt = caja.querySelector('[data-tilt]');
    ui.yo = caja.querySelector('[data-yo]');
    ui.seguir = caja.querySelector('[data-seguir]');
    ui.tilt.addEventListener('click', () => { navigator.vibrate?.(20); alternarInclinacion(); });
    ui.yo.addEventListener('click', () => { navigator.vibrate?.(20); alternarMiUbicacion(); });
    ui.seguir.addEventListener('click', () => {
      navigator.vibrate?.(30);
      if (cam.modo === 'seguir' || !anim.pos) verRecorrido();
      else seguir();
    });
    if (!('geolocation' in navigator)) ui.yo.classList.add('hidden');
  }

  function actualizarBotones() {
    if (!ui.caja) return;
    ui.tilt.classList.toggle('plano', !cam.inclinado);
    ui.tilt.setAttribute('aria-pressed', String(cam.inclinado));
    ui.tilt.setAttribute('aria-label', cam.inclinado ? 'Vista del mapa en 3D. Tocá para 2D' : 'Vista del mapa en 2D. Tocá para 3D');
    ui.yo.classList.toggle('activo', yoWatch !== null);
    ui.yo.setAttribute('aria-pressed', String(yoWatch !== null));
    // Sin cadete en el mapa el botón solo vuelve a encuadrar el recorrido
    const hayCadete = Boolean(anim.pos);
    const siguiendo = cam.modo === 'seguir';
    ui.seguir.innerHTML = hayCadete && !siguiendo ? ICONO_SEGUIR : ICONO_RECORRIDO;
    ui.seguir.classList.toggle('activo', siguiendo);
    const texto = siguiendo ? 'Ver todo el recorrido' : hayCadete ? 'Seguir al cadete' : 'Ver todo el recorrido';
    ui.seguir.title = texto;
    ui.seguir.setAttribute('aria-label', texto);
  }
  actualizarBotones();

  // ---------------- Estado del pedido ----------------
  function setEstado(nuevo) {
    estado = nuevo;
    pinLocal?.pin.classList.toggle('apagado', estado === 'en_camino_entrega' || estado === 'entregado' || estado === 'rendido');
    pinCliente.pin.classList.toggle('apagado', estado === 'asignado');
    marco.style.setProperty('--etapa-rgb', estado === 'en_camino_entrega' ? '255, 200, 0' : '0, 229, 143');
    if (map.getSource('ruta')) ponerRuta(map, rutaCoords, colorRuta());
    if (['entregado', 'rendido', 'cancelado'].includes(estado) && puckMarker) quitarCadete();
  }
  setEstado(estado);

  function destruir() {
    cancelAnimationFrame(anim.frame);
    if (yoWatch !== null) navigator.geolocation.clearWatch(yoWatch);
    yoWatch = null;
    try { map.remove(); } catch { /* ya removido */ }
  }

  return { moverCadete, setEstado, encuadrar: () => { cam.modo = 'vista'; encuadrar(); actualizarBotones(); }, destruir, map };
}
