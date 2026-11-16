# Prompt / Guía para portear la App de Clientes de Todo Delivery

## 0. Contexto y objetivo

Hay que construir la app de Clientes definitiva de "Todo Delivery" replicando la funcionalidad del prototipo
`pruebas_pedidos/prueba_insercion_pedidos.html` (un solo HTML con Supabase JS v2, Leaflet y Tailwind).

La app es independiente del framework que se elija, pero debe respetar AL PIE DE LA LETRA:
- El modelo de datos y los estados de la sección 2.
- La asignación de cadetes de la sección 7, que hace el servidor (es la parte crítica: coordina las dos apps).
- Los nombres de canales, eventos y payloads de Realtime de las secciones 7, 8 y 9. La app de cadetes
  (`Templates/dashboard.html`, `Templates/pedido_activo.html`, `Scripts/conexion_rt_*.js`) ya depende de ellos.

Funcionalidades a portear:
1. Login del cliente y sincronización con la tabla `Clientes`.
2. Selección de retiro (A) y entrega (B) en un mapa.
3. Cotización automática según la tabla `Datos_cotiz` (con tarifa nocturna).
4. Creación del pedido y asignación secuencial de cadetes (uno a la vez).
5. Seguimiento en vivo: estado, datos y patente del cadete, GPS.
6. Chat en tiempo real con el cadete.
7. Historial de pedidos, con acceso al seguimiento de los que siguen activos.

Estructura de navegación del prototipo: 3 pestañas → "Solicitar Envío", "Seguimiento" y "Mis Pedidos".

---

## 1. Stack y conexión

- Supabase JS v2 (`createClient(URL, ANON_KEY, { realtime: { params: { eventsPerSecond: 10 } } })`).
  URL y clave pública deben venir de variables de entorno, no hardcodeadas.
