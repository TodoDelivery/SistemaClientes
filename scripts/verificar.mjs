// =========================================================================
// VERIFICACIÓN ESTÁTICA DE LA APP CLIENTES
// =========================================================================
// Uso: `npm run verificar` (o `node scripts/verificar.mjs`) desde la raíz del repo.
// No necesita dependencias ni conexión.
//
// Detecta lo que rompe la app sin que se note hasta abrirla en el navegador:
//   1. Errores de sintaxis en los .js y en los <script type="module"> de cada página
//   2. Imports a archivos o nombres que no existen, e imports que se escapan del repo
//   3. IDs usados desde JS que no están en el HTML, IDs duplicados y recursos locales faltantes
//   4. Dependencias de CDN sin versión fija
//   5. Nombres del contrato con la app de cadetes (canales, eventos, estados) que desaparecieron
//
// Estructura que espera: index.html y 404.html en la raíz, páginas en templates/, módulos en
// scripts/ y CSS en styles/. Las rutas se resuelven relativas a cada archivo, así que mover un
// archivo de carpeta sin corregir sus enlaces se detecta acá y no en producción.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'verificar-clientes-'));
const errores = [];
const error = (mensaje) => errores.push(mensaje);

// Esta herramienta no es parte de la app: no se revisa a sí misma (usa imports node:*)
const ESTA_HERRAMIENTA = 'scripts/verificar.mjs';

// Claves siempre con '/' para que sean iguales en Windows y en Linux
const aClave = (p) => p.split(path.sep).join('/');

// Archivos de la app: los .html y .js de la raíz, de templates/ y de scripts/
const listar = (dir) => {
  const absoluto = path.join(raiz, dir);
  if (!fs.existsSync(absoluto)) return [];
  return fs.readdirSync(absoluto)
    .filter(f => /\.(html|js)$/.test(f))
    .map(f => aClave(path.join(dir, f)))
    .filter(f => f !== ESTA_HERRAMIENTA);
};
const archivos = [...listar('.'), ...listar('templates'), ...listar('scripts')];

const fuentes = {};   // clave -> código JS ('scripts/x.js' o 'templates/pagina.html#moduloN')
const htmls = {};     // clave -> HTML completo
const carpetaDe = {}; // clave -> carpeta desde la que se resuelven sus rutas relativas

for (const archivo of archivos) {
  const texto = fs.readFileSync(path.join(raiz, archivo), 'utf8');
  const carpeta = path.posix.dirname(archivo);
  if (archivo.endsWith('.js')) {
    fuentes[archivo] = texto;
    carpetaDe[archivo] = carpeta;
  }
  if (archivo.endsWith('.html')) {
    htmls[archivo] = texto;
    carpetaDe[archivo] = carpeta;
    [...texto.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)]
      .forEach((m, i) => {
        const clave = `${archivo}#modulo${i + 1}`;
        fuentes[clave] = m[1];
        carpetaDe[clave] = carpeta;
      });
  }
}

// Resuelve una ruta relativa desde el archivo que la escribe. null si se escapa del repo.
const resolver = (clave, ruta) => {
  const destino = path.posix.normalize(path.posix.join(carpetaDe[clave], ruta));
  return destino.startsWith('..') ? null : destino;
};

// 1. Sintaxis
for (const [nombre, codigo] of Object.entries(fuentes)) {
  const tmp = path.join(temporal, nombre.replace(/[#./]/g, '_') + '.mjs');
  fs.writeFileSync(tmp, codigo);
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
  } catch (e) {
    error(`Sintaxis en ${nombre}:\n${e.stderr.toString().split('\n').slice(1, 5).join('\n')}`);
  }
}

// 2. Imports
const exportsDe = (codigo) => new Set([...codigo.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/g)].map(m => m[1]));
for (const [nombre, codigo] of Object.entries(fuentes)) {
  for (const m of codigo.matchAll(/import\s*(?:\{([^}]*)\}|\w+)?\s*(?:from\s*)?'([^']+)'/g)) {
    const [, nombres, ruta] = m;
    if (/^https?:/.test(ruta)) continue;
    if (!ruta.startsWith('./') && !ruta.startsWith('../')) {
      error(`${nombre} importa '${ruta}': los imports locales tienen que ser relativos ('./x.js' o '../scripts/x.js')`);
      continue;
    }
    const destino = resolver(nombre, ruta);
    if (!destino) {
      error(`${nombre} importa '${ruta}', que se escapa del repo`);
      continue;
    }
    if (!fuentes[destino]) {
      error(`${nombre} importa '${ruta}', que no existe (busqué ${destino})`);
      continue;
    }
    const disponibles = exportsDe(fuentes[destino]);
    for (const n of (nombres || '').split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
      if (!disponibles.has(n)) error(`${nombre} importa '${n}' de ${destino}, que no lo exporta`);
    }
  }
}

