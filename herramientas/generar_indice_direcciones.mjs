// =========================================================================
// GENERADOR DEL ÍNDICE DE DIRECCIONES DE PICO TRUNCADO
// =========================================================================
// Uso: `npm run indice` (o `node herramientas/generar_indice_direcciones.mjs`) desde la raíz del repo.
// Baja de OpenStreetMap (Overpass) las calles, los números de puerta, los barrios y los lugares con
// nombre de Pico Truncado, y escribe datos/pico_truncado.json, que la app usa para sugerir
// direcciones mientras se escribe (ver scripts/direcciones.js).
//
// `--desde archivo.json` usa una respuesta de Overpass ya guardada en vez de bajarla.
// `--guardar archivo.json` guarda la respuesta cruda para volver a generar sin conexión.
//
// Los datos son de OpenStreetMap (licencia ODbL): el índice lleva la atribución y se publica con la
// misma licencia. Conviene regenerarlo cada algunos meses o cuando alguien cargue calles nuevas en OSM.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = path.join(raiz, 'datos', 'pico_truncado.json');
const CIUDAD = 'Pico Truncado';
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// Tipos de vía que no son calles a las que se lleva un pedido
const VIAS_EXCLUIDAS = new Set(['footway', 'path', 'track', 'raceway', 'cycleway', 'bridleway', 'steps', 'construction', 'proposed', 'abandoned']);

const CONSULTA = `[out:json][timeout:120];
area["name"="${CIUDAD}"]["boundary"="administrative"]->.a;
way(area.a)["highway"]["name"];
out geom;
(
  nwr(area.a)["addr:housenumber"];
  nwr(area.a)["name"]["amenity"];
  nwr(area.a)["name"]["shop"];
  nwr(area.a)["name"]["tourism"];
  nwr(area.a)["name"]["leisure"];
  nwr(area.a)["name"]["office"];
  nwr(area.a)["name"]["healthcare"];
  nwr(area.a)["name"]["craft"];
  nwr(area.a)["name"]["building"];
  node(area.a)["place"]["name"];
);
out tags center;`;

// Cómo se muestra el tipo de cada lugar en las sugerencias
const TIPOS = {
  'amenity=school': 'Escuela', 'amenity=kindergarten': 'Jardín', 'amenity=college': 'Instituto', 'amenity=university': 'Universidad',
  'amenity=hospital': 'Hospital', 'amenity=clinic': 'Clínica', 'amenity=doctors': 'Consultorio', 'amenity=dentist': 'Dentista',
  'amenity=pharmacy': 'Farmacia', 'amenity=police': 'Policía', 'amenity=fire_station': 'Bomberos', 'amenity=fuel': 'Estación de servicio',
  'amenity=bank': 'Banco', 'amenity=atm': 'Cajero', 'amenity=post_office': 'Correo', 'amenity=townhall': 'Municipalidad',
  'amenity=restaurant': 'Restaurante', 'amenity=fast_food': 'Comida rápida', 'amenity=cafe': 'Café', 'amenity=bar': 'Bar',
  'amenity=pub': 'Bar', 'amenity=ice_cream': 'Heladería', 'amenity=nightclub': 'Boliche', 'amenity=cinema': 'Cine',
  'amenity=theatre': 'Teatro', 'amenity=library': 'Biblioteca', 'amenity=place_of_worship': 'Templo', 'amenity=community_centre': 'Centro comunitario',
  'amenity=social_facility': 'Centro social', 'amenity=casino': 'Casino', 'amenity=bus_station': 'Terminal', 'amenity=marketplace': 'Feria',
  'amenity=veterinary': 'Veterinaria', 'amenity=courthouse': 'Juzgado', 'amenity=public_building': 'Edificio público',
  'shop=supermarket': 'Supermercado', 'shop=convenience': 'Almacén', 'shop=bakery': 'Panadería', 'shop=butcher': 'Carnicería',
  'shop=hardware': 'Ferretería', 'shop=clothes': 'Ropa', 'shop=kiosk': 'Kiosco', 'shop=greengrocer': 'Verdulería',
  'leisure=park': 'Plaza', 'leisure=playground': 'Plaza', 'leisure=pitch': 'Cancha', 'leisure=sports_centre': 'Polideportivo',
  'leisure=stadium': 'Estadio', 'leisure=swimming_pool': 'Pileta', 'leisure=fitness_centre': 'Gimnasio',
  'tourism=hotel': 'Hotel', 'tourism=motel': 'Hotel', 'tourism=hostel': 'Hostel', 'tourism=museum': 'Museo',
  'tourism=attraction': 'Atracción', 'tourism=information': 'Información turística', 'office=government': 'Oficina pública'
};
const TIPO_GENERICO = { amenity: 'Lugar', shop: 'Comercio', tourism: 'Turismo', leisure: 'Recreación', office: 'Oficina', healthcare: 'Salud', craft: 'Taller', building: 'Edificio' };