- Mapas: Leaflet 1.9.4 con tiles de OpenStreetMap (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`).
  El prototipo aplica un filtro CSS para modo oscuro sobre `.leaflet-tile`.
- Realtime debe estar habilitado para la tabla `Pedidos` (se usa `postgres_changes` sobre UPDATE).
- Las políticas RLS deben permitir al cliente autenticado: leer/insertar/actualizar SUS pedidos, leer
  `Datos_cotiz`, leer de `Cadetes` las columnas indicadas en la sección 2 e insertar su fila en `Clientes`.

---

## 2. Modelo de datos

### Tablas (solo columnas relevantes)

**Clientes**
| Columna            | Tipo        | Notas                                   |
|--------------------|-------------|-----------------------------------------|
| id_cliente         | uuid (PK)   | = `auth.users.id`                       |
| nombre_cliente     | text        |                                         |
| telefono_cliente   | text        |                                         |
| f_loggueo_cliente  | timestamptz | NOT NULL                                |

**Pedidos**
| Columna         | Tipo        | Notas                                                        |
|-----------------|-------------|--------------------------------------------------------------|
| id_pedido       | int8 (PK)   | autogenerado                                                 |
| id_cliente      | uuid        | FK Clientes                                                  |
| id_cadete       | int8 NULL   | FK Cadetes. Cadete al que se le OFRECE o que TIENE el pedido |
| coste_pedido    | float8      | total cotizado                                               |
| inform_pedido   | text        | descripción / comercio                                       |
| tipo_paquete    | text        |                                                              |
| estado_pedido   | text        | ver tabla de estados                                         |
| fecha_pedido    | timestamptz | NOT NULL, se envía al insertar                               |
| latitud_org / longitud_org   | float8 | punto A (retiro)                                 |
| latitud_dest / longitud_dest | float8 | punto B (entrega)                                |
| tiempo_pedido   | int8        | minutos del viaje, lo escribe el cadete al entregar          |
| Chat_pedido     | text NULL   | chat del pedido: array JSON de mensajes (sección 9). Lo escriben cliente y cadete |
| porc_comision   | float8 NULL | % que el cadete rinde de este pedido. Lo fija un trigger de la BD al pasar a `asignado` (copia `Datos_cotiz.Porc_Comision`) y lo borra si `id_cadete` vuelve a null. Ninguna app lo escribe |
| id_rendicion    | int8 NULL   | rendición de caja que incluyó el pedido (tabla `Rendiciones`). Lo escribe la función `rendir_caja` |
| creado_en       | timestamptz | hora del servidor en que se creó (la pone la BD). El vencimiento de 30 min de la búsqueda se mide desde acá, no desde `fecha_pedido`, que la manda el celular |
| motivo_cancelacion | text NULL | por qué se canceló. Lo escribe el asignador (sección 7.3) |
| oferta_vence_en | timestamptz NULL | hasta cuándo tiene el cadete ofertado para responder. Lo escribe el asignador |
| espera_desde    | timestamptz NULL | desde cuándo se espera que se libere un cadete ocupado. Lo escribe el asignador |

**Cadetes** (el cliente solo LEE, nunca usar `select('*')`)
- Para mostrar a quién se le está ofreciendo el pedido: `nombre_cad, alias_cad`.
- Para mostrar el cadete asignado: `id_cad, nombre_cad, alias_cad, telef_cad, vehiculo_cad, patente`.

**Datos_cotiz**: `bajada_band`, `tarifa_km`, `porc_tarif_dinamica` (se usa la primera fila).
Además tiene `Porc_Comision` (float8, 40 por defecto): % vigente que el cadete rinde a la empresa; su ganancia es el resto. Se congela en `Pedidos.porc_comision` al aceptar, así que cambiarlo solo afecta a pedidos aceptados después. Y `whatsapp_central` (text NULL): número de la central para el resumen del cashout del cadete. Los dos los edita el admin en Dashboard-Admin → Ajustes; la app de clientes no los usa. `Datos_cotiz` está en la publicación de Realtime.

**Rendiciones** y **Cierres_jornada**: las escribe solo Dashboard-Admin (Caja), con las funciones `rendir_caja(p_id_cadete, p_ids_pedidos, p_metodo_pago, p_notas)` y `anular_rendicion(p_id_rendicion)` para rendir o reabrir. La app de clientes no las usa.

**cadetes_senal** (`id_cad` PK, `ultima_senal`, `lat`, `lng`, `ubicacion_en`): latido y última ubicación de cada
cadete en turno. La escribe `cadete_latido()` y la lee solo el asignador; las apps no tienen acceso.

**ofertas_pedido** (`id_oferta` PK, `id_pedido`, `id_cadete`, `ofrecida_en`, `vence_en`, `resultado`, `resuelta_en`,
`distancia_km`, `por_cercania`): una fila por cada oferta de un pedido a un cadete. `resultado` = `null` (vigente),
`aceptada`, `rechazada`, `vencida` o `retirada`. Las apps no tienen acceso.

### Estados de `Pedidos.estado_pedido`

| Estado             | id_cadete | Significado                                            | Lo escribe            |
|--------------------|-----------|--------------------------------------------------------|-----------------------|
| `pendiente`        | null      | Sin oferta vigente (recién creado, entre ofertas o esperando que se libere un cadete) | Cliente (al crear) / Servidor |
| `libre`            | X         | Ofrecido al cadete X, todavía no abrió la oferta       | Servidor              |
| `en_confirmacion`  | X         | El cadete X tiene el modal de la oferta abierto        | Cadete (`cadete_ver_oferta`) |
| `en_cola`          | X         | X está en viaje con otro pedido y aceptó hacer este apenas termine | Cadete (`cadete_aceptar_pedido`) |
| `asignado`         | X         | X aceptó (o terminó el viaje anterior y este salió de su cola); va a retirar el pedido | Cadete (`cadete_aceptar_pedido`) / Servidor |
| `en_camino_entrega`| X         | X retiró el paquete y va al destino                    | Cadete                |
| `entregado`        | X         | Entregado (con `tiempo_pedido`)                        | Cadete                |
| `rendido`          | X         | La administradora cobró el efectivo (con `id_rendicion`) | Admin (`rendir_caja`) |
| `cancelado`        | null o X  | Ver `motivo_cancelacion`: sin cadetes, todos rechazaron, nadie se liberó, venció o lo canceló el cliente | Servidor / Cliente (`cancelar_pedido_cliente`) |

Los cuatro primeros son la **fase de búsqueda**: `ESTADOS_BUSQUEDA = ['pendiente', 'libre', 'en_confirmacion', 'en_cola']`.
Una **oferta vigente** es `estado_pedido IN ('libre','en_confirmacion') AND id_cadete IS NOT NULL`.

### Estados de `Cadetes.estado_cad` (los escribe la app de cadetes)
`disponible` (en turno y libre), `en_confirmacion` (viendo una oferta), `ocupado` (con viaje), `desconectado`.

---

## 3. Autenticación y perfil del cliente

- Proveedor: Google OAuth (`supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })`),
  con `redirectTo` = URL actual sin hash ni query.
- Al iniciar: `supabase.auth.getSession()`. Además escuchar `supabase.auth.onAuthStateChange`.
- Nombre a mostrar: `user_metadata.full_name || user_metadata.name || parte local del email`.
- Sincronizar `Clientes`: si no existe una fila con `id_cliente = user.id`, insertarla con
  `{ id_cliente, nombre_cliente, telefono_cliente, f_loggueo_cliente: now }`.
  El prototipo usa un teléfono placeholder si `user.phone` viene vacío; en la app real conviene pedirlo.
- Sin sesión no se puede crear pedidos ni ver historial.
- Logout: `supabase.auth.signOut()`. Una búsqueda de cadete en curso sigue en el servidor (sección 7).

NO portear: el botón "Login 1-Click" del prototipo (credenciales de demo hardcodeadas, solo para pruebas).

---

## 4. Selección de retiro y entrega (mapa)

- Coordenadas por defecto (San Juan): A = (-31.5375, -68.5364), B = (-31.5390, -68.5320). Zoom 14.
- Dos marcadores arrastrables: **A (Retiro, verde)** y **B (Entrega, ámbar)**, unidos por una polilínea punteada.
- Selector de "punto activo" (A o B): un click en el mapa mueve el marcador del punto activo.
- Botón "Mi GPS para Destino": `navigator.geolocation.getCurrentPosition` (`enableHighAccuracy: true`,
  `timeout: 6000`) y mueve B a esa posición.
- Mostrar coordenadas legibles (4 decimales) y la distancia estimada.
- Cada cambio de A o B recalcula la cotización.

---

## 5. Cotización

1. Al iniciar, leer `Datos_cotiz` (primera fila). Si falla o no hay fila, usar
   `bajada_band = 1200`, `tarifa_km = 1000`, `porc_tarif_dinamica = 30`.
2. Distancia: fórmula de Haversine entre A y B (radio 6371 km, en línea recta, no por calles),
   redondeada a 0,1 km, con **mínimo de 0,6 km**.
3. Cálculo:
   ```
   costoKm   = round(distKm * tarifa_km)
   subtotal  = bajada_band + costoKm
   nocturno  = hora local entre 00:00 y 05:59
   factor    = porc_tarif_dinamica > 1 ? porc_tarif_dinamica / 100 : porc_tarif_dinamica
   recargo   = nocturno ? round(subtotal * factor) : 0
   total     = subtotal + recargo        → se guarda en Pedidos.coste_pedido
   ```
4. Mostrar el desglose: bajada de bandera, costo por distancia (con los km), recargo nocturno y total en
   formato `es-AR`. Indicar "Tarifa Nocturna" o "Tarifa Estándar". Se paga en efectivo al cadete.

El toggle "Simular horario nocturno" del prototipo es solo para pruebas (como mucho, un flag de desarrollo).

---

## 6. Creación del pedido

Al confirmar:
1. Validar sesión.
2. Si ya hay una búsqueda de cadete activa para otro pedido, pedir confirmación
   ("El pedido #N todavía está buscando cadete. ¿Cancelarlo y crear uno nuevo?"). Si acepta, ejecutar
   `cancelarBusquedaPorCliente` (sección 7.4); si no, abortar.
3. Asegurar la fila en `Clientes` (sección 3).
4. Insertar y leer la fila creada (`insert(...).select().single()`):
   ```js
   {
     id_cliente, coste_pedido: total, inform_pedido, tipo_paquete,
     estado_pedido: 'pendiente',   // SIEMPRE nace sin cadete
     id_cadete: null,
     latitud_org, longitud_org, latitud_dest, longitud_dest,
     fecha_pedido: new Date().toISOString()
   }
   ```
5. Abrir el panel de seguimiento con ese pedido y conectar su canal (sección 8).
6. No hay que iniciar nada: el servidor empieza a buscar cadete al insertarse el pedido (sección 7).

Tipos de paquete del prototipo: "Bolsa de Comida", "Caja de Pizza", "Paquete Chico", "Bebidas", "Farmacia".

---

## 7. Asignación de cadetes (la hace el servidor)

Desde el 15/11/2026 la asignación **no corre en el navegador del cliente**: la hace la base de datos
(funciones de Postgres + pg_cron). El código está en
`SistemaClientes/supabase/migrations/20261115100000_asignador_en_servidor.sql`. La app de clientes crea el
pedido y **solo mira** cómo avanza; puede cerrarse y la búsqueda sigue.

### 7.1 Reglas

- El pedido se ofrece a **un único cadete por vez**. Nunca a varios a la vez, nunca por un canal global.
- Primero al cadete **libre más cercano al punto de retiro** (línea recta, Haversine). Los que no tienen
  ubicación van al final. Después de **3 ofertas sin aceptar** (rechazo o sin respuesta) se sigue sin tener en
  cuenta la distancia, por `id_cad`.
- A un cadete que rechazó o no respondió **no se le vuelve a ofrecer ese pedido** (queda en `ofertas_pedido`,
  no en la memoria de un navegador).
- Cadete **libre** = `Cadetes.estado_cad = 'disponible'`, con señal reciente y sin ninguna oferta ni viaje a su
  nombre. Cadete **ocupado** = con señal reciente pero en viaje, con una oferta abierta o `estado_cad`
  distinto de `'disponible'`. Sin señal o `'desconectado'` = fuera de turno.
- Todas las decisiones pasan de a una (bloqueo `pg_advisory_xact_lock`) y releyendo el pedido: dos pedidos
  nunca compiten por el mismo cadete, y aceptar/rechazar en el mismo instante que un vencimiento no se pisa.
- **Solo el servidor mueve `estado_pedido` e `id_cadete` durante la búsqueda.** El trigger `asignador_guardia`
  rechaza cualquier `UPDATE` directo de las apps sobre un pedido en `pendiente` / `libre` / `en_confirmacion`
  (y cualquier intento de volver un pedido a esos estados). Las apps usan las funciones de 7.4.
- **Cola por cadete** (`20261116090000_cola_por_cadete.sql`): si no hay ningún cadete libre, el pedido se le
  ofrece a un cadete **en viaje**, para que lo haga apenas termine. Se elige al que va a quedar más cerca: aquel
  cuyo **destino actual** está más cerca del **retiro** del pedido nuevo. Si acepta, el pedido queda `en_cola` a su
  nombre (un solo pedido en cola por cadete) y pasa solo a `asignado` cuando entrega el viaje. Si en 15 minutos
  no lo terminó, el pedido vuelve a la búsqueda. Rechazar una oferta de cola no descarta al cadete: cuando quede
  libre se le puede ofrecer el pedido normalmente.
- El cadete NUNCA toma pedidos por su cuenta.

### 7.2 Plazos

| Qué                                                        | Valor  |
|------------------------------------------------------------|--------|
| Tiempo del cadete para responder una oferta                | 20 s (su modal dura 15 s; el resto es margen de red) |
| Latido del servidor (pg_cron `asignador-tick`)             | 3 s    |
| Espera máxima a que se libere un cadete (nadie libre ni encolable) | 15 min |
| Tiempo máximo de un pedido en la cola de un cadete         | 15 min (después vuelve a la búsqueda) |
| Vencimiento de una búsqueda (desde `Pedidos.creado_en`)    | 30 min |
| Ofertas por cercanía sin aceptar antes de ignorar la distancia | 3  |
| Señal del cadete (`cadete_latido`)                         | cada 15 s; sin señal por 75 s = desconectado |

### 7.3 Qué pasa con un pedido

1. La app de clientes inserta el pedido en `pendiente`, sin cadete (sección 6). El trigger
   `asignador_al_crear_pedido` hace la primera oferta en el momento.
2. **Oferta**: `id_cadete = X`, `estado_pedido = 'libre'`, `oferta_vence_en = ahora + 20 s`, una fila en
   `ofertas_pedido` y un broadcast `nuevo_pedido` al canal `pedidos-cadete-{X}`.
3. El cadete abre el modal (`cadete_ver_oferta` → `en_confirmacion`) y:
   - **acepta** (`cadete_aceptar_pedido`) → `asignado`; fin de la búsqueda;
   - **rechaza** (`cadete_rechazar_pedido`) → `pendiente` sin cadete y en la misma llamada se ofrece al siguiente;
   - **no responde** → el latido vence la oferta, manda `pedido_retirado` a `pedidos-cadete-{X}` y ofrece al siguiente.
4. **Nadie libre, pero hay un cadete en viaje sin pedido en cola**: se le hace una **oferta de cola**
   (`ofertas_pedido.para_cola = true`; el broadcast `nuevo_pedido` lleva `para_cola: true`). Si acepta, el pedido
   pasa a `en_cola` con `id_cadete = X` y `espera_desde = ahora`. Cuando X entrega su viaje, el trigger
   `asignador_al_terminar_viaje` lo pasa a `asignado` y le manda el broadcast `pedido_en_cola_asignado`.
   Si X no termina en 15 min, vuelve a `pendiente` y se sigue buscando.
5. **Nadie libre ni encolable, pero hay ocupados que todavía pueden tomarlo**: el pedido queda en `pendiente`
   con `espera_desde` y se reintenta en cada latido, hasta 15 min.
6. **No queda nadie**: `cancelado` con `motivo_cancelacion`:
   `No hay cadetes conectados` / `Todos los cadetes rechazaron el pedido` / `Ningún cadete se liberó a tiempo` /
   `La búsqueda de cadete venció` / `Cancelado por el cliente`.

Al cancelar por vencimiento o por el cliente se conserva `id_cadete` si había una oferta abierta, para que ese
cadete reciba la cancelación por `postgres_changes` (su filtro es `id_cadete=eq.{X}`); además se le manda
`pedido_retirado`.

### 7.4 Funciones que usan las apps (RPC)

| Función | Quién | Qué hace |
|---|---|---|
| `cadete_latido(p_id_cad, p_lat, p_lng, p_gps_ms)` | cadete | Señal de vida y última ubicación. `p_gps_ms` = hora (ms) del último fix GPS real; `null` si todavía no hay GPS (no se usa para medir distancias). Se guarda en `cadetes_senal`, que las apps no pueden leer. |
| `cadete_ver_oferta(p_id_pedido, p_id_cad)` → boolean | cadete | Marca `en_confirmacion`. `false` = la oferta ya no es suya: cerrar el modal. |
| `cadete_aceptar_pedido(p_id_pedido, p_id_cad)` → json | cadete | `{ ok: true, pedido }` (es su viaje), o `{ ok: true, en_cola: true, pedido, id_pedido_en_curso }` (quedó en su cola), o `{ ok: false, motivo: 'no_vigente' }`, o `{ ok: false, motivo: 'viaje_en_curso', id_pedido_en_curso }` (oferta normal con un viaje en curso: nunca dos viajes, se devuelve sola). |
| `cadete_rechazar_pedido(p_id_pedido, p_id_cad)` → boolean | cadete | Devuelve la oferta y la pasa al siguiente. `false` = ya no era suya. |
| `cancelar_pedido_cliente(p_id_pedido)` → boolean | cliente (con sesión) | Cancela un pedido propio en búsqueda o en la cola de un cadete. `false` = ya salió de la búsqueda o no es suyo. |

### 7.5 Qué hace la app de clientes

- `scripts/busqueda_pedido.js`: `ESTADOS_BUSQUEDA`, `textoBusqueda(pedido)` (texto del panel a partir de la fila)
  y `cancelarBusquedaPorCliente()`. No hay motor, ni Web Locks, ni Presence.
- `pedido_activo.html` escucha `postgres_changes` del pedido y, mientras busca cadete, actualiza la cuenta
  regresiva cada segundo y relee el pedido cada 5 s por si se perdió un evento.
- Panel durante la búsqueda: "Ofreciendo a {nombre}" / "Enviando oferta • {seg}s" o "Viendo la oferta • {seg}s";
  "Todos los cadetes están ocupados" / "Te asignamos uno apenas se libere • esperamos hasta {min} min más";
  en cola, "{nombre} está terminando otra entrega" / "Sos el siguiente: va a retirar tu pedido apenas termine";
  si no, "Buscando cadete". En cola el cliente puede seguir cancelando.
- El cliente ya **no escucha** `cadetes-disponibles`: no ve la ubicación de los cadetes.

### 7.6 Qué hace la app de cadetes

- `Scripts/latido_cadete.js` manda `cadete_latido` cada 15 s en el dashboard, en Rendición/Historial y durante
  un viaje (así un cadete en viaje cuenta como ocupado y los pedidos esperan a que se libere).
- Las ofertas le llegan por los caminos de siempre: `postgres_changes` de `Pedidos` filtrado por
  `id_cadete`, el broadcast `nuevo_pedido` en `pedidos-cadete-{id}` y el verificador que consulta la BD cada 3 s.
- Ver, aceptar y rechazar pasan por las funciones de 7.4 (`Templates/dashboard.html`).
- `Scripts/cola_cadete.js` (dashboard y pantalla del viaje): consulta la BD cada 3 s; si el cadete tiene un viaje
  y además una oferta abierta, muestra la hoja "Siguiente pedido" (15 s) y la responde con las mismas funciones;
  si tiene un pedido `en_cola`, muestra un cartel fijo. Con un viaje en curso, el modal normal del dashboard no
  toca esa oferta (antes la rechazaba sola).
- Sigue escribiendo `Cadetes.estado_cad` (`disponible` / `en_confirmacion` / `ocupado` / `desconectado`) y
  publicando Presence en `cadetes-disponibles`, que usa el radar del panel de admin.
- Desde `asignado` en adelante (`en_camino_entrega`, `entregado`) el cadete sigue escribiendo el pedido
  directamente, como antes.

### 7.7 Operación

- Ver el latido: `select * from cron.job;` y `select * from cron.job_run_details order by start_time desc limit 5;`
- Historial de ofertas de un pedido: `select * from ofertas_pedido where id_pedido = N order by id_oferta;`
- Corregir un pedido a mano desde el editor SQL: la guardia también frena al editor. En la misma
  transacción, `select set_config('asignador.interno', '1', true);` antes del `UPDATE`.
- Vuelta atrás al motor del navegador: script al final de la migración + publicar las apps del tag de git
  `antes-asignador-servidor`.

### 7.8 Errores que NO hay que reintroducir

- Broadcast al canal global `cadetes-disponibles`: le abría el pedido a todos los cadetes.
- Cadetes que "reclaman" pedidos `pendiente` sin cadete: varios tomaban el mismo pedido.
- Decidir la asignación desde un navegador (cliente o cadete): se pausaba al cerrar la pantalla, perdía los
  rechazos al recargar y exponía el GPS de todos los cadetes.
- Dejar pedidos en `pendiente` para siempre: el servidor los cancela a los 30 minutos.

---

## 8. Seguimiento en vivo

Al mostrar un pedido se conecta UN canal `pedido-en-curso-{id_pedido}` (`broadcast.ack: true`). Si ya se está
conectado a ese mismo topic, reutilizarlo. Si era otro, `removeChannel` del anterior antes de crear el nuevo.

| Evento / fuente                                            | Payload                                                                 | Acción en la UI |
|------------------------------------------------------------|-------------------------------------------------------------------------|-----------------|
| `postgres_changes` UPDATE `Pedidos` (`id_pedido=eq.X`)     | `payload.new` (fila)                                                    | fusionar en el pedido local, actualizar estado, cargar cadete si `asignado`/`en_camino_entrega`, pedir revisión al motor |
| broadcast `cambio_estado_pedido`                           | `{ id_pedido, id_cadete, patente, vehiculo, nombre_cad?, estado_pedido, timestamp }` | actualizar estado y patente; si `asignado`, cargar cadete; pedir revisión al motor |
| broadcast `cadete_conectado`                               | `{ id_pedido, id_cadete, patente, vehiculo, timestamp }`                | mostrar patente y "Vehículo: …" |
| broadcast `ubicacion_cadete`                               | `{ id_pedido, id_cadete, patente, vehiculo, coords: { lat, lng, accuracy, heading, speed, timestamp } }` | coordenadas (5 decimales), velocidad `speed * 3.6` km/h (si es 0: "En movimiento"), "GPS en Vivo • {vehiculo}", patente |
| broadcast `mensaje_chat`                                   | ver sección 9                                                           | se suma al historial del chat (sección 9) |

Datos del cadete asignado: `SELECT id_cad, nombre_cad, alias_cad, telef_cad, vehiculo_cad, patente FROM Cadetes
WHERE id_cad = ?`. Nombre = `nombre_cad || alias_cad || 'Cadete #id'`, iniciales para el avatar.
Patente estilo chapa argentina; si viene vacía, mostrar "NO CARGADA".

Textos por estado (prototipo):
| Estado                                      | Badge                                  | Tarjeta del cadete |
|---------------------------------------------|----------------------------------------|--------------------|
| `pendiente` / `libre` / `en_confirmacion`   | "Buscando cadete..." (animado)         | `textoBusqueda(pedido)` (sección 7.5) |
| `asignado`                                  | "Cadete Asignado • Retirando pedido"   | datos del cadete   |
| `en_camino_entrega`                         | "En camino a tu destino"               | datos del cadete   |
| `entregado` / `rendido`                     | "¡Entregado con Éxito!"                | —                  |
| `cancelado`                                 | "Pedido Cancelado"                     | título = motivo guardado (o "Ningún cadete disponible"), detalle "Puedes volver a solicitar el envío" |

Cuando el pedido está cancelado o entregado, se oculta el indicador de actividad de la pestaña Seguimiento.
Cuando no hay pedido activo, se muestra el estado vacío con un botón a "Solicitar Envío".

---

## 9. Chat con el cadete

- Cada mensaje va **primero en vivo** por broadcast en el canal `pedido-en-curso-{id_pedido}`, evento
  `mensaje_chat`, y **después se guarda** en `Pedidos.Chat_pedido`. Si el otro lado no está conectado, lo lee
  de la BD al volver a abrir el pedido. Al abrir el pedido, el chat arranca con lo que hay guardado.
- Payload que envía el cliente:
  ```js
  { id_mensaje, id_pedido, id_emisor: id_cliente, id_receptor: id_cadete, remitente: 'cliente',
    texto, hora: 'HH:MM', timestamp: ISO }
  ```
  El cadete envía lo mismo con `remitente: 'cadete'`. `id_mensaje` es único (`msg_{ms}_{azar}`) y es lo que
  permite descartar repetidos: el mismo mensaje puede llegar por broadcast y por la BD.
- **`Pedidos.Chat_pedido`** (text): `JSON.stringify` de un array de esos mensajes sin `id_pedido`, ordenado por
  `timestamp`. `null` = sin mensajes. Máximo 500 caracteres por mensaje.
- **Escritura sin bloqueo:** cliente y cadete escriben la misma columna, y una escritura puede pisar a la otra.
  Por eso nadie agrega "su" mensaje a ciegas. Cada lado (`chat_pedido.js`, copiado en los dos repos):
  1. relee `Chat_pedido`, lo une por `id_mensaje` con todo lo que conoce (lo propio y lo recibido en vivo) y, solo
     si a la BD le falta algo, guarda la unión. El UPDATE lleva además `id_cliente` / `id_cadete` propio;
  2. escucha el `postgres_changes` del pedido: si trae mensajes que no tenía, los muestra (así llegan los que no
     entraron por broadcast); si a lo guardado le falta alguno que conoce, vuelve al paso 1;
  3. si recibe un mensaje en vivo, a los 4 s verifica que el emisor lo haya guardado y, si no, lo guarda;
  4. repite el paso 1 al (re)conectar el canal, al recuperar la conexión y cada 5 s (hasta 6 veces) si falló.
- El mensaje propio se marca "No enviado" solo si no salió ni por broadcast ni a la BD; se sigue reintentando.
- No leídos: mensajes del otro lado con `timestamp` posterior al último visto, que se recuerda en `localStorage`
  por pedido. Así, al reabrir el pedido se ve si hay mensajes sin leer.
- Los mensajes se muestran ordenados por `timestamp`: los propios a la derecha y los del otro a la izquierda, con la hora.
- El panel de admin (Monitor de Envíos → detalle del pedido) muestra `Chat_pedido` en solo lectura.
- **Renderizar el texto como texto plano** (`textContent` o el escape del framework). El prototipo lo inserta
  con `innerHTML`, lo que permite inyectar HTML desde el otro lado: no copiar eso.

---

## 10. Historial ("Mis Pedidos")

- Consulta: `SELECT * FROM Pedidos WHERE id_cliente = ? ORDER BY fecha_pedido DESC LIMIT 25`.
- Se refresca al abrir la pestaña, al iniciar sesión y con un botón manual.
- Cada tarjeta muestra: `#id`, fecha y hora (`es-AR`), estado, `inform_pedido`, `tipo_paquete`, total, "Efectivo".
- Etiquetas: `entregado` "Entregado", `rendido` "Entregado & Rendido", `en_camino_entrega` "En Camino",
  `asignado` "Cadete Asignado", `en_confirmacion` "Confirmando Cadete", `libre` y `pendiente` "Buscando Cadete",
  `cancelado` "Cancelado".
