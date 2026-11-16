// =========================================================================
// ÍNDICE LOCAL DE DIRECCIONES (datos/pico_truncado.json)
// =========================================================================
// Busca calles con número, esquinas, barrios y lugares sin consultar ningún servicio, así se puede
// sugerir mientras se escribe. El índice lo arma herramientas/generar_indice_direcciones.mjs con
// datos de OpenStreetMap. Este módulo no usa el DOM ni la red: recibe el índice ya cargado.

// Misma normalización que el generador: si se cambia acá, cambiarla también allá y regenerar
const ABREVIATURAS = {
  av: 'avenida', avda: 'avenida', avd: 'avenida', pje: 'pasaje', psje: 'pasaje', dr: 'doctor', gral: 'general',
  ing: 'ingeniero', rdo: 'reverendo', pte: 'presidente', cnel: 'coronel', tte: 'teniente', o: 'oeste'
};
const PALABRAS_DE_TIPO = new Set(['avenida', 'calle', 'pasaje']);
// Palabras que no ayudan a distinguir: no se exige que estén en el nombre
const PALABRAS_VACIAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'al', 'barrio', 'b', 'bo', 'n', 'nro', 'numero', 'altura']);
// "Mitre y Sarmiento", "Mitre esq. Sarmiento", "Mitre / Sarmiento", "Mitre & Sarmiento"
const SEPARADOR_ESQUINA = /\s+(?:y|esq\.?|esquina)\s+|\s*[&/]\s*/i;

const RADIO_BARRIO_M = 600;      // hasta dónde se toma el barrio más cercano como zona
const MARGEN_NUMERO_CERCANO = 30; // sin numeración estimable: se usa un número conocido si está así de cerca

export function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(p => ABREVIATURAS[p] || p);
}

const significativas = (tokens) => tokens.filter(t => !PALABRAS_VACIAS.has(t) && !PALABRAS_DE_TIPO.has(t));

function prepararNombre(nombre) {
  const tokens = normalizar(nombre);
  return { tokens, cantidad: significativas(tokens).length, compacto: significativas(tokens).join('') };
}

/**
 * Qué tan bien coincide la búsqueda con un nombre (0 = no coincide).
 * Cada palabra buscada tiene que ser una palabra del nombre o su comienzo ("sarm" -> "Sarmiento").
 * Los números tienen que coincidir enteros ("1" no encuentra "Casa 12").
 */
function puntaje(consulta, nombre) {
  if (!consulta.tokens.length) return 0;
  let completas = 0;
  let coincide = true;
  for (const q of consulta.tokens) {
    const esNumero = /^\d+$/.test(q);
    let mejor = 0;
    for (const t of nombre.tokens) {
      if (t === q) { mejor = 2; break; }
      if (!esNumero && t.startsWith(q)) mejor = 1;
    }
    if (!mejor) { coincide = false; break; }
    if (mejor === 2) completas++;
  }

  if (!coincide) {
    // Escrito junto o separado distinto: "piedra buena" = "Piedrabuena"
    return consulta.compacto.length >= 4 && nombre.compacto.includes(consulta.compacto) ? 40 : 0;
  }
  let p = 50 + 30 * completas / consulta.tokens.length;
  if (completas === consulta.tokens.length && consulta.tokens.length >= nombre.cantidad) p += 20; // el nombre exacto
  return p - Math.min(10, nombre.tokens.length);
}

function consultaDe(tokens) {
  const utiles = significativas(tokens);
  return { tokens: utiles, compacto: utiles.join('') };
}

