# Todo Delivery · App de clientes

App web (mobile first) con la que los clientes piden un cadete, cotizan el envío, siguen el pedido en vivo y chatean con el cadete.

Es un **sitio estático sin build**: HTML + módulos JS del navegador. Supabase (Auth, base de datos y Realtime), Leaflet y supabase-js se cargan por CDN con **versión fija**. Tailwind está **compilado** en `styles/tailwind.css` (se genera con `npm run css` y se commitea).

Comparte el proyecto de Supabase con la **app de cadetes**, que vive en otro repo. Las dos apps se coordinan a través de la tabla `Pedidos` y de canales Realtime. Ese acuerdo es el [contrato con la app de cadetes](#contrato-con-la-app-de-cadetes) y **no se puede cambiar de un solo lado**.

---

## Índice

1. [Estructura](#estructura)
2. [Correr en local](#correr-en-local)
3. [Configurar Supabase](#configurar-supabase)
4. [Publicar (Netlify)](#publicar-netlify)
5. [Contrato con la app de cadetes](#contrato-con-la-app-de-cadetes)
6. [Cómo no romperla](#cómo-no-romperla)
7. [Actualizar dependencias](#actualizar-dependencias)
8. [Decisiones y limitaciones conocidas](#decisiones-y-limitaciones-conocidas)

---

## Estructura

Las páginas viven en `templates/`, los módulos en `scripts/` y el CSS en `styles/`. `index.html` y `404.html` quedan en la raíz: son la entrada del sitio y la página de error que Netlify toma de la raíz publicada.

Cada enlace es relativo **al archivo que lo escribe**: desde una página, un módulo es `../scripts/archivo.js`, el CSS es `../styles/estilos_cliente.css` y otra página es `pagina.html` (todas son hermanas dentro de `templates/`). Si se mueve un archivo de carpeta hay que corregir cada import y cada enlace: `npm run verificar` lo detecta antes de que llegue al navegador.

```
├── index.html              Entrada: redirige a templates/home.html
├── 404.html                Página de error (Netlify la busca en la raíz publicada)
│
├── templates/
│   ├── login_google.html   Login con Google y alta del cliente (pide teléfono la primera vez)
│   ├── home.html           "Home": resumen mensual, gráficos y estadísticas del cliente
│   ├── dashboard.html      "Mis pedidos": pedidos en curso + historial
│   ├── crear_pedido.html   "Pedir": mapa, direcciones, favoritas, cotización y alta del pedido
│   ├── pedido_activo.html  "Seguimiento": estado, cadete, GPS, chat. CORRE EL MOTOR DE ASIGNACIÓN
│   └── configuracion.html  "Perfil": datos, teléfono, ubicaciones favoritas, cerrar sesión
│
├── scripts/
│   ├── conexion_supabase.js  Cliente de Supabase (URL + clave pública)
│   ├── busqueda_pedido.js    Búsqueda de cadete: estados, texto del panel y cancelar (la asignación la hace el servidor)
│   ├── sesion_cliente.js     Sesión, datos del cliente, favoritas, consultas comunes
│   ├── chat_pedido.js        Historial del chat: mensajes en vivo + guardado en Pedidos.Chat_pedido
│   ├── ui_cliente.js         Barra superior e inferior, toasts, hojas modales, formatos, íconos
│   ├── direcciones.js        Búsqueda de direcciones (índice local + Nominatim) y dirección de un punto
│   ├── indice_direcciones.js Buscador sobre el índice local de Pico Truncado (sin DOM ni red)
│   ├── (el tema de Tailwind está en tailwind/cliente.config.cjs)
│   └── verificar.mjs         Verificación estática (ver "Cómo no romperla"). No se publica
│
├── styles/
│   └── estilos_cliente.css   Estilos compartidos (zonas seguras, Leaflet oscuro, animaciones)
│
├── datos/
│   └── pico_truncado.json    Índice de calles, números, esquinas, barrios y lugares (generado, no editar)
├── herramientas/
│   └── generar_indice_direcciones.mjs   Arma datos/pico_truncado.json desde OpenStreetMap. No se publica
│
├── docs/contrato_app_cadetes.md   Especificación completa: datos, estados, motor, canales
├── docs/asignacion_por_cercania.md   Cómo se elige al cadete (cercanía + 3 rechazos) y cómo verificarlo
├── netlify.toml
└── package.json            Solo scripts de desarrollo (no hay dependencias)
```

Qué importa cada página:

| Página | Usa |
|---|---|
| todas menos login | `sesion_cliente.js` + `ui_cliente.js` |
| `crear_pedido.html` | + `busqueda_pedido.js` (cancelar pedidos viejos) + `direcciones.js` |
| `pedido_activo.html` | + `busqueda_pedido.js` (texto de la búsqueda, cancelar) + `chat_pedido.js` |
| `configuracion.html` | + `direcciones.js` |

---

## Correr en local

Requisito: Node 18 o superior (solo para el servidor local y la verificación).

```bash
npm run dev          # http://localhost:5173
npm run verificar    # chequeo estático, tarda segundos
npm run indice       # regenera datos/pico_truncado.json desde OpenStreetMap (necesita internet)
```

Sirve cualquier servidor estático, por ejemplo Live Server de VS Code. **No abrir los HTML con doble clic** (`file://`): los módulos no cargan. GPS, Web Locks y el portapapeles requieren HTTPS o `localhost`.

Para probar la tarifa nocturna de día: `templates/crear_pedido.html?simular_nocturno=1`.

---

## Configurar Supabase

Los datos de conexión están en [`scripts/conexion_supabase.js`](scripts/conexion_supabase.js). La clave es la **publishable/anon**, pensada para el navegador. La seguridad la dan las políticas RLS, no esconder la clave. **Nunca** poner ahí la `service_role`.

### 1. Autenticación con Google

- *Authentication → Providers → Google*: habilitado.
- *Authentication → URL Configuration → Redirect URLs*: agregar **cada** dominio donde corra la app, apuntando a `templates/login_google.html`:
  - `http://localhost:5173/templates/login_google.html`
  - `https://<tu-sitio>.netlify.app/templates/login_google.html`
  - el dominio propio, si se usa uno

  Si falta la URL, Google no vuelve a la app después del login.

### 2. Tablas y columnas que usa la app

| Tabla | Lee | Escribe |
|---|---|---|
| `Clientes` | `id_cliente, nombre_cliente, telefono_cliente, f_loggueo_cliente, ubicaciones_favs` | INSERT de su fila; UPDATE de `nombre_cliente`, `telefono_cliente`, `ubicaciones_favs` |
| `Pedidos` | `*` de sus pedidos | INSERT; UPDATE de `Chat_pedido`. `estado_pedido` e `id_cadete` los mueve el servidor (cancelar: función `cancelar_pedido_cliente`) |
| `Cadetes` | `id_cad, nombre_cad, alias_cad, estado_cad, telef_cad, vehiculo_cad, patente` | — |
| `Datos_cotiz` | `bajada_band, tarifa_km, porc_tarif_dinamica` (primera fila; la columna `Porc_Comision` es de cadetes y admin) | — |

`ubicaciones_favs` es `jsonb` con este formato (máximo 10):

```json
[{ "id": "uuid", "tipo": "casa|trabajo|otro", "nombre": "Casa", "direccion": "Av. Libertador 1250", "zona": "Centro, San Juan", "lat": -31.53, "lng": -68.54 }]
```

La foto de perfil **no está en `Clientes`**: sale de `user_metadata.avatar_url` de Supabase Auth, que la carga desde la cuenta de Google.

### 3. Políticas RLS necesarias

Si falta un permiso de UPDATE, Supabase **no devuelve error**: simplemente no actualiza filas. La app lo detecta y muestra "No pudimos guardar"; en la consola aparece *revisar la política RLS de UPDATE*.

Referencia. Revisar primero cuáles ya existen, porque la app de cadetes también tiene las suyas sobre `Pedidos` y `Cadetes`:

```sql
-- Clientes: cada cliente ve, crea y edita solo su fila
create policy "clientes_select_propia" on public."Clientes" for select to authenticated using (id_cliente = auth.uid());
create policy "clientes_insert_propia" on public."Clientes" for insert to authenticated with check (id_cliente = auth.uid());
create policy "clientes_update_propia" on public."Clientes" for update to authenticated using (id_cliente = auth.uid()) with check (id_cliente = auth.uid());

-- Pedidos: cada cliente ve, crea y actualiza solo sus pedidos
create policy "pedidos_select_cliente" on public."Pedidos" for select to authenticated using (id_cliente = auth.uid());
create policy "pedidos_insert_cliente" on public."Pedidos" for insert to authenticated with check (id_cliente = auth.uid());
create policy "pedidos_update_cliente" on public."Pedidos" for update to authenticated using (id_cliente = auth.uid()) with check (id_cliente = auth.uid());

-- Lectura para clientes logueados
create policy "datos_cotiz_select" on public."Datos_cotiz" for select to authenticated using (true);
create policy "cadetes_select" on public."Cadetes" for select to authenticated using (true);
```

> RLS filtra **filas**, no columnas. La app solo pide las columnas de la tabla de arriba, pero con la política de `Cadetes` un cliente logueado podría leer todas. A futuro conviene exponer una vista con solo esas columnas.

### 4. Realtime

- *Database → Replication*: la tabla `Pedidos` tiene que estar publicada. El seguimiento escucha `postgres_changes` de tipo UPDATE (así llega todo lo que decide el asignador).
- Los canales de broadcast no necesitan configuración.

---

## Publicar (Netlify)

1. *Add new site → Import from Git* → este repo.
2. Build command: **vacío**. Publish directory: **`.`** Ya vienen en [`netlify.toml`](netlify.toml).
3. Agregar la URL del sitio en Supabase (ver [Autenticación con Google](#1-autenticación-con-google)).

`netlify.toml` ya incluye:

- **`Cache-Control: no-cache`**: los `.js` no tienen hash en el nombre. Sin esto, después de un deploy el navegador puede mezclar un HTML nuevo con un módulo viejo y la página no carga.
- **404 para `docs/`, `herramientas/`, `README.md`, `package.json` y `scripts/verificar.mjs`**, que no son parte de la app. Ojo: `scripts/` **sí** se publica, porque ahí viven los módulos de la app; solo se bloquea el verificador.

Cualquier otro hosting estático sirve (Vercel, GitHub Pages, Cloudflare Pages) siempre que respete esas dos cosas y sirva por HTTPS.

---

## Contrato con la app de cadetes

La especificación completa está en [`docs/contrato_app_cadetes.md`](docs/contrato_app_cadetes.md): secciones 2 (datos y estados), 7 (asignación en el servidor), 8 (seguimiento) y 9 (chat). Resumen de lo que **no se puede cambiar de un solo lado**:

**Estados de `Pedidos.estado_pedido`**

`pendiente` → `libre` (ofrecido a un cadete) → `en_confirmacion` (lo está viendo) → `asignado` → `en_camino_entrega` → `entregado` → `rendido`, o `cancelado`.

**Canales y eventos**

| Canal | Evento | Dirección | Payload |
|---|---|---|---|
| `pedidos-cadete-{id_cad}` | `nuevo_pedido` | Cliente → Cadete | fila completa de `Pedidos` |
| `pedidos-cadete-{id_cad}` | `pedido_retirado` | Cliente → Cadete | `{ id_pedido, id_cadete }` |
| `pedido-en-curso-{id}` | `pedido_rechazado` | Cadete → Cliente | `{ id_pedido, id_cadete_rechazo }` |
| `pedido-en-curso-{id}` | `cambio_estado_pedido` | Cadete → Cliente | `{ id_pedido, id_cadete, estado_pedido, patente, vehiculo, timestamp }` |
| `pedido-en-curso-{id}` | `cadete_conectado` | Cadete → Cliente | `{ id_pedido, id_cadete, patente, vehiculo, timestamp }` |
| `pedido-en-curso-{id}` | `ubicacion_cadete` | Cadete → Cliente | `{ id_pedido, id_cadete, patente, vehiculo, coords: { lat, lng, accuracy, heading, speed, timestamp } }` |
| `pedido-en-curso-{id}` | `mensaje_chat` | ambos | `{ id_mensaje, id_pedido, id_emisor, id_receptor, remitente, texto, hora: 'HH:MM', timestamp }` |
| `cadetes-disponibles` | Presence (`track`) | Cadete → panel de admin (esta app ya no lo escucha) | `{ id_cad, nombre, coords: { lat, lng }, coords_ts, estado_cad, patente, vehiculo_cad }` |

**Chat guardado:** cada `mensaje_chat` queda además en `Pedidos.Chat_pedido` (texto con un array JSON de esos mensajes, sin `id_pedido`). Lo escriben las dos apps con `chat_pedido.js`, que está **copiado en los dos repos**: se cambian juntos.

**Tiempos:** la oferta al cadete vence a los `TIMEOUT_OFERTA_MS = 20000` (20 s). Tiene que ser **mayor** que el timer del modal del cadete (15 s).

**Asignación por cercanía:** el servidor ofrece primero al cadete libre más cercano al punto de retiro (Haversine con la ubicación que cada cadete manda en su latido, `cadete_latido`; solo cuenta si tiene un fix GPS real). Después de 3 ofertas sin aceptar, sigue por `id_cad` sin tener en cuenta la distancia.

**Regla:** cualquier cambio en estas tablas va en **los dos repos a la vez**, y se actualiza `docs/contrato_app_cadetes.md`. `npm run verificar` avisa si alguno de estos nombres desaparece del código de clientes, pero no puede revisar el otro repo.

---

## Cómo no romperla

### Antes de cada commit

```bash
npm run verificar
```

Detecta, sin abrir el navegador:

- errores de sintaxis en los `.js` y en los `<script type="module">` de cada página;
- imports a archivos o funciones que no existen, rutas rotas entre carpetas e imports que se escapan del repo;
- IDs usados desde JS que no están en el HTML, IDs duplicados y enlaces a páginas inexistentes;
- librerías de CDN sin versión exacta;
- nombres del contrato con cadetes que desaparecieron.

No hay CI: la verificación se corre a mano antes de cada commit.

### Reglas del código

- **Texto de usuarios siempre como texto:** `textContent`, o `escaparHtml()` si hay que armar HTML. Aplica a chat, direcciones, nombres, favoritas y `inform_pedido`. Nunca meterlo crudo en `innerHTML`.
- **Escrituras sobre `Pedidos` siempre condicionales** (bloqueo optimista): `.eq('id_pedido', X).in('estado_pedido', [...])` y compañía. Si el UPDATE no devuelve filas, alguien cambió el pedido en el mismo instante; hay que releer, no pisar. Ver `script_asignacion.js`.
- **Esta app no asigna cadetes.** No escribir `estado_pedido` ni `id_cadete` de un pedido en búsqueda (el servidor lo rechaza): la UI se arma leyendo la fila del pedido (`textoBusqueda()` en `busqueda_pedido.js`).
- **Clases de Tailwind escritas completas** (`'bg-brand-accent'`, no `'bg-' + color`): la compilación solo incluye las clases que encuentra escritas en el HTML y el JS.
- **Después de agregar o cambiar clases de Tailwind, o de tocar el tema** (`tailwind/cliente.config.cjs`): `npm run css` y commitear `styles/tailwind.css`. Si no, la clase nueva no tiene estilo. El `<link>` de `tailwind.css` va último en el `<head>`, para que gane sobre `estilos_cliente.css` igual que cuando lo insertaba el CDN.
- **Un `<fieldset>` con contenido que scrollea lleva `min-w-0`**. Si no, ensancha la página más que la pantalla del celular.
- Páginas nuevas: copiar la estructura de `dashboard.html` (`#appBar`, `#barraInferior`, `layout_previo.js`, `#cargandoPagina`, `#contenidoPagina`, y `data-pestana`/`data-titulo` en el `<body>`), llamar a `requerirCliente()` y `montarLayoutCliente()`, y si va en la barra inferior, sumarla a `PESTANAS` en `layout_previo.js`.

### Pruebas manuales antes de publicar un cambio grande

Con 2 o 3 sesiones de cadete abiertas en la app de cadetes:

1. Pedido nuevo: se ofrece a un cadete por vez, primero al más cercano al retiro; al aceptar se ve cadete, patente, GPS y chat.
   Si los 3 más cercanos rechazan, se sigue por `id_cad`.
   Chat: recargar el seguimiento y ver que los mensajes siguen ahí; escribir con la app del cadete cerrada y ver que le aparecen al abrir el viaje.
2. Todos rechazan → cancelado con "Todos los cadetes rechazaron el pedido".
3. Ningún cadete en turno → cancelado con "No hay cadetes conectados".
4. El cadete no responde → a los 20 s pasa al siguiente.
5. "Cancelar pedido" mientras busca → al cadete con la oferta abierta se le cierra.
   Cerrar la app mientras busca → la búsqueda sigue y llega el aviso push cuando un cadete acepta.
6. Perfil: cambiar teléfono, agregar, editar y borrar una favorita; usarla en "Pedir".
7. En el celular (o DevTools a 360 px): nada se sale de la pantalla y la barra inferior no tapa botones.

---

## Actualizar dependencias

Todas están fijadas. **Actualizar de a una y probar**:

| Dependencia | Dónde | Cómo actualizar |
|---|---|---|
| supabase-js `2.116.0` | `conexion_supabase.js` | Ver la última 2.x en <https://esm.sh/@supabase/supabase-js@2> (la primera línea muestra la versión) |
| Tailwind `3.4.17` (compilado) | `tailwind/compilar.mjs` | Cambiar la versión ahí y correr `npm run css`. **No pasar a v4 sin revisar**: cambia la configuración del tema |
| Leaflet `1.9.4` | `<link>` y `<script>` de `crear_pedido`, `pedido_activo` y `configuracion` | Mismo número en CSS y JS |
| serve `14.2.4` | `package.json` (solo desarrollo) | — |

Después de actualizar: `npm run verificar` y las pruebas manuales.

---

## Decisiones y limitaciones conocidas

La lista completa de pendientes (cola de pedidos, cálculos en el servidor y mejoras menores) está en la
[sección 14 del contrato](docs/contrato_app_cadetes.md#14-fuera-de-alcance--pendiente).

- **La asignación de cadetes la hace el servidor** (funciones de Postgres + pg_cron, `supabase/migrations/20261115100000_asignador_en_servidor.sql`; ver la [sección 7 del contrato](docs/contrato_app_cadetes.md)). Esta app crea el pedido y solo mira cómo avanza: el cliente puede cerrarla y la búsqueda sigue. `scripts/busqueda_pedido.js` arma el texto del panel a partir de la fila del pedido.
- **Durante la búsqueda la app no puede escribir `estado_pedido` ni `id_cadete`:** el trigger `asignador_guardia` rechaza esos `UPDATE`. Para cancelar se usa la función `cancelar_pedido_cliente`.
- **Búsquedas abandonadas:** un pedido que sigue sin cadete más de 30 minutos lo cancela el servidor.
- **Si el latido de pg_cron se detiene** (`select * from cron.job` no muestra `asignador-tick`), las ofertas dejan de vencer y los pedidos en espera no se retoman; la primera oferta y los rechazos siguen funcionando porque no dependen del latido.
- **El total se calcula en el cliente** (`coste_pedido`). Con backend, recalcularlo del lado del servidor.
- **El chat se guarda en `Pedidos.Chat_pedido`** además de ir por broadcast. Cliente y cadete escriben la misma columna sin bloqueo, así que `chat_pedido.js` guarda siempre la unión de mensajes y la repara si una escritura pisó a la otra. Con backend conviene pasarlo a una función que agregue el mensaje de forma atómica.
- **Direcciones:** mientras se escribe, la app sugiere desde `datos/pico_truncado.json`, un índice de Pico Truncado armado con datos de OpenStreetMap (calles con número, esquinas, barrios y lugares). Los números que no están cargados en OSM se estiman con la numeración de la calle y la app avisa que la ubicación es aproximada. Lo que no está en el índice se busca con el botón en Nominatim, un servicio público con máximo 1 consulta por segundo y sin autocompletado. OSM tiene pocos comercios cargados: los que falten se pueden agregar en [openstreetmap.org](https://www.openstreetmap.org) y regenerar con `npm run indice`. Los datos son ODbL: el índice lleva la atribución.
- **Tailwind compilado y commiteado:** `styles/tailwind.css` es un archivo generado. No editarlo a mano; se regenera con `npm run css` (necesita internet la primera vez, para bajar Tailwind con `npx`).
- **Teléfonos de prueba:** `549264123456` y `549264000000` (los que cargaba el prototipo) se tratan como "sin teléfono" y la app pide completarlo.