- Para `asignado`, `en_camino_entrega` y los de `ESTADOS_BUSQUEDA`: botón "Ver Seguimiento en Vivo" que
  relee el pedido y lo abre en Seguimiento. Si sigue en búsqueda, se ve cómo avanza (la búsqueda nunca se pausó).

---

## 11. Limpieza de recursos

- Una sola búsqueda activa y un solo canal `pedido-en-curso-*` a la vez.
- Al terminar la búsqueda (asignado / cancelado) detener el latido.
- Al cambiar de pedido en Seguimiento, quitar el canal anterior. Al cerrar sesión o desmontar la app,
  detener la búsqueda y quitar los canales.
- Al salir de la búsqueda (asignado / cancelado) o cerrar la página, detener el reloj de la cuenta regresiva.

---

## 12. Pruebas de aceptación

Con 3 a 5 sesiones de cadete (`Templates/dashboard.html?id_cad=N`) en turno:

1. Cadetes con GPS a distintas distancias del retiro: se ofrece primero al más cercano y, si rechaza, al
   siguiente más cercano; nunca a dos a la vez. El panel muestra "a {distancia} del retiro".
2. Con 5 cadetes: los 3 más cercanos rechazan (o no responden) → el 4.º intento se ofrece sin tener en cuenta la
   distancia, por `id_cad` (en `ofertas_pedido`: `por_cercania = false`).