// -------------------------------------------------------------------------
// NOMBRES: misma regla que scripts/direcciones.js (normalizar)
// -------------------------------------------------------------------------
const ABREVIATURAS = {
  av: 'avenida', avda: 'avenida', avd: 'avenida', pje: 'pasaje', psje: 'pasaje', dr: 'doctor', gral: 'general',
  ing: 'ingeniero', rdo: 'reverendo', pte: 'presidente', cnel: 'coronel', tte: 'teniente', o: 'oeste'
};
const PALABRAS_DE_TIPO = new Set(['avenida', 'calle', 'pasaje']);

function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(p => ABREVIATURAS[p] || p);
}

// Clave para juntar las variantes de una misma calle: "Avda. Piedra Buena" = "Piedrabuena", "Mitre (O)" = "Mitre Oeste"
const claveCalle = (nombre) => normalizar(nombre).filter(p => !PALABRAS_DE_TIPO.has(p)).join('');

// "Mitre (O)" se muestra como "Mitre Oeste"; "Avda." como "Avenida"
const nombreVisible = (nombre) => nombre.replace(/\s*\(O\)\s*$/i, ' Oeste').replace(/^Avda?\.\s*/i, 'Avenida ').trim();

// -------------------------------------------------------------------------
// GEOMETRÍA (metros en un plano local: alcanza para un pueblo)
// -------------------------------------------------------------------------
const M_LAT = 110540;
let M_LNG = 111320;
const aPlano = ([lat, lng]) => [lng * M_LNG, lat * M_LAT];
const dePlano = ([x, y]) => [y / M_LAT, x / M_LNG];
const distancia = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const redondear = (n) => Math.round(n * 1e5) / 1e5;

function puntoMasCercanoEnSegmento(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const largo2 = dx * dx + dy * dy;
  const t = largo2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / largo2)) : 0;
  return [a[0] + t * dx, a[1] + t * dy];
}

function distanciaATramos(p, tramos) {
  let mejor = Infinity;
  for (const tramo of tramos) {
    for (let i = 1; i < tramo.length; i++) mejor = Math.min(mejor, distancia(p, puntoMasCercanoEnSegmento(p, tramo[i - 1], tramo[i])));
  }
  return mejor;
}

// -------------------------------------------------------------------------
// DATOS
// -------------------------------------------------------------------------
async function obtenerDatos() {
  const desde = valorArgumento('--desde');
  if (desde) return JSON.parse(fs.readFileSync(desde, 'utf8'));

  console.log('Bajando datos de OpenStreetMap (puede tardar un minuto)...');
  // El servidor público a veces está saturado (502/504/429): se reintenta esperando cada vez el doble
  let datos = null;
  for (let intento = 1, espera = 5; !datos; intento++, espera *= 2) {
    const respuesta = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'TodoDelivery-indice/1.0' },
      body: new URLSearchParams({ data: CONSULTA })
    });
    if (respuesta.ok) {
      datos = await respuesta.json();
    } else if ([429, 502, 503, 504].includes(respuesta.status) && intento < 6) {
      console.log(`  Overpass ocupado (${respuesta.status}), reintento en ${espera} s...`);
      await new Promise(r => setTimeout(r, espera * 1000));
    } else {
      throw new Error(`Overpass respondió ${respuesta.status}: ${(await respuesta.text()).slice(0, 300)}`);
    }
  }

  const guardar = valorArgumento('--guardar');
  if (guardar) fs.writeFileSync(guardar, JSON.stringify(datos));
  return datos;
}

function valorArgumento(nombre) {
  const i = process.argv.indexOf(nombre);
  return i >= 0 ? process.argv[i + 1] : null;
}

const coordsDe = (e) => (e.center ? [e.center.lat, e.center.lon] : [e.lat, e.lon]);

