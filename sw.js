// Service worker mínimo de la app de clientes (lo necesita el navegador para ofrecer "Instalar").
// Red primero: los .js no llevan hash en el nombre y una copia vieja podría no coincidir con el HTML
// nuevo (ver netlify.toml), así que solo se usa la copia guardada cuando no hay conexión.
const CACHE = 'td-clientes-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(nombres => Promise.all(nombres.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Supabase, mapas, CDN y todo lo que no sea de este sitio pasa directo, sin tocarlo
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then(respuesta => {
        if (respuesta.ok) {
          const copia = respuesta.clone();
          caches.open(CACHE).then(cache => cache.put(request, copia));
        }
        return respuesta;
      })
      .catch(async () => {
        const guardada = await caches.match(request);
        if (guardada) return guardada;
        if (request.mode === 'navigate') return (await caches.match('templates/home.html')) || Response.error();
        return Response.error();
      })
  );
});

// ---- Notificaciones push ---------------------------------------------------
// Las manda la Edge Function enviar-push (ver supabase/functions). Con { titulo, texto, url, tag, ocultarSiAbierta }.
// Si la pantalla del aviso ya está visible, no se muestra nada: la app ya lo está mostrando.
// La app de cadetes tiene una copia de esta parte (sw.js en su raíz): cambiarlas juntas.
const ICONO_AVISO = 'images/icons/icon-192.png';

function mismaPantalla(urlVentana, destino) {
  return new URL(urlVentana).pathname === destino.pathname;
}

// Misma pantalla y mismos parámetros (id_pedido, id_cad), sin contar 'chat'
function mismoPedido(urlVentana, destino) {
  const ventana = new URL(urlVentana);
  if (ventana.pathname !== destino.pathname) return false;
  return [...destino.searchParams].every(([clave, valor]) => clave === 'chat' || ventana.searchParams.get(clave) === valor);
}

self.addEventListener('push', (event) => {
  let aviso = {};
  try {
    aviso = event.data ? event.data.json() : {};
  } catch {
    aviso = { texto: event.data ? event.data.text() : '' };
  }

  event.waitUntil((async () => {
    const destino = new URL(aviso.url || '/', self.location.origin);
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visibles = ventanas.filter(v => v.visibilityState === 'visible');
    const yaEnPantalla = aviso.ocultarSiAbierta
      ? visibles.length > 0
      : visibles.some(v => mismaPantalla(v.url, destino));
    if (yaEnPantalla) return;

    await self.registration.showNotification(aviso.titulo || 'Todo Delivery', {
      body: aviso.texto || '',
      tag: aviso.tag || undefined,
      renotify: Boolean(aviso.tag), // con la misma etiqueta reemplaza al anterior, pero vuelve a sonar
      icon: new URL(ICONO_AVISO, self.registration.scope).href,
      data: { url: destino.href }
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = new URL(event.notification.data?.url || self.registration.scope);

  event.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Si esa pantalla ya está abierta con el mismo pedido, se trae al frente; si no, se abre
    const abierta = ventanas.find(v => mismoPedido(v.url, destino));
    if (abierta) return abierta.focus();
    return self.clients.openWindow(destino.href);
  })());
});