3. Todos rechazan → `cancelado` con "Todos los cadetes rechazaron el pedido"; el que rechazó NO vuelve a
   recibir la oferta. Crear otro pedido → se vuelve a buscar por cercanía desde cero.
4. Cadete sin permiso de GPS (su latido va sin ubicación) → recibe la oferta solo después de los que tienen ubicación.
5. Un cadete `ocupado` → nunca recibe la oferta.
6. Ningún cadete en turno → `cancelado` al instante con "No hay cadetes conectados".
7. El cadete deja vencer el modal o cierra la pestaña → a los ≤20s pasa al siguiente y al primero se le cierra el modal.
8. Todos ocupados → el panel muestra la cuenta regresiva; si uno se libera, se le ofrece; si no, a los 60s
   `cancelado` con "Ningún cadete se liberó a tiempo".
9. El cadete acepta justo cuando vence el timeout → solo UNO queda con el pedido; el otro ve "ya no disponible".
10. Cambiar de pestaña en el cadete con el modal abierto → el modal y su timer siguen, sin reabrirse en loop.
11. Cerrar la app de clientes durante una búsqueda → la búsqueda sigue en el servidor; al volver a abrir el
    pedido se ve el estado actual, y a un cadete que ya rechazó no se le vuelve a ofrecer.