// -------------------------------------------------------------------------
// CALLES: los tramos con la misma clave que se tocan forman una calle
// -------------------------------------------------------------------------
function armarCalles(vias) {
  const porClave = new Map();
  for (const via of vias) {
    const clave = claveCalle(via.tags.name);
    if (!clave) continue;
    if (!porClave.has(clave)) porClave.set(clave, []);
    porClave.get(clave).push(via);
  }

  const calles = [];
  for (const [clave, lista] of porClave) {
    // Grupos de tramos conectados (comparten un nodo o terminan a menos de 60 m)
    const grupos = lista.map(v => ({ vias: [v], nodos: new Set(v.nodes), tramos: [v.geometry.map(g => aPlano([g.lat, g.lon]))] }));
    let unido = true;
    while (unido) {
      unido = false;
      for (let i = 0; i < grupos.length && !unido; i++) {
        for (let j = i + 1; j < grupos.length && !unido; j++) {
          const a = grupos[i], b = grupos[j];
          const compartenNodo = [...b.nodos].some(n => a.nodos.has(n));
          const extremosCerca = b.tramos.some(t => [t[0], t[t.length - 1]].some(p => distanciaATramos(p, a.tramos) < 60));
          if (compartenNodo || extremosCerca) {
            a.vias.push(...b.vias);
            b.nodos.forEach(n => a.nodos.add(n));
            a.tramos.push(...b.tramos);
            grupos.splice(j, 1);
            unido = true;
          }
        }
      }
    }

    for (const g of grupos) {
      // Nombre más usado entre los tramos, preferiendo la forma completa ("Avenida X" antes que "X")
      const cuenta = {};
      g.vias.forEach(v => { const n = nombreVisible(v.tags.name); cuenta[n] = (cuenta[n] || 0) + 1; });
      const nombres = Object.keys(cuenta).sort((x, y) => cuenta[y] - cuenta[x] || y.length - x.length);
      calles.push({ clave, nombre: nombres[0], alias: new Set(nombres.slice(1)), nodos: g.nodos, tramos: g.tramos, numeros: new Map() });
    }
  }
  return calles;
}

// Cada número de puerta va a la calle con su nombre que le queda más cerca (a menos de 150 m)
function asignarNumeros(calles, elementos) {
  let sinCalle = 0;
  for (const e of elementos) {
    const calle = e.tags['addr:street'];
    const numero = parseInt(e.tags['addr:housenumber'], 10);
    if (!calle || !Number.isFinite(numero) || numero <= 0 || /\sy\s/i.test(calle)) continue;

    const clave = claveCalle(calle);
    const p = aPlano(coordsDe(e));
    const candidatas = calles.filter(c => c.clave === clave).map(c => ({ c, d: distanciaATramos(p, c.tramos) })).sort((a, b) => a.d - b.d);
    let destino = candidatas[0]?.d < 150 ? candidatas[0].c : null;
    if (!destino) {
      // Número de una calle que no está dibujada en el mapa: se arma una calle solo con sus números
      destino = calles.find(c => c.clave === clave && c.tramos.length === 0);
      if (!destino) {
        destino = { clave, nombre: nombreVisible(calle), alias: new Set(), nodos: new Set(), tramos: [], numeros: new Map() };
        calles.push(destino);
      }
      sinCalle++;
    }
    if (nombreVisible(calle) !== destino.nombre) destino.alias.add(nombreVisible(calle));
    if (!destino.numeros.has(numero)) destino.numeros.set(numero, p);
  }
  return sinCalle;
}

// Recta número -> posición a lo largo de la calle, para ubicar los números que no están cargados.
// Devuelve null si no hay datos suficientes o si los números no siguen un orden razonable.
function ajustarNumeracion(calle) {
  const puntos = [...calle.numeros].map(([n, p]) => ({ n, p }));
  const todos = [...calle.tramos.flat(), ...puntos.map(x => x.p)];
  if (puntos.length < 3 || new Set(puntos.map(x => Math.round(x.n / 50))).size < 2) return null;

  // Eje principal de la calle (dirección en la que más se extiende)
  const cx = todos.reduce((s, p) => s + p[0], 0) / todos.length;
  const cy = todos.reduce((s, p) => s + p[1], 0) / todos.length;
  let sxx = 0, syy = 0, sxy = 0;
  todos.forEach(([x, y]) => { sxx += (x - cx) ** 2; syy += (y - cy) ** 2; sxy += (x - cx) * (y - cy); });
  const angulo = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let dir = [Math.cos(angulo), Math.sin(angulo)];
  const posicion = (p) => (p[0] - cx) * dir[0] + (p[1] - cy) * dir[1];

  const ajustar = (lista) => {
    const mn = lista.reduce((s, x) => s + x.n, 0) / lista.length;
    const mt = lista.reduce((s, x) => s + posicion(x.p), 0) / lista.length;
    let num = 0, den = 0;
    lista.forEach(x => { num += (x.n - mn) * (posicion(x.p) - mt); den += (x.n - mn) ** 2; });
    const b = den ? num / den : 0;
    return { a: mt - b * mn, b };
  };

  // Ajuste, se descartan los números que quedan lejos de la recta y se vuelve a ajustar
  let { a, b } = ajustar(puntos);
  const errores = puntos.map(x => Math.abs(posicion(x.p) - (a + b * x.n)));
  const tolerancia = Math.max(40, 3 * [...errores].sort((x, y) => x - y)[Math.floor(errores.length / 2)]);
  const buenos = puntos.filter((x, i) => errores[i] <= tolerancia);
  if (buenos.length < 3) return null;
  ({ a, b } = ajustar(buenos));

  // Metros por número: en Argentina son unos 100 números por cuadra (~1 m por número)
  if (Math.abs(b) < 0.25 || Math.abs(b) > 4) return null;
  if (b < 0) { dir = [-dir[0], -dir[1]]; a = -a; b = -b; }

  const posiciones = todos.map(p => (p[0] - cx) * dir[0] + (p[1] - cy) * dir[1]);
  const numeros = buenos.map(x => x.n);
  const origen = dePlano([cx, cy]);
  return {
    origen: [redondear(origen[0]), redondear(origen[1])],
    // Dirección en grados de lat/lng por metro, para no repetir la conversión en el navegador
    dir: [dir[1] / M_LAT, dir[0] / M_LNG].map(v => Number(v.toPrecision(6))),
    a: Math.round(a * 10) / 10,
    b: Math.round(b * 1000) / 1000,
    // Rango en el que se confía en la recta: los números conocidos con un margen de 3 cuadras
    min: Math.max(1, Math.min(...numeros) - 300),
    max: Math.max(...numeros) + 300,
    tMin: Math.round(Math.min(...posiciones) - 80),
    tMax: Math.round(Math.max(...posiciones) + 80)
  };
}