// 3. IDs y recursos locales
const idsCreadosPorJs = new Set(
  Object.entries(fuentes)
    .filter(([n]) => !n.includes('#'))
    .flatMap(([, c]) => [...c.matchAll(/id="([\w-]+)"|\.id = '([\w-]+)'/g)].map(m => m[1] || m[2]))
);
for (const [archivo, html] of Object.entries(htmls)) {
  const ids = [...html.matchAll(/\sid="([\w-]+)"/g)].map(m => m[1]);
  const duplicados = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (duplicados.length) error(`${archivo} tiene IDs duplicados: ${duplicados.join(', ')}`);

  for (const m of html.matchAll(/(?:getElementById|\$)\('([\w-]+)'\)/g)) {
    if (!ids.includes(m[1]) && !idsCreadosPorJs.has(m[1])) error(`${archivo} usa #${m[1]}, que no existe`);
  }
  // src/href locales: se resuelven desde la carpeta del HTML que los escribe
  for (const m of html.matchAll(/(?:src|href)="([\w./-]+\.(?:js|css|html))(?:[?#][^"]*)?"/g)) {
    const destino = resolver(archivo, m[1]);
    if (!destino || !fs.existsSync(path.join(raiz, destino))) {
      error(`${archivo} referencia ${m[1]}, que no existe (busqué ${destino ?? 'fuera del repo'})`);
    }
  }
}
// Navegación desde JS: un nombre suelto ('dashboard.html') se resuelve contra la página que lo
// usa, y todas las páginas de la app viven en templates/
for (const [nombre, codigo] of Object.entries(fuentes)) {
  for (const m of codigo.matchAll(/'([\w-]+\.html)'/g)) {
    if (!fs.existsSync(path.join(raiz, 'templates', m[1])) && !fs.existsSync(path.join(raiz, m[1]))) {
      error(`${nombre} navega a ${m[1]}, que no existe`);
    }
  }
}

// 4. Versiones fijas en CDN
const todoElCodigo = [...Object.values(htmls), ...Object.values(fuentes)].join('\n');
const cdnSinVersion = [
  [/esm\.sh\/@supabase\/supabase-js(?!@\d+\.\d+\.\d+)/, 'supabase-js sin versión exacta (usar @X.Y.Z)'],
  [/cdn\.tailwindcss\.com(?!\/\d+\.\d+\.\d+)/, 'Tailwind CDN sin versión exacta (usar cdn.tailwindcss.com/X.Y.Z)'],
  [/unpkg\.com\/leaflet(?!@\d+\.\d+\.\d+)/, 'Leaflet sin versión exacta (usar leaflet@X.Y.Z)']
];
for (const archivo of archivos) {
  const texto = fs.readFileSync(path.join(raiz, archivo), 'utf8');
  for (const [patron, mensaje] of cdnSinVersion) {
    if (patron.test(texto)) error(`${archivo}: ${mensaje}`);
  }
}

// 5. Contrato con la app de cadetes (docs/contrato_app_cadetes.md)
// Si alguno de estos nombres cambia, hay que cambiarlo también en el repo de cadetes.
const CONTRATO = [
  "`pedidos-cadete-${", "`pedido-en-curso-${", "'cadetes-disponibles'", "coords_ts",
  "'nuevo_pedido'", "'pedido_retirado'", "'pedido_rechazado'", "'cambio_estado_pedido'",
  "'ubicacion_cadete'", "'cadete_conectado'", "'mensaje_chat'",
  "'pendiente'", "'libre'", "'en_confirmacion'", "'asignado'", "'en_camino_entrega'", "'entregado'", "'rendido'", "'cancelado'",
  "id_cadete_rechazo", "remitente: 'cliente'",
  "TIMEOUT_OFERTA_MS: 20000"
];
for (const nombre of CONTRATO) {
  if (!todoElCodigo.includes(nombre)) error(`Contrato con cadetes: no se encontró ${nombre} (¿se renombró?)`);
}

fs.rmSync(temporal, { recursive: true, force: true });

const revisados = `${archivos.length} archivos, ${Object.keys(fuentes).length} bloques de JS`;
if (errores.length) {
  console.error(`✖ ${errores.length} problema(s) (${revisados}):\n`);
  errores.forEach(e => console.error(`  - ${e}`));
  process.exit(1);
}
console.log(`✔ Todo OK (${revisados})`);