12. Crear un pedido mientras otro busca cadete → pide confirmación, cancela el anterior (el cadete con la oferta
    abierta ve la cancelación) y arranca el nuevo.
13. Aceptado → el panel pasa a "Cadete Asignado", muestra nombre, vehículo y patente, GPS en vivo y chat funcionando.
14. Dashboard del cadete abierto en 2 pestañas: acepta en una → la otra cierra el modal, el cadete sigue `ocupado`
    en la BD y no recibe otra oferta hasta terminar el viaje. Nunca queda con dos viajes.
15. Llega una oferta mientras el cadete confirma otra ("Aceptar" ya tocado) → se devuelve sin abrir un segundo modal.
16. El cadete cierra la pestaña con una oferta abierta y vuelve a entrar → queda `disponible` y vuelve a recibir ofertas.
17. Una pestaña vieja de la app de clientes o de cadetes (anterior al asignador del servidor) → sus escrituras
    sobre un pedido en búsqueda fallan con "La asignación de pedidos la maneja el servidor" y no alteran nada.
18. Cadete en viaje y ningún otro en turno → al cadete le aparece "Siguiente pedido" durante el viaje. Si acepta,
    el cliente ve "{nombre} está terminando otra entrega" y, al entregar el viaje, el pedido pasa solo a asignado.
