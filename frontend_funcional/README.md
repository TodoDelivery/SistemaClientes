# Todo Delivery · App de clientes

App web (mobile first) con la que los clientes piden un cadete, cotizan el envío, siguen el pedido en vivo y chatean con el cadete.

Es un **sitio estático sin build**: HTML + módulos JS del navegador. Supabase (Auth, base de datos y Realtime), Tailwind, Leaflet y supabase-js se cargan por CDN con **versión fija**.

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
├── index.html              Entrada: redirige a templates/dashboard.html
├── 404.html                Página de error (Netlify la busca en la raíz publicada)
│
├── templates/
│   ├── login_google.html   Login con Google y alta del cliente (pide teléfono la primera vez)
│   ├── dashboard.html      "Mis pedidos": pedidos en curso + historial
│   ├── crear_pedido.html   "Pedir": mapa, direcciones, favoritas, cotización y alta del pedido
│   ├── pedido_activo.html  "Seguimiento": estado, cadete, GPS, chat. CORRE EL MOTOR DE ASIGNACIÓN
│   └── configuracion.html  "Perfil": datos, teléfono, ubicaciones favoritas, cerrar sesión
│
├── scripts/
│   ├── conexion_supabase.js  Cliente de Supabase (URL + clave pública)
│   ├── script_asignacion.js  Motor de asignación de cadetes (sin DOM; avisa por eventos)
│   ├── sesion_cliente.js     Sesión, datos del cliente, favoritas, consultas comunes
│   ├── ui_cliente.js         Barra superior e inferior, toasts, hojas modales, formatos, íconos
│   ├── direcciones.js        Búsqueda de direcciones y dirección de un punto (Nominatim)
│   ├── tema_cliente.js       Colores y fuente de Tailwind
│   └── verificar.mjs         Verificación estática (ver "Cómo no romperla"). No se publica
│
├── styles/
│   └── estilos_cliente.css   Estilos compartidos (zonas seguras, Leaflet oscuro, animaciones)
│
├── docs/contrato_app_cadetes.md   Especificación completa: datos, estados, motor, canales
├── netlify.toml
└── package.json            Solo scripts de desarrollo (no hay dependencias)
```

Qué importa cada página:

| Página | Usa |
|---|---|
| todas menos login | `sesion_cliente.js` + `ui_cliente.js` |
| `crear_pedido.html` | + `script_asignacion.js` (cancelar pedidos viejos) + `direcciones.js` |
| `pedido_activo.html` | + `script_asignacion.js` (motor completo) |
| `configuracion.html` | + `direcciones.js` |

---

## Correr en local

Requisito: Node 18 o superior (solo para el servidor local y la verificación).

```bash
npm run dev          # http://localhost:5173
npm run verificar    # chequeo estático, tarda segundos
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
| `Pedidos` | `*` de sus pedidos | INSERT; UPDATE de `estado_pedido`, `id_cadete` (motor de asignación) |
| `Cadetes` | `id_cad, nombre_cad, alias_cad, estado_cad, telef_cad, vehiculo_cad, patente` | — |
| `Datos_cotiz` | `bajada_band, tarifa_km, porc_tarif_dinamica` (primera fila) | — |

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

- *Database → Replication*: la tabla `Pedidos` tiene que estar publicada. El seguimiento y el motor escuchan `postgres_changes` de tipo UPDATE.
- Los canales de broadcast no necesitan configuración.

---

## Publicar (Netlify)

