// =========================================================================
// DIRECCIONES: BÚSQUEDA Y DIRECCIÓN DE UN PUNTO (Nominatim / OpenStreetMap)
// =========================================================================
// Política de uso del servicio público de Nominatim: máximo 1 consulta por segundo y sin autocompletar.
// Por eso las búsquedas son con botón (no mientras se escribe) y las consultas se encolan.

// Centro inicial de los mapas (San Juan, Argentina)
export const CENTRO_MAPA = { lat: -31.5375, lng: -68.5364 };

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const cache = new Map(); // "lat,lng" (5 decimales) -> { titulo, zona } | null
let proximaConsulta = 0;

async function consultarNominatim(ruta, params) {
  const ahora = Date.now();
  const turno = Math.max(ahora, proximaConsulta);
  proximaConsulta = turno + 1100;
  if (turno > ahora) await new Promise(r => setTimeout(r, turno - ahora));

  const query = new URLSearchParams({ format: 'jsonv2', 'accept-language': 'es', ...params });
  const respuesta = await fetch(`${NOMINATIM_URL}/${ruta}?${query}`, { headers: { Accept: 'application/json' } });
  if (!respuesta.ok) throw new Error(`Nominatim respondió ${respuesta.status}`);
  return respuesta.json();
}

export function claveCoords({ lat, lng }) {
  return `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
}

/** { titulo: "Av. Libertador 123", zona: "Centro, San Juan" } a partir de una respuesta de Nominatim */
export function resumirDireccion(r) {
  const a = r?.address || {};
  const calle = [a.road || a.pedestrian || a.footway || a.path, a.house_number].filter(Boolean).join(' ');
  const nombreLugar = r?.name && r.name !== a.road ? r.name : '';
  const titulo = nombreLugar || calle || (r?.display_name || '').split(',')[0].trim();
  const zona = [nombreLugar ? calle : '', a.suburb || a.neighbourhood || a.city_district, a.city || a.town || a.village]
    .filter(Boolean)
    .filter((valor, i, lista) => lista.indexOf(valor) === i)
    .join(', ');
  return titulo ? { titulo, zona } : null;
}

/** Dirección ya conocida de esas coordenadas: objeto, null (no tiene) o undefined (nunca se consultó) */
export function direccionEnCache(coords) {
  return cache.get(claveCoords(coords));
}

export function recordarDireccion(coords, direccion) {
  cache.set(claveCoords(coords), direccion);
}

/** Dirección de un punto del mapa, o null si no se encuentra. Lanza si falla la red. */
export async function direccionDeCoords(coords) {
  const clave = claveCoords(coords);
  if (cache.has(clave)) return cache.get(clave);

  const r = await consultarNominatim('reverse', { lat: coords.lat, lon: coords.lng, zoom: 18, addressdetails: 1 });
  const direccion = r && !r.error ? resumirDireccion(r) : null;
  cache.set(clave, direccion);
  return direccion;
}

/**
 * Busca direcciones en Argentina. `limites` (L.LatLngBounds opcional) prioriza lo cercano a lo que se ve.
 * @returns {Promise<Array<{ lat, lng, direccion: { titulo, zona } }>>}
 */
export async function buscarDirecciones(texto, limites = null) {
  const params = { q: texto, countrycodes: 'ar', limit: 5, addressdetails: 1 };
  if (limites) {
    params.viewbox = [limites.getWest(), limites.getNorth(), limites.getEast(), limites.getSouth()].map(n => n.toFixed(4)).join(',');
  }

  const resultados = await consultarNominatim('search', params);
  return (resultados || [])
    .map(r => ({ lat: Number(r.lat), lng: Number(r.lon), direccion: resumirDireccion(r) }))
    .filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng) && r.direccion)
    .map(r => {
      recordarDireccion(r, r.direccion);
      return r;
    });
}

/** Distancia aproximada en metros (suficiente para comparar puntos cercanos) */
export function distanciaMetros(a, b) {
  const dx = (b.lng - a.lng) * 111320 * Math.cos(a.lat * Math.PI / 180);
  const dy = (b.lat - a.lat) * 110540;
  return Math.sqrt(dx * dx + dy * dy);
}