19. El cadete rechaza la oferta de cola → el pedido espera (hasta 15 min); cuando ese cadete entrega y queda libre,
    se le ofrece normalmente.
20. Un cadete con un pedido en cola no recibe otra oferta de cola; el cliente cancela un pedido en cola → al cadete
    se le va el cartel y se le avisa.

---

## 13. Notificaciones push

- Web Push en Chrome para Android, sin instalar la app. iPhone sin avisos por ahora.
- `Push_suscripciones` (`endpoint` PK, `claves` jsonb, `id_cad` o `id_cliente`): un celular por fila. Tiene RLS y
  ningún permiso para `anon`/`authenticated`: las apps la tocan solo a través de la Edge Function `suscribir-push`
  (`{ accion: 'clave' | 'alta' | 'baja', suscripcion, id_cad? }`). El cliente queda identificado por su token de sesión.
- El trigger `push_pedidos` (AFTER UPDATE de `Pedidos` si cambia `estado_pedido`, `id_cadete` o `Chat_pedido`) llama
  con `pg_net` a la Edge Function `enviar-push`, que decide el aviso y lo manda. Claves VAPID y secreto del trigger en
  Vault (`push_config()`, solo `service_role`).
- Avisos: al cadete, oferta (`libre`), cancelación del cliente y mensaje del cliente; al cliente, `asignado`,
  `en_camino_entrega`, `entregado`, cancelación durante la búsqueda y mensaje del cadete. Al tocarlos abren
  `Templates/dashboard.html?id_cad=X`, `Templates/pedido_activo.html?id_cad=X&chat=1` o
  `templates/pedido_activo.html?id_pedido=N[&chat=1]`.