/** Crea el buscador a partir del índice (el JSON ya parseado). */
export function crearBuscador(indice) {
  const ciudad = indice.ciudad;
  const latRef = indice.calles[0]?.c?.[0] ?? indice.barrios[0]?.[1] ?? 0;
  const M_LAT = 110540;
  const M_LNG = 111320 * Math.cos(latRef * Math.PI / 180);
  const aPlano = (lat, lng) => [lng * M_LNG, lat * M_LAT];
  const distancia = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  const calles = indice.calles.map((c, i) => ({
    i,
    nombre: c.n,
    nombres: [c.n, ...(c.a || [])].map(prepararNombre),
    centro: c.c,
    tramos: c.t.map(t => {
      const puntos = [];
      for (let k = 0; k < t.length; k += 2) puntos.push(aPlano(t[k], t[k + 1]));
      return puntos;
    }),
    numeros: c.p,
    recta: c.r || null
  }));
  const barrios = indice.barrios.map(([nombre, lat, lng]) => ({ nombre, lat, lng, nombreBuscable: prepararNombre(nombre), plano: aPlano(lat, lng) }));
  const lugares = indice.lugares.map(([nombre, tipo, lat, lng, direccion]) => ({
    nombre, tipo, lat, lng, direccion,
    nombreBuscable: prepararNombre(nombre),
    tipoBuscable: prepararNombre(tipo)
  }));
  const esquinas = indice.esquinas;

  function zonaDe(lat, lng, extra = '') {
    const p = aPlano(lat, lng);
    let barrio = null, dMejor = RADIO_BARRIO_M;
    for (const b of barrios) {
      const d = distancia(p, b.plano);
      if (d < dMejor) { dMejor = d; barrio = b.nombre; }
    }
    return [extra, barrio, ciudad].filter(Boolean).join(', ');
  }

  // Punto de la calle más cercano a p (en el plano local); p mismo si la calle no está dibujada
  function pegarACalle(calle, p) {
    let mejor = p, dMejor = Infinity;
    for (const tramo of calle.tramos) {
      for (let k = 1; k < tramo.length; k++) {
        const a = tramo[k - 1], b = tramo[k];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const largo2 = dx * dx + dy * dy;
        const t = largo2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / largo2)) : 0;
        const q = [a[0] + t * dx, a[1] + t * dy];
        const d = distancia(p, q);
        if (d < dMejor) { dMejor = d; mejor = q; }
      }
    }
    return { lat: mejor[1] / M_LAT, lng: mejor[0] / M_LNG };
  }

  // Dónde queda un número en una calle: exacto si está cargado, estimado con la numeración de la
  // calle si se puede, o el centro de la calle si no hay forma de saberlo
  function ubicarNumero(calle, numero) {
    const lista = calle.numeros;
    let cercano = null;
    for (let k = 0; k < lista.length; k += 3) {
      if (lista[k] === numero) return { lat: lista[k + 1], lng: lista[k + 2], precision: 'exacta' };
      const diferencia = Math.abs(lista[k] - numero);
      if (!cercano || diferencia < cercano.diferencia) cercano = { diferencia, lat: lista[k + 1], lng: lista[k + 2] };
    }

    const r = calle.recta;
    if (r && numero >= r.min && numero <= r.max) {
      const t = r.a + r.b * numero;
      if (t >= r.tMin && t <= r.tMax) {
        const lat = r.origen[0] + r.dir[0] * t;
        const lng = r.origen[1] + r.dir[1] * t;
        return { ...pegarACalle(calle, aPlano(lat, lng)), precision: 'aproximada' };
      }
    }
    if (cercano && cercano.diferencia <= MARGEN_NUMERO_CERCANO) return { lat: cercano.lat, lng: cercano.lng, precision: 'aproximada' };
    return { lat: calle.centro[0], lng: calle.centro[1], precision: 'calle' };
  }

  const puntajeCalle = (consulta, calle) => Math.max(...calle.nombres.map(n => puntaje(consulta, n)));

  function callesQueCoinciden(consulta) {
    if (!consulta.tokens.length) return [];
    return calles.map(c => ({ c, p: puntajeCalle(consulta, c) })).filter(x => x.p > 0);
  }

  function buscarEsquina(textoA, textoB) {
    const callesA = callesQueCoinciden(consultaDe(normalizar(textoA)));
    const callesB = callesQueCoinciden(consultaDe(normalizar(textoB)));
    if (!callesA.length || !callesB.length) return [];
    const puntajeA = new Map(callesA.map(x => [x.c.i, x.p]));
    const puntajeB = new Map(callesB.map(x => [x.c.i, x.p]));

    const resultados = [];
    for (const [i, j, lat, lng] of esquinas) {
      const directo = puntajeA.has(i) && puntajeB.has(j) ? puntajeA.get(i) + puntajeB.get(j) : 0;
      const cruzado = puntajeA.has(j) && puntajeB.has(i) ? puntajeA.get(j) + puntajeB.get(i) : 0;
      if (!directo && !cruzado) continue;
      const [primera, segunda] = directo >= cruzado ? [i, j] : [j, i];
      resultados.push({
        puntaje: Math.max(directo, cruzado) / 2,
        lat, lng,
        precision: 'exacta',
        detalle: 'Esquina',
        direccion: { titulo: `${calles[primera].nombre} y ${calles[segunda].nombre}`, zona: zonaDe(lat, lng) }
      });
    }
    return resultados;
  }

  function buscarNombres(consulta) {
    const resultados = [];
    if (!consulta.tokens.length) return resultados;

    for (const { c, p } of callesQueCoinciden(consulta)) {
      const [lat, lng] = c.centro;
      resultados.push({ puntaje: p, lat, lng, precision: 'calle', detalle: 'Calle', direccion: { titulo: c.nombre, zona: zonaDe(lat, lng) } });
    }
    for (const b of barrios) {
      const p = puntaje(consulta, b.nombreBuscable);
      if (p) resultados.push({ puntaje: p, lat: b.lat, lng: b.lng, precision: 'aproximada', detalle: 'Barrio', direccion: { titulo: `Barrio ${b.nombre}`, zona: ciudad } });
    }
    for (const l of lugares) {
      // Por el nombre o por el tipo ("farmacia" encuentra todas las farmacias), el nombre primero
      const p = puntaje(consulta, l.nombreBuscable) || puntaje(consulta, l.tipoBuscable) * 0.8;
      if (p) resultados.push({ puntaje: p, lat: l.lat, lng: l.lng, precision: 'exacta', detalle: l.tipo, direccion: { titulo: l.nombre, zona: zonaDe(l.lat, l.lng, l.direccion) } });
    }
    return resultados;
  }

  function buscarCalleConNumero(consulta, numero) {
    const resultados = callesQueCoinciden(consulta).map(({ c, p }) => {
      const punto = ubicarNumero(c, numero);
      const detalle = { exacta: '', aproximada: 'Altura aproximada', calle: 'Sin numeración en el mapa: marcá el punto' }[punto.precision];
      return {
        // Con número, la calle va antes que un lugar que se llame parecido
        puntaje: p + 15 - (punto.precision === 'calle' ? 10 : 0),
        lat: punto.lat, lng: punto.lng,
        precision: punto.precision,
        detalle,
        direccion: { titulo: `${c.nombre} ${numero}`, zona: zonaDe(punto.lat, punto.lng) }
      };
    });

    // Si alguna calle ubica el número, las que solo pueden poner el pin en el medio de la calle sobran.
    // Si ninguna puede, queda una por nombre (una calle cortada en partes aparece varias veces).
    if (resultados.some(r => r.precision !== 'calle')) return resultados.filter(r => r.precision !== 'calle');
    return resultados.filter((r, i) => resultados.findIndex(o => o.direccion.titulo === r.direccion.titulo) === i);
  }

  /**
   * Sugerencias para lo que se escribió: "mitre 450", "san martin y mitre", "huemul", "hospital".
   * @returns {Array<{ lat, lng, direccion: { titulo, zona }, precision: 'exacta'|'aproximada'|'calle', detalle, fuente: 'indice' }>}
   */
  function buscar(texto, limite = 6) {
    const limpio = String(texto || '').trim();
    if (limpio.length < 2) return [];

    let resultados = [];
    const partes = limpio.split(SEPARADOR_ESQUINA);
    if (partes.length === 2 && partes.every(p => p.trim())) resultados = buscarEsquina(partes[0], partes[1]);

    // Si no es una esquina conocida (o "y" era parte del nombre), se busca el texto entero
    if (!resultados.length) {
      const tokens = normalizar(limpio);
      resultados = buscarNombres(consultaDe(tokens));
      const ultimo = tokens[tokens.length - 1];
      if (tokens.length >= 2 && /^\d{1,5}$/.test(ultimo)) {
        resultados.push(...buscarCalleConNumero(consultaDe(tokens.slice(0, -1)), Number(ultimo)));
      }
    }

    resultados.sort((a, b) => b.puntaje - a.puntaje);
    const vistos = new Set();
    return resultados
      .filter(r => {
        const clave = `${r.direccion.titulo}|${r.lat.toFixed(3)},${r.lng.toFixed(3)}`;
        if (vistos.has(clave)) return false;
        vistos.add(clave);
        return true;
      })
      .slice(0, limite)
      .map(({ puntaje: _, ...r }) => ({ ...r, fuente: 'indice' }));
  }

  return { buscar };
}