// Punto de la calle más cercano al centro: donde se pone el pin si se busca la calle sin número
function centroDeCalle(calle) {
  const puntos = calle.tramos.length ? calle.tramos.flat() : [...calle.numeros.values()];
  const cx = puntos.reduce((s, p) => s + p[0], 0) / puntos.length;
  const cy = puntos.reduce((s, p) => s + p[1], 0) / puntos.length;
  let mejor = puntos[0], dMejor = Infinity;
  const candidatos = calle.tramos.length
    ? calle.tramos.flatMap(t => t.slice(1).map((p, i) => puntoMasCercanoEnSegmento([cx, cy], t[i], p)))
    : puntos;
  for (const p of candidatos) {
    const d = distancia(p, [cx, cy]);
    if (d < dMejor) { dMejor = d; mejor = p; }
  }
  return dePlano(mejor);
}

// Esquinas: nodos compartidos por dos calles distintas (las repetidas a menos de 40 m cuentan una vez)
function armarEsquinas(calles, nodosPorId) {
  const callesDeNodo = new Map();
  calles.forEach((c, i) => c.nodos.forEach(n => {
    if (!callesDeNodo.has(n)) callesDeNodo.set(n, new Set());
    callesDeNodo.get(n).add(i);
  }));

  const esquinas = [];
  for (const [nodo, indices] of callesDeNodo) {
    const lista = [...indices].sort((a, b) => a - b);
    for (let x = 0; x < lista.length; x++) {
      for (let y = x + 1; y < lista.length; y++) {
        const p = nodosPorId.get(nodo);
        const repetida = esquinas.some(e => e.i === lista[x] && e.j === lista[y] && distancia(aPlano(e.p), aPlano(p)) < 40);
        if (!repetida) esquinas.push({ i: lista[x], j: lista[y], p });
      }
    }
  }
  return esquinas;
}

// Edificios con nombre que no sirven para buscar: solo un número, o "Mi casa"
const NOMBRES_SIN_SENTIDO = /^(\d+|mi casa|mi domicilio)$/i;

// Casas de barrios cargadas con código: "B400 - C12" y "MZA 4 C 12" se buscan como se dicen
function nombreDeLugar(nombre) {
  const limpio = nombre.trim();
  const b400 = limpio.match(/^B400\s*-\s*C\s*0*(\d+)$/i);
  if (b400) return `Casa ${b400[1]} · 400 Viviendas`;
  const manzana = limpio.match(/^MZA\s*(\d+)\s*C\s*0*(\d+)$/i);
  if (manzana) return `Manzana ${manzana[1]} Casa ${manzana[2]}`;
  return limpio;
}

function tipoDeLugar(tags) {
  if (tags.building === 'house' || tags.building === 'residential') return 'Vivienda';
  for (const clave of ['amenity', 'shop', 'healthcare', 'tourism', 'leisure', 'office', 'craft']) {
    if (tags[clave]) return TIPOS[`${clave}=${tags[clave]}`] || TIPO_GENERICO[clave];
  }
  return TIPO_GENERICO.building;
}