- El service worker (`sw.js` de cada app, parte push copiada en las dos) no muestra el aviso si esa pantalla está visible.
- Cola: la oferta a un cadete en viaje dice "Siguiente pedido"; al cliente se le avisa cuando su pedido entra en
  la cola de un cadete y cuando ese cadete termina y va a retirarlo; al cadete, cuando el pedido en cola pasa a ser su viaje.
- Si se agrega un estado, sumar su aviso en `enviar-push`.

## 14. Fuera de alcance / pendiente

Estado al 16/11/2026: 14.1 y 14.2 están implementados; el resto sigue pendiente. Las funciones de servidor son las de
push (`suscribir-push`, `enviar-push`, Supabase Edge Functions) y el asignador (funciones de Postgres).

### 14.1 Asignador de pedidos en el servidor — HECHO (15/11/2026)

- El motor de asignación se movió del navegador del cliente a la base (Postgres + pg_cron), no a Netlify:
  una función de Netlify no puede quedarse esperando los 20 s de una oferta. Ver la sección 7.
- Resuelto con el cambio: la búsqueda ya no se pausa al cerrar `pedido_activo.html`; los rechazos quedan
  guardados (`ofertas_pedido`); el cliente ya no ve el GPS de los cadetes.
- La Edge Function vieja `asignar-pedidos` se reemplazó por una vacía que responde 410 (15/11/2026). Falta
  borrarla desde el panel de Supabase (Edge Functions → asignar-pedidos → Delete).
