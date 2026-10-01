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