// -------------------------------------------------------------------------
// ARMADO DEL ÍNDICE
// -------------------------------------------------------------------------
async function main() {
  const datos = await obtenerDatos();
  const elementos = datos.elements || [];
  const vias = elementos.filter(e => e.type === 'way' && e.tags?.highway && e.tags.name && e.geometry && !VIAS_EXCLUIDAS.has(e.tags.highway));
  const resto = elementos.filter(e => e.tags && !(e.type === 'way' && e.tags.highway && e.geometry));
  if (vias.length === 0) throw new Error('Overpass no devolvió calles: revisar la consulta o el nombre de la ciudad');

  // Escala de longitud para la latitud de la ciudad
  const latMedia = vias.flatMap(v => v.geometry.map(g => g.lat)).reduce((s, l, _, arr) => s + l / arr.length, 0);
  M_LNG = 111320 * Math.cos(latMedia * Math.PI / 180);

  const nodosPorId = new Map();
  vias.forEach(v => v.nodes.forEach((id, i) => nodosPorId.set(id, [v.geometry[i].lat, v.geometry[i].lon])));

  const calles = armarCalles(vias);
  const numerosSinCalleDibujada = asignarNumeros(calles, resto.filter(e => e.tags['addr:housenumber']));
  calles.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const esquinas = armarEsquinas(calles, nodosPorId);

  const barrios = resto
    .filter(e => e.type === 'node' && ['neighbourhood', 'suburb', 'quarter'].includes(e.tags.place))
    .map(e => [e.tags.name, ...coordsDe(e).map(redondear)])
    .sort((a, b) => a[0].localeCompare(b[0], 'es'));

  const lugares = resto
    .filter(e => e.tags.name && !e.tags.place && !e.tags.highway && !NOMBRES_SIN_SENTIDO.test(e.tags.name.trim()))
    .map(e => {
      const direccion = [e.tags['addr:street'] && nombreVisible(e.tags['addr:street']), e.tags['addr:housenumber']].filter(Boolean).join(' ');
      return [nombreDeLugar(e.tags.name), tipoDeLugar(e.tags), ...coordsDe(e).map(redondear), direccion];
    })
    // El mismo lugar cargado como punto y como edificio: queda uno
    .filter((l, i, lista) => lista.findIndex(o => o[0] === l[0] && distancia(aPlano([o[2], o[3]]), aPlano([l[2], l[3]])) < 80) === i)
    .sort((a, b) => a[0].localeCompare(b[0], 'es'));

  let conNumeracion = 0;
  const callesSalida = calles.map(c => {
    const ajuste = ajustarNumeracion(c);
    if (ajuste) conNumeracion++;
    const centro = centroDeCalle(c);
    const salida = {
      n: c.nombre,
      c: centro.map(redondear),
      // Tramos como listas planas [lat, lng, lat, lng, ...]
      t: c.tramos.map(t => t.flatMap(p => dePlano(p).map(redondear))),
      // Números conocidos como lista plana [número, lat, lng, ...], ordenados
      p: [...c.numeros].sort((a, b) => a[0] - b[0]).flatMap(([n, p]) => [n, ...dePlano(p).map(redondear)])
    };
    if (c.alias.size) salida.a = [...c.alias];
    if (ajuste) salida.r = ajuste;
    return salida;
  });

  const indice = {
    version: 1,
    ciudad: CIUDAD,
    generado: new Date().toISOString().slice(0, 10),
    fuente: '© Colaboradores de OpenStreetMap (www.openstreetmap.org), licencia ODbL',
    barrios,
    lugares,
    calles: callesSalida,
    // [índice de calle, índice de calle, lat, lng]
    esquinas: esquinas.map(e => [e.i, e.j, ...e.p.map(redondear)])
  };

  fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
  fs.writeFileSync(SALIDA, JSON.stringify(indice));

  const numeros = calles.reduce((s, c) => s + c.numeros.size, 0);
  console.log(`Listo: ${path.relative(raiz, SALIDA)} (${Math.round(fs.statSync(SALIDA).size / 1024)} KB)`);
  console.log(`  ${calles.length} calles (${conNumeracion} con numeración estimable), ${numeros} números de puerta`);
  console.log(`  ${esquinas.length} esquinas, ${barrios.length} barrios, ${lugares.length} lugares`);
  if (numerosSinCalleDibujada) console.log(`  ${numerosSinCalleDibujada} números de calles que no están dibujadas en el mapa`);
}

main().catch(err => {
  console.error('No se pudo generar el índice:', err.message);
  process.exit(1);
});