- La carpeta `SistemaCadetes/netlify/edge-functions/` sigue vacía y no hace falta.

### 14.2 Cola de pedidos — HECHO (16/11/2026)

- Cola **por cadete**, no una fila general: el pedido se le ofrece a un cadete en viaje cuyo destino queda cerca
  del retiro nuevo, y queda `en_cola` a su nombre hasta que entrega (ver sección 7.1 y 7.3).
- Un pedido en cola por cadete; 15 minutos como máximo en la cola; 15 minutos de espera si nadie puede tomarlo.
- Sigue valiendo la regla de 7.1: el cadete NUNCA toma pedidos por su cuenta; el servidor se los ofrece de a uno.

### 14.3 Otros pendientes del servidor

- El total se calcula en el cliente. Cuando exista backend, recalcularlo del lado del servidor.
- Chat: la escritura de `Chat_pedido` es "leer, unir y guardar" desde el navegador. Con backend, pasarla a una
  función que agregue el mensaje de forma atómica.
- Dos viajes a la vez: crear el índice único `pedidos_un_viaje_activo_por_cadete` que figura en
  `docs/asignacion_por_cercania.md`. Antes, confirmar que ningún cadete tenga hoy dos pedidos en viaje.

### 14.4 Mejoras menores

- La distancia al cadete se mide en línea recta, no por calles. Evaluar una distancia por recorrido.
- Tailwind se carga por CDN; compilarlo para producción.
- Avisos push en iPhone (hoy solo Chrome para Android).

### 14.5 No portear

- Login 1-Click de demo y toggle de "simular nocturno": solo pruebas, no portear.