1. *Add new site → Import from Git* → este repo.
2. Build command: **vacío**. Publish directory: **`.`** Ya vienen en [`netlify.toml`](netlify.toml).
3. Agregar la URL del sitio en Supabase (ver [Autenticación con Google](#1-autenticación-con-google)).

`netlify.toml` ya incluye:

- **`Cache-Control: no-cache`**: los `.js` no tienen hash en el nombre. Sin esto, después de un deploy el navegador puede mezclar un HTML nuevo con un módulo viejo y la página no carga.
- **404 para `docs/`, `README.md`, `package.json` y `scripts/verificar.mjs`**, que no son parte de la app. Ojo: `scripts/` **sí** se publica, porque ahí viven los módulos de la app; solo se bloquea el verificador.

Cualquier otro hosting estático sirve (Vercel, GitHub Pages, Cloudflare Pages) siempre que respete esas dos cosas y sirva por HTTPS.

---

## Contrato con la app de cadetes

La especificación completa está en [`docs/contrato_app_cadetes.md`](docs/contrato_app_cadetes.md): secciones 2 (datos y estados), 7 (motor), 8 (seguimiento) y 9 (chat). Resumen de lo que **no se puede cambiar de un solo lado**:

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
| `pedido-en-curso-{id}` | `mensaje_chat` | ambos | `{ id_pedido, id_emisor, id_receptor, remitente, texto, hora: 'HH:MM', timestamp }` |
| `cadetes-disponibles` | Presence (`track`) | Cadete → todos | `{ id_cad, nombre, coords: { lat, lng }, coords_ts, estado_cad, patente, vehiculo_cad }` |

**Tiempos:** la oferta al cadete vence a los `TIMEOUT_OFERTA_MS = 20000` (20 s). Tiene que ser **mayor** que el timer del modal del cadete (15 s).

**Asignación por cercanía:** el motor ofrece primero al cadete libre más cercano al punto de retiro (Haversine con la ubicación de Presence; solo cuentan las `coords` con `coords_ts`, que es la hora del último fix GPS). Después de `RECHAZOS_MAX_CERCANIA = 3` ofertas sin aceptar, sigue por `id_cad` sin tener en cuenta la distancia.

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
- **`script_asignacion.js` no toca el DOM.** La página se entera por `suscribirMotorAsignacion()`. Así el motor se puede mover a una Edge Function sin reescribir la UI.
- **Clases de Tailwind escritas completas** (`'bg-brand-accent'`, no `'bg-' + color`). El CDN genera las clases que encuentra en el DOM.
- **Un `<fieldset>` con contenido que scrollea lleva `min-w-0`**. Si no, ensancha la página más que la pantalla del celular.
- Páginas nuevas: copiar la estructura de `dashboard.html` (`#appBar`, `#cargandoPagina`, `#contenidoPagina`, `#barraInferior`), llamar a `requerirCliente()` y `montarLayoutCliente()`, y si va en la barra inferior, sumarla a `PESTANAS` en `ui_cliente.js`.

### Pruebas manuales antes de publicar un cambio grande

Con 2 o 3 sesiones de cadete abiertas en la app de cadetes:

1. Pedido nuevo: se ofrece a un cadete por vez, primero al más cercano al retiro; al aceptar se ve cadete, patente, GPS y chat.
   Si los 3 más cercanos rechazan, se sigue por `id_cad`.
2. Todos rechazan → cancelado con "Todos los cadetes rechazaron el pedido".
3. Ningún cadete en turno → cancelado con "No hay cadetes conectados".
4. El cadete no responde → a los 20 s pasa al siguiente.
5. "Cancelar pedido" mientras busca → al cadete con la oferta abierta se le cierra.
6. Perfil: cambiar teléfono, agregar, editar y borrar una favorita; usarla en "Pedir".
7. En el celular (o DevTools a 360 px): nada se sale de la pantalla y la barra inferior no tapa botones.

---

## Actualizar dependencias

Todas están fijadas. **Actualizar de a una y probar**:

| Dependencia | Dónde | Cómo actualizar |
|---|---|---|
| supabase-js `2.116.0` | `conexion_supabase.js` | Ver la última 2.x en <https://esm.sh/@supabase/supabase-js@2> (la primera línea muestra la versión) |
| Tailwind CDN `3.4.17` | `<script>` de cada `.html` | Reemplazar en las 5 páginas que lo usan (todas menos `index.html` y `404.html`). **No pasar a v4 por CDN sin revisar**: cambia la configuración del tema |
| Leaflet `1.9.4` | `<link>` y `<script>` de `crear_pedido`, `pedido_activo` y `configuracion` | Mismo número en CSS y JS |
| serve `14.2.4` | `package.json` (solo desarrollo) | — |

Después de actualizar: `npm run verificar` y las pruebas manuales.

---

## Decisiones y limitaciones conocidas

- **El motor de asignación corre en el navegador del cliente**, dentro de `pedido_activo.html`. Si el cliente cierra esa pantalla, la búsqueda se pausa (la página avisa antes de salir) y se retoma al volver a abrirla. Está previsto moverlo a una Supabase Edge Function cuando exista la UI de cadetes definitiva.
- **Varias pestañas con el mismo pedido:** solo una corre el motor (Web Locks); si se cierra, otra toma el control.
- **Búsquedas abandonadas:** un pedido que sigue sin cadete más de 30 minutos (`VENCIMIENTO_BUSQUEDA_MS`) se cancela al abrir la app, en vez de ofrecerse días después.
- **Al retomar una búsqueda pausada** se puede volver a ofrecer a un cadete que ya había rechazado: el registro de rechazos vive en memoria. Por lo mismo, la cuenta de rechazos por cercanía vuelve a cero. Se resuelve con la Edge Function.
- **Ubicación de los cadetes a la vista del cliente:** para asignar por cercanía, el navegador del cliente escucha Presence de `cadetes-disponibles`, que trae la posición GPS de todos los cadetes en turno. El canal ya era público (el panel de admin lo usa), pero con el motor en el cliente cualquier cliente puede leer esas posiciones. Se resuelve con la Edge Function o pasando el canal a privado.
- **El total se calcula en el cliente** (`coste_pedido`). Con backend, recalcularlo del lado del servidor.
- **El chat no se guarda**: va por broadcast y se pierde al recargar.
- **Direcciones:** se usa Nominatim (OpenStreetMap), un servicio público con máximo 1 consulta por segundo y sin autocompletado. Está bien para bajo volumen; con muchos usuarios hay que pasar a un proveedor con contrato.
- **Tailwind por CDN** muestra un aviso en la consola de que no es para producción. Funciona igual; a futuro conviene compilarlo.
- **Teléfonos de prueba:** `549264123456` y `549264000000` (los que cargaba el prototipo) se tratan como "sin teléfono" y la app pide completarlo.
