# AGENTS.md / CLAUDE.md — Tierramor Ops Portal

## Sync protocol

- `AGENTS.md` and `CLAUDE.md` must stay identical. Treat them as mirrored copies of the same project context.
- At the start of every session, read this context and verify both files are in sync before making project changes.
- At the end of every session, if this context changed, apply the exact same update to both files before finishing.
- If one file exists and the other does not, create the missing file immediately using the same content.

## Tu rol

Sos el co-constructor técnico de este proyecto. Tu contraparte es Javier Abdelnour, Farm Manager de Tierramor y fundador de KATUK. Javier toma las decisiones de producto y negocio; vos ejecutás la arquitectura y el código.

Este proyecto también involucra a Nicolás, el Operations Manager de Tierramor, quien construyó la versión original del portal y lidera los equipos de Limpieza, Mantenimiento y Proveduría.

---

## Qué es este proyecto

Un **ERP operativo para la Finca de Tierramor** — el sistema de registro central para todas las operaciones de la finca. No es solo un formulario de recolección de datos: es la herramienta desde la cual cada departamento registra su trabajo, y desde la cual Javier tiene visibilidad de toda la operación.

**Notion** es la capa de visibilidad y planificación. Recibe resúmenes y KPIs desde este sistema, no datos crudos. El ERP es el sistema de registro; Notion es el portal de lectura.

---

## Repositorios

| Repo | URL | Estado |
|---|---|---|
| Original de Nicolás | https://github.com/TAops26/Ops-Portal | No tocar — referencia solamente |
| Fork de Javier (V2) | https://github.com/jabdelnour95/FarmOpsPortal | Activo — este directorio (renombrado desde Ops-Portal-V2) |

**Directorio local:** `C:\Users\jabde\OneDrive\Desktop\Master WIKI\TIERRAMOR-OS\10_OPS_OS`

Para correr el app localmente: `python -m http.server 8080` desde este directorio, luego abrir `http://localhost:8080`.

---

## Infraestructura

| Servicio | Proyecto | Región | Estado |
|---|---|---|---|
| Supabase | `tierramor-portal` | South America (São Paulo) | ✅ Activo — schema instalado |
| Cloudflare Worker | `tierramor-api` | Auto | ✅ Desplegado — `https://tierramor-api.jabdelnour95.workers.dev` |
| GitHub Pages | `jabdelnour95/FarmOpsPortal` | — | ⬜ Pendiente configurar |

**Credenciales:** guardadas en `Docs/Supabase env` (nunca commitear este archivo).

**Nota técnica — Supabase SQL Editor:** No soporta transacciones multi-statement (`BEGIN`/`ROLLBACK`). Cada statement se auto-commitea. Para limpiar datos de prueba, usar DELETEs en orden respetando FK constraints.

**Nota técnica — JWT:** Supabase proyectos nuevos emiten JWTs con algoritmo **ES256** (ECDSA P-256), no HS256. El Worker valida via JWKS (`/auth/v1/.well-known/jwks.json`). El payload del JWT incluye `role: "authenticated"` (rol de Supabase), no el rol de la app — el Worker fetchea el rol real de la tabla `profiles` en cada request autenticado.

---

## Arquitectura (decisiones confirmadas)

| Capa | Tecnología | Razón |
|---|---|---|
| Frontend | Vanilla JS, ES modules, HTML/CSS | Sin dependencias, corre en GitHub Pages |
| Base de datos | Supabase (PostgreSQL) | Soporta datos relacionales (Food Production, Biofactory) que Notion no puede modelar bien |
| Proxy / API layer | Cloudflare Workers | Oculta las keys de Supabase del frontend; punto único de cambio si se migra de backend |
| Fotos | Google Drive (vía Worker) | Ya integrado en flujo de trabajo del equipo |
| Reportes / KPIs | Notion (push periódico desde Supabase) | Notion es visibilidad y planificación, no base de datos |

**Por qué no Google Sheets:** Problemas de escritura concurrente, no soporta datos relacionales, capa extra entre el app y Notion.

**Por qué no Notion como DB:** No puede modelar Food Production (camas → siembras → cosechas) ni Biofactory (inventario transaccional). Funciona bien solo para registros planos.

---

## Estructura de archivos

```
10_OPS_OS/
├── index.html                  ← Shell del app (pantallas + estilos inline + <script type="module">)
├── css/
│   └── styles.css
├── worker/
│   ├── worker.js               ← Cloudflare Worker (proxy Supabase + Google Drive)
│   ├── wrangler.toml           ← Config de deploy
│   ├── .dev.vars.example       ← Template de variables de entorno
│   └── .gitignore              ← Excluye .dev.vars y .wrangler/
├── js/
│   ├── app.js                  ← Entry point: importa todo y expone al window
│   ├── data/
│   │   ├── users.js            ← Lista de colaboradores por equipo (referencia, no auth)
│   │   ├── departments.js      ← Config de departamentos Ops (DEPTS, CAL_IDS, CAL_LABELS)
│   │   ├── checklists-limpieza.js
│   │   └── checklists-manto.js
│   └── modules/
│       ├── state.js            ← Estado global: currentUser, accessToken, currentDept, deptParent
│       ├── auth.js             ← Login / logout / restoreSession (conectado al Worker)
│       ├── navigation.js       ← Navegación + renderHome + galería de departamentos
│       ├── inventory.js        ← Inventarios de Limpieza
│       ├── photos.js           ← Upload y preview de fotos
│       ├── audio.js            ← Dictado de voz (Web Speech API, es-CR)
│       ├── checklists.js       ← Lógica de checklists
│       ├── forms.js            ← Formularios de reportes Ops
│       ├── manuals.js          ← Manuales de Limpieza y Mantenimiento
│       ├── reports.js          ← Vista de reportes (Admin)
│       ├── food.js             ← Módulo Producción de Alimentos — 6 formularios completos
│       └── bio.js              ← Módulo Biofábrica — entradas, lotes, salidas, inventarios
```

---

## Estado actual

### Completado
- [x] Reestructuración del app original: 1 archivo monolítico (95KB) → módulos ES
- [x] App corriendo localmente sin errores
- [x] Repositorio fork configurado y código pusheado
- [x] Flujos de departamentos Phase 1 mapeados (Producción de Alimentos, Biofábrica, Vivero)
- [x] PRD Phase 1 escrito y commiteado (`PRD.md`) — 63 historias de usuario, 6 departamentos
- [x] **TDD escrito** — `Docs/TDD.md` — schema completo, API del Worker, auth, decisiones de diseño
- [x] **Proyecto Supabase creado** — región São Paulo, plan free, proyecto `tierramor-portal`
- [x] **Schema implementado en Supabase** — 47 tablas, 5 vistas, 13 triggers, 13 funciones
- [x] **Usuario admin creado** — jabdelnour95@gmail.com, rol admin
- [x] **Triggers verificados** — generación de IDs (PROD/BIO/VIV/GRP/SUB) y facturas automáticas funcionando
- [x] **Cloudflare Worker desplegado** — `https://tierramor-api.jabdelnour95.workers.dev` — todas las rutas del TDD, ES256 JWT, rol fetcheado de `profiles`; fotos pendiente Google Drive
- [x] **Secrets cargados en Cloudflare** — SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_JWT_SECRET
- [x] **Worker verificado en producción** — login, JWT validation, catálogos e inventario respondiendo con datos reales
- [x] **Supabase Auth en el frontend** — `auth.js` conectado al Worker, JWT en localStorage, `restoreSession()` al cargar
- [x] **Dashboard principal rediseñado** — galería de tiles por área (Finca, Operaciones, Cocina, Experiencias), visibilidad por rol y `profile.departments`
- [x] **Arquitectura de navegación por niveles** — home → sub-galería (finca-home / ops-home) → módulo; botón Atrás rastreado via `state.deptParent`
- [x] **Reportes movidos a cada sub-galería** — tile Admin-only dentro de Finca y Operaciones (no en el home principal)
- [x] **Módulo Producción de Alimentos construido** — `js/modules/food.js` — pantalla `#food-screen` con galería de 6 formularios activos
- [x] **Worker actualizado** — `CATALOG_ORDER` para ordenar camas por `code.asc`; handler especial para `POST /food/availability` con items en cascada; `POST /catalog/crops` permitido para no-admins; `GET /api/farm-workers` para dropdown de participantes — Version ID `69f598de-efca-48ef-98c8-adbeb52b206e`
- [x] **Cosecha: trazabilidad por área + cama (ya no por canasta)** — `bed_id` obligatorio en el form y en el payload; columna `bed_id uuid NOT NULL` agregada a `harvests` en Supabase (datos de prueba viejos borrados primero por la FK con `internal_invoices_food`)
- [x] **Aplicar Insumos: ingrediente activo vs. líquido total** — columna `total_liquid_quantity` agregada a `input_application_items`; UI con dos campos por insumo (D-010)
- [x] **Tabla real de cosechas confirmada: `harvests`** (no `harvest_records`) — corregido el mapping en `FOOD_TABLE` (`worker/worker.js:382`) y redesplegado — Version ID `d152fa42-f19a-4cdf-998f-dd18bbc41317`
- [x] **Mapping de `plantings` corregido** — confirmado contra el schema real de Supabase (PostgREST OpenAPI) que la tabla es `plantings` (no `food_production_lots`, que no existe); también corregido `order=planting_date.desc` → `order=date.desc` (la columna real es `date`). El payload de `food.js` (date, bed_id, crop_id, quantity_density, performed_by, created_by, observations) coincide con las columnas de la tabla. Corregido `worker.js:414-422` y redesplegado — Version ID `a9494e35-706e-43bd-8e90-144d9e58bc9a`
- [x] **Mapping de `invoices` corregido** — confirmado que la tabla real es `internal_invoices_food` (no `food_invoices`, que no existe). Corregido en `FOOD_TABLE` (`worker/worker.js:383`) y redesplegado junto con el fix de `plantings`
- [x] **Botón "Agregar otro registro"** en el mensaje de éxito de los 6 formularios de Producción de Alimentos — reabre el mismo formulario limpio (`openFoodForm(type)`) sin volver a la galería
- [x] **Unidad de medida auto-completada en insumos biológicos** (Preparar Cama / Aplicar Insumos) — al elegir un bioinsumo del dropdown, se muestra su `bio_finished_products.unit` junto al campo de cantidad (`window._foodBioUnit(i)`)
- [x] **Aplicar Insumos: campo "Líquido total aplicado" condicional** — sólo se muestra cuando el bioinsumo elegido se mide en `L` (líquido diluido en agua); se oculta y limpia automáticamente para insumos en `kg`/`Saco`
- [x] **Mantenimiento de Área: múltiples camas + round-trip correcto en edición admin** — el form ahora soporta "Camas específicas" con filas dinámicas (`_maintBedRows`); status, camas y participantes se serializan/deserializan con `js/modules/food-maintenance-meta.mjs` para que al editar un registro no reaparezcan en `Observaciones` ni se pierda el estado `pending`. Se agregó regresión en `tests/food-maintenance-meta.test.mjs`.
- [x] **Sistema de tareas asignadas implementado y desplegado en Supabase** — nuevo módulo frontend `js/modules/tasks.js` + API `/api/tasks` en `worker/worker.js`; admins pueden asignar la misma tarea a una o más cuentas no-admin con módulo, formulario, fecha límite y recurrencia (`none` / `weekly` / `biweekly` / `monthly`). Cada responsable recibe una instancia independiente: al completar el formulario asignado, solo su tarea se marca como completada y, si aplica, genera su próxima recurrencia. Usuarios no-admin ven sus pendientes en el dashboard. La migración está en `Docs/task_assignments.sql` y las utilidades/validaciones en `worker/task-utils.mjs` con regresión en `tests/task-utils.test.mjs`.
- [x] **Gestión admin de tareas asignadas** — el Centro de Tareas permite editar cualquier tarea pendiente (título, descripción, responsable, módulo/formulario, fecha y recurrencia) o eliminar tareas pendientes y completadas con confirmación. La eliminación conserva una recurrencia futura ya creada al desvincularla de la tarea eliminada; las completadas no se editan para proteger su trazabilidad.
- [x] **Módulo Biofábrica construido** — `js/modules/bio.js` — pantalla `#bio-screen` con 4 formularios (Entrada de Materia Prima, Abrir Lote, Cerrar Lote, Registrar Salida) + 2 vistas de inventario de solo lectura (materias primas con alertas de stock mínimo, producto terminado). El backend (`handleBio()` en `worker.js`) ya estaba completo de una sesión anterior; este trabajo fue principalmente frontend.
- [x] **Dos bugs corregidos en `handleBio()`** — (1) `outputs` consultaba la tabla `bio_product_outputs`, que no existe; la tabla real es `bio_finished_product_outputs` (`worker.js:571,575`). (2) La validación de stock al cerrar lote (`PATCH /api/bio/batches/:id/close`, D-001) filtraba/seleccionaba columnas inexistentes (`raw_material_id`, `available_quantity`) en la vista `v_bio_raw_material_stock`; las columnas reales son `id` y `current_stock` (`worker.js:539,550`) — sin este fix, la advertencia de stock insuficiente nunca funcionaba. Redesplegado — Version ID `22641729-730d-41d0-aadb-0ae25184adc5`.
- [x] **Cerrar Lote de Producción: flujo en dos pasos** — `openBioBatchPicker()` lista los lotes `in_progress` (filtrado client-side desde `GET /api/bio/batches`, sin endpoint nuevo); al elegir uno, `_openBioCloseForm(batch)` reemplaza el contenido de `#fbody` con el formulario de cierre. La respuesta de `/close` (`{ warning, items, batch }`) muestra un aviso ámbar no bloqueante si el stock de materias primas es insuficiente (D-001).
- [x] **Responsable de Biofábrica vía dropdown, no texto libre** — `performed_by`/`responsible_id` son `uuid REFERENCES profiles(id)` en el schema, a diferencia del patrón de "Participantes" en texto libre de `food.js`. El dropdown (`_performedByOpts()`) se alimenta de `farm_workers` filtrado a filas con `profile_id` no nulo, con fallback automático a "[Tu nombre] (yo)" si el usuario logueado todavía no está vinculado.
- [x] **`farm_workers.profile_id` agregado en Supabase** (Javier corrió el `ALTER TABLE ... ADD COLUMN profile_id uuid REFERENCES profiles(id)`) y vinculado para el perfil de Javier. Pendiente vincular al resto del equipo cuando tengan login real (ver Próximos pasos).
- [x] **Catálogo `bio_raw_materials`: creación inline admin-only** — opción "── Nueva materia prima ──" en el dropdown de Entrada, visible solo si `profile.role === 'admin'` (el catálogo de materias primas estaba vacío; `bio_finished_products` ya tenía 31 ítems poblados de antes).
- [x] **Tile de Biofábrica activado en `finca-home`** — `onclick="openBio()"` directo (mismo patrón que `openFood()`, evita dependencia circular), badge cambiado de "En construcción" a "Activo".
- [x] **Probado end-to-end con login real** — entrada de materia prima, apertura y cierre de lote (`BIO-2026-0001`), registro de salida interna y externa, inventarios de materias primas y producto terminado — todo contra el Worker y Supabase de producción.
- [x] **Ajustes de UX post-testing** — label "Costo (₡)" en Entrada; unidad de medida auto-mostrada junto a "Cantidad obtenida" en Cerrar Lote (tomada de `bio_finished_products.unit` del lote); en Registrar Salida, stock disponible mostrado automáticamente al elegir el producto (`GET /api/inventory/bio-finished`, cacheado por apertura de formulario) y campo "Notas" agregado (requiere columna `observations` en `bio_finished_product_outputs`, agregada por Javier vía `ALTER TABLE`).
- [x] **Discovery de Vivero ya estaba hecho** — encontrado `Workflows/workflow_vivero_en.html` (sin trackear en git, generado 2026-06-09), diagrama Mermaid completo de 4 fases (entradas de materia prima → sustrato/llenado de contenedores → ciclo de vida del lote → salidas/ventas), mismo patrón que `workflow_biofabrica_en.html`. El TDD (`Docs/TDD.md` sección 3.5) y el backend del Worker (`handleNursery()`) también ya existían de una sesión anterior que nunca se reflejó en este archivo.
- [x] **Bugs de mapping de tablas corregidos en `handleNursery()`** — el Worker usaba nombres de tabla inventados (`nursery_lots`, `nursery_substrate_batches`, `nursery_graduations`, etc.) que nunca existieron en Supabase; confirmado contra el schema real (PostgREST OpenAPI) que las tablas reales son `plant_lots`, `substrate_batches`, `germination_tracking`, `establishment_counts`, `lot_maintenance`, `plant_counts`, `lot_graduations`, `plant_lot_outputs`, `quotations`, `quotation_items`, `container_fills`. También se corrigieron columnas de orden (`date_started`→`date_start`, `tracking_date`/`count_date`/`graduation_date`/`output_date`→`date`) y se agregó la cascada de `quotation_items` en el POST de cotizaciones (no existía). Redesplegado — Version ID `9c184eb3-67c0-4c9e-89cc-7119b5c2d009`.
- [x] **Módulo Vivero construido** — `js/modules/nursery.js` (pantalla `#nursery-screen`) — Materias Primas y Sustrato (Entrada de MP, Preparar Sustrato, Llenar Bolsas/Macetas), Lotes de Plantas (Crear Lote, Gestionar Lote con picker + detalle + sub-acciones condicionadas por estado: seguimiento de germinación, conteo de establecimiento, mantenimiento, conteo de plantas vivas, graduación, salida), Cotizaciones (nueva cotización con ítems multi-línea, ver cotizaciones con aceptar/rechazar), 3 inventarios de solo lectura (materias primas, sustratos, contenedores). Tile de Vivero activado en `finca-home` (`onclick="openVivero()"`, badge "Activo").
- [x] **Patrón de trazabilidad por entrada específica en sustrato** — a diferencia de Biofábrica (que descuenta de `bio_raw_materials` genérico), `substrate_batch_components.raw_material_entry_id` referencia una entrada específica de `nursery_raw_material_entries` (un "grupo" recibido en una fecha). El formulario de Preparar Sustrato pide primero la materia prima y luego, en cascada, la entrada específica a descontar (`group_id` + fecha + cantidad recibida).

### Próximos pasos (en orden)
- [x] **Tabla `farm_workers` creada en Supabase** — activa con datos del equipo.
- [x] **Participantes: multi-select dropdown implementado** — Worker con `GET /api/farm-workers`; `_workersField()` en food.js; `_getParticipants()` para el submit; los nombres van al campo `observations` como "Participantes: Ana, Carlos"
- [x] **Tablas `crops` y `productive_areas` pobladas** desde Google Sheets "Tierramor_FincaOS_BD" (hojas DB_Cultivos y DB_Areas) — 81 cultivos, 10 áreas. Filas `_TEST_` borradas primero. `productive_areas.type` constraint ampliado a `CHECK (type IN ('annual','agroforestry','animal_production'))` (Javier corrió el ALTER en Supabase) para poder clasificar Gallinas como producción animal. Clasificación de áreas: Milpa/Loma Pitahayas/Huerta/Vivero Greens → `annual`; SAF Canelo/SAF Ojoche/SAF Basecamp/Paisajismo/Finca → `agroforestry`; Gallinas → `animal_production`.
- [x] **10 camas de prueba creadas en SAF Basecamp** (`SAFBC-01` a `SAFBC-10`) — temporal, solo para destrabar el test de Registrar Siembra mientras se consigue el dato real de camas por área (no está en el Google Sheets actual). Reemplazar/expandir cuando Javier tenga el catastro completo de camas.
- [ ] **Probar Registrar Siembra end-to-end** en el app (login real, no las credenciales legacy) — ya hay `crops`, `productive_areas` y camas de prueba en SAF Basecamp para hacerlo.
- [ ] **Poblar `beds` reales para el resto de las áreas** — pendiente, falta el dato fuente.
- [x] **Tabla `bio_finished_products` poblada** — 31 bioinsumos desde Google Drive "Biofactory Financials.xlsx" (hoja "Unit Economics"), usando `Sell Price` (USD, sin convertir a colones) como `internal_price`. `internal_price` se cambió a nullable (`ALTER COLUMN ... DROP NOT NULL`, corrido por Javier) porque 5 productos no tienen precio de venta definido aún: Supermagro con boñiga, Caldo Bordelés, Sílico Sulfo Cúprico, Protector zinc, Repelente de insectos — insertados activos con `internal_price: null`, completar cuando se definan precios. Se excluyó la fila "Biol Promedio" (no es un producto real, es un agregado de la hoja).
- [ ] **Vincular `farm_workers.profile_id` para el resto del equipo** (Kennedy, etc.) cuando tengan login real en Supabase — hasta entonces, el dropdown de "Responsable" en Biofábrica solo ofrece al usuario logueado.
- [ ] **Poblar `bio_raw_materials`** — catálogo vacío; se puede ir poblando desde el formulario de Entrada (opción admin-only "Nueva materia prima") o por lote vía Supabase si Javier consigue una fuente de datos.
- [ ] **Poblar catálogos de Vivero — bloqueante para poder probar el módulo** — `nursery_species`, `nursery_price_categories`, `nursery_raw_materials`, `substrate_types`, `container_types` están todas vacías (0 filas, confirmado contra Supabase). Sin esto los dropdowns del módulo no tienen opciones. `nursery_raw_materials` se puede poblar desde el formulario de Entrada (admin-only), pero especies, categorías de precio, tipos de sustrato y tipos de contenedor no tienen creación inline — hay que cargarlas directo en Supabase o agregar esa opción al frontend.
- [ ] **Probar Módulo Vivero end-to-end** con login real una vez poblados los catálogos — entrada de MP, preparar sustrato, llenado de contenedores, ciclo completo de un lote (crear → germinación → establecimiento → mantenimiento/conteos → graduación → salida), cotización.
- [ ] **Implementar RLS policies en Supabase** — control de acceso por rol y departamento (antes del go-live)
- [ ] **Crear usuarios de Supabase para el equipo** — justo antes del go-live, cuando los módulos estén listos
- [ ] **Implementar upload de fotos** — Google Drive via service account (ver TODO en `worker/worker.js:handlePhotos`)
- [ ] **Configurar GitHub Pages** — para deploy del frontend
- [x] **Migración `Docs/task_assignments.sql` aplicada en Supabase** — la tabla `assigned_tasks` está activa.
- [ ] **Expandir el sistema de tareas asignadas** — faltan edición/cancelación admin, vistas más robustas de historial, y decidir si la versión final usa solo `assigned_tasks` o si conviene separar plantillas (`task_templates`) de instancias.
- [ ] **Seguimiento de Siembra por lote** — migración `Docs/planting_lot_tracking.sql` aplicada en Supabase e implementación desplegada (commit `8f6bfa8`, Worker Version ID `715625cf-525a-473e-8302-f74e3de22628`). Una cama puede tener múltiples lotes activos; `Seguimiento de Siembra` tiene conteo de establecimiento único (objetivo por defecto a +21 días, editable al crear por el trabajador y luego por admin), incidencias/seguimientos opcionales y cierre explícito (`closed`/`lost`). Los trabajadores usan formularios y selectores Área → Subárea → Cama → lote activo (cultivo + Lot ID), mientras que el detalle, historial y métricas son admin-only. Aplicar Insumos y Mantenimiento detectan automáticamente los lotes activos de los targets registrados; costos por lote son estimados con reparto igual inicial, nunca presentados como exactos. Pendiente prueba end-to-end con login real.

---

## Departamentos

### Farm Portal — Fase 1 (este proyecto)
| Departamento | Estado en portal | Flujo mapeado | Schema Supabase |
|---|---|---|---|
| Producción de Alimentos | ✅ Activo — 6 formularios en `#food-screen` | ✅ | ✅ En Supabase |
| Biofábrica | ✅ Activo — 4 formularios + 2 inventarios en `#bio-screen` | ✅ | ✅ En Supabase |
| Vivero | ✅ Activo — formularios + 3 inventarios en `#nursery-screen` (catálogos vacíos, ver Próximos pasos) | ✅ | ✅ En Supabase |

### Ops Portal — Proyecto separado (Nicolás Salas)
Limpieza, Mantenimiento y Proveduría. Stack independiente (Google Sheets como backend).
Integración con Farm Portal diferida a Fase 2.

### Fase 2 — Pendiente
Integración Farm Portal ↔ Ops Portal + departamentos nuevos (Cocina, Experiences, F&B, Marketing, Finanzas, Gallinas).
Cada departamento nuevo requiere una sesión de discovery de 20–30 min antes de diseñar su módulo.

---

## Arquitectura de navegación (frontend)

### Pantallas y flujo

```
#ls (login)
  └─→ #home (galería principal)
        ├─→ #finca-home (sub-galería Finca)
        │     ├─→ #food-screen (Producción de Alimentos) ← openFood() directo en onclick
        │     │     ├─→ form: prep-cama
        │     │     ├─→ form: siembra
        │     │     ├─→ form: aplic-insumos
        │     │     ├─→ form: mantenimiento
        │     │     ├─→ form: disponibilidad
        │     │     └─→ form: cosecha
        │     ├─→ #bio-screen (Biofábrica) ← openBio() directo en onclick
        │     │     ├─→ form: entrada
        │     │     ├─→ form: abrir-lote
        │     │     ├─→ openBioBatchPicker() → form: cerrar-lote (dos pasos en #fs)
        │     │     ├─→ form: salida
        │     │     ├─→ inventario: materias primas (solo lectura)
        │     │     └─→ inventario: producto terminado (solo lectura)
        │     ├─→ #nursery-screen (Vivero) ← openVivero() directo en onclick
        │     │     ├─→ form: entrada / sustrato / llenado
        │     │     ├─→ form: crear-lote
        │     │     ├─→ openNurseryLotPicker() → detalle de lote → sub-acciones (dos+ pasos en #fs):
        │     │     │     germination-tracking · establishment-count · maintenance · plant-counts · graduations · outputs
        │     │     ├─→ openNurseryQuoteForm() / openNurseryQuotes() (aceptar/rechazar)
        │     │     └─→ inventario: materias primas / sustratos / contenedores (solo lectura)
        │     └─→ Reportes (admin)         [placeholder → #con-screen]
        ├─→ #ops-home (sub-galería Operaciones)
        │     ├─→ #dept (Limpieza)
        │     ├─→ #dept (Mantenimiento)
        │     ├─→ #dept (Proveduría)
        │     └─→ #rep-screen (Reportes, admin)
        ├─→ Cocina       [tile deshabilitado — Próximamente]
        └─→ Experiencias [tile deshabilitado — Próximamente]
```

**Nota:** El tile de Producción de Alimentos en `finca-home` llama `openFood()` directamente (no `openFincaModule('produccion')`). Esto evita una dependencia circular entre `navigation.js` y `food.js`. El tile de Biofábrica sigue el mismo patrón con `openBio()`.

### Visibilidad de tiles por rol

La función `renderHome()` en `navigation.js` filtra los tiles del home usando `canSeeTile()`:
- `profile.role === 'admin'` → ve todo
- Otros roles → ve solo los tiles donde `profile.departments[]` contiene al menos un `deptKey` del tile

El Worker retorna en el login: `user.profile.{ full_name, role, departments[] }`.

Tiles de Reportes dentro de sub-galerías: visibilidad admin-only gestionada por `_toggleAdminTiles(screenId)`, llamada automáticamente desde `show()` al mostrar `finca-home` u `ops-home`.

### Navegación de botón Atrás

`state.deptParent` registra desde dónde se abrió `#dept`. `navBackDept()` lo usa para volver al screen correcto (siempre `ops-home` en la arquitectura actual). Esto evita hardcodear `nav('home')` en el back button del dept screen.

---

## Decisiones de diseño confirmadas

Documentadas en detalle en `Docs/TDD.md` sección 9. Resumen:

| # | Decisión | Resolución |
|---|---|---|
| D-001 | Stock insuficiente al cerrar lote de Biofábrica | Solo advertir, no bloquear |
| D-002 | Upload de fotos a Google Drive | Via Cloudflare Worker (service account oculta) |
| D-003 | Pedidos de cocina por semana | Múltiples permitidos (campo `label` opcional) |
| D-004 | Inventario de contenedores del Vivero | Por tipo de contenedor, no por batch |
| D-005 | Participantes en formularios de Producción | Multi-select dropdown desde tabla `farm_workers`; temporalmente texto libre en `observations` |
| D-006 | Cosecha: trazabilidad por área/cama (revisado — ya no por canasta) | Una fila por combinación cultivo + área + cama. Las canastas se manejan operativamente en campo, no en el app. Un registro en `harvest_records` por fila; `bed_id` ahora obligatorio. |
| D-007 | Preparar Cama con múltiples camas | Filas dinámicas; un `bed_preparations` record por cama via `Promise.all()` |
| D-008 | Scope de Aplicar Insumos / Mantenimiento | Toggle "área completa" vs "camas específicas" — cambia la UI sin cambiar el schema |
| D-009 | Ordenamiento de camas en catálogo | `code.asc` (no `name.asc`) — corregido en Worker via `CATALOG_ORDER` map |
| D-010 | Aplicar Insumos: ingrediente activo vs. líquido total | Se registran ambos por insumo: `quantity` (ingrediente activo, lo que descuenta inventario de Biofábrica) y `total_liquid_quantity` (volumen total aplicado en campo, solo informativo) |

### Patrones de `food.js`

- **Estado de módulo:** `_cats` (catálogos cacheados), `_plantings`, filas dinámicas por formulario (`_prepBedRows`, `_harvestRows`, etc.), `_applyScope` / `_maintScope` para toggles.
- **`_loadCats()`:** Fetcha `beds`, `crops`, `areas`, `bio` en paralelo con `Promise.all()`. Se cachea en `_cats` para el resto de la sesión.
- **`_bedOptsByArea(areaId)`:** Filtra `_cats.beds` client-side. No hace llamadas al Worker — las camas ya están en caché.
- **Window bindings:** `_fic` / `_fac` (add/remove input rows), `_fpb` / `_fab` (prep/apply bed rows), `_fhr` (harvest rows), `_foodFilterBeds`, `_foodApplyScope`, `_foodMaintScope`, `_foodNewCropToggle`, `_foodHarvestUnit`, `_foodAvailUnit`, `_foodBioUnit`, `_foodApplyScopeAreaChanged`.
- **Mantenimiento: scope por área o múltiples camas específicas** — `window._foodMaintAreaChanged()` / `window._foodMaintScopeAreaChanged()` alimentan `_maintBedRows`; el schema sigue siendo `area_maintenance` a nivel de área, así que la trazabilidad de camas, participantes y `pending/completed` se guarda en `observations` usando `buildMaintenanceObservations()` y se rehidrata al editar con `parseMaintenanceObservations()`.
- **Tareas asignadas → formularios de Finca:** `openFoodForm(type, record, task)` muestra un banner contextual si la apertura viene desde una tarea; al guardar un registro nuevo se llama `completeActiveTaskAssignment()` y la tarea queda completada automáticamente usando el `recordId` del POST. El mismo patrón ya existe también en `bio.js` y `nursery.js`.
- **`_foodBioUnit(i)`:** auto-completa la unidad de `bio_finished_products` en las filas de insumos (Preparar Cama / Aplicar Insumos) y, en Aplicar Insumos, muestra/oculta el campo "Líquido total aplicado" (`fi-liq-wrap-${i}`) según si la unidad es `L`; limpia el valor al ocultarlo para no enviar datos obsoletos.
- **Submit multi-registro:** `Promise.all(rows.map(row => _api(...)))` — una llamada al Worker por fila.

### Patrones de `bio.js`

- **Estado de módulo:** `_cats` (`{ rawMaterials, finishedProducts, workers }`), `_batches` (cache de `GET /api/bio/batches`), `_batchInputRows` (filas de Abrir Lote), `_closingBatch` (lote elegido en el picker de Cerrar Lote), `_finishedStockCache` (stock de producto terminado, refrescado cada vez que se abre Registrar Salida).
- **Sin catálogo de geografía:** a diferencia de `food.js`, Biofábrica no necesita `beds`/`areas`/`crops` — es autocontenido.
- **`_performedByOpts()` / `_selectPerformedByDefault()`:** dropdown de responsable sobre `farm_workers` filtrado a `profile_id` no nulo; si el usuario logueado no está en esa lista, se agrega una opción "[nombre] (yo)" con su propio `id` para no dejar el formulario sin opciones válidas. `created_by` siempre es el usuario logueado (autoría real de quien registra); `performed_by`/`responsible_id` es lo que elige el dropdown (quien ejecutó la tarea).
- **Cascada de lote:** `abrir-lote` hace un solo `POST /api/bio/batches` con `inputs: [...]` (el Worker crea el lote y las filas de `bio_production_batch_inputs` en cascada) — a diferencia de `prep-cama` en `food.js`, que hace `Promise.all` de un POST por fila porque cada fila es una cama distinta; aquí todas las filas pertenecen a un solo lote.
- **Cerrar Lote (dos pasos sin `FORMS[type]`):** `openBioBatchPicker()` lista lotes `in_progress`; `_openBioCloseForm(batch)` reemplaza `#fbody` con el formulario real. No usa el objeto `FORMS` porque el batch elegido es estado de navegación, no una definición estática de formulario.
- **Creación inline de catálogo admin-only:** mismo patrón `__new__` que `_cropOpts()` en `food.js`, pero condicionado a `state.currentUser?.profile?.role === 'admin'` porque `handleCatalogs()` en el Worker solo permite POST de no-admins sobre `crops` (no sobre `bio-raw-materials`).

### Patrones de `nursery.js`

- **Estado de módulo:** `_cats` (`{ species, priceCategories, rawMaterials, substrateTypes, containerTypes, bioProducts, workers }`), `_entriesCache` (`GET /api/nursery/raw-material-entries`, cargado solo al abrir 'sustrato'), `_substrateBatchesCache` (cargado solo al abrir 'llenado'), `_lotsCache` (`GET /api/nursery/lots`, refrescado en cada apertura de picker/cotización), `_activeLot` / `_activeLotDetail` (lote elegido en Gestionar Lote + su detalle completo).
- **Trazabilidad por entrada específica (a diferencia de Biofábrica):** `substrate_batch_components.raw_material_entry_id` referencia una entrada concreta de `nursery_raw_material_entries` (un grupo recibido en una fecha), no la materia prima genérica. El form de Preparar Sustrato pide primero la materia prima y luego, en cascada (`window._nurMatChanged`), la entrada específica a descontar — patrón nuevo, no existe en `food.js`/`bio.js`.
- **Gestionar Lote (picker → detalle → sub-formularios, tres niveles dentro de `#fs`):** `openNurseryLotPicker()` lista todos los lotes; `_openNurseryLotDetail(lot)` hace `GET /api/nursery/lots/:id` y muestra botones de sub-acción condicionados por estado (`germination-tracking`/`establishment-count` solo si `status === 'germination'`; `maintenance`/`plant-counts`/`graduations`/`outputs` solo si no); `_openNurseryLotSubForm(action)` reemplaza `#fbody` con el formulario específico y su botón "Atrás" vuelve al detalle del lote (no a la galería) vía `_openNurseryLotDetail(_activeLot)`, re-fetcheando para reflejar el nuevo estado tras un conteo de establecimiento.
- **`lot_id`/`status` nunca se envían en `crear-lote`:** ambos los setea un trigger en Supabase (`fn_init_plant_lot`) — el Worker simplemente postea `species_id, origin, date_start, initial_quantity, ...` y el trigger genera `VIV-YYYY-NNNN` y decide si el lote arranca en `germination` (semilla/esqueje) o `active` (compra/repique).
- **Repique (`origin === 'repoting'`, sic — no "repotting"):** el CHECK constraint de Supabase usa el string `'repoting'` tal cual; al elegir el lote de origen (`f-repoting-source`), `window._nurRepotingSourceChanged()` autocompleta y deshabilita el dropdown de especie porque el lote repicado hereda la especie del lote fuente.
- **Cotización con ítems multi-línea:** mismo patrón de filas dinámicas que `food.js`/`bio.js`, pero con cascada de 3 niveles por fila (especie → categoría de precio → lote) — elegir especie repuebla categorías de precio y lotes disponibles de esa especie; elegir categoría autocompleta `base_unit_price` y `adjusted_unit_price` (editable, para descuentos/premiums por cliente); el subtotal se recalcula en cada input. El Worker crea la cotización y sus `quotation_items` en cascada (mismo patrón que `abrir-lote` en `bio.js`).
- **Catálogos sin creación inline (a diferencia de `bio-raw-materials`):** solo `nursery-raw-materials` tiene la opción `__new__` admin-only en el dropdown. Especies, categorías de precio, tipos de sustrato y tipos de contenedor no la tienen — hay que cargarlas directo en Supabase (ver Próximos pasos: catálogos de Vivero vacíos).

---

## Convenciones del proyecto

- **Idioma del UI:** Español latino. Todo lo que ve el usuario va en español.
- **Idioma del código:** Inglés (variables, funciones, comentarios).
- **Sin frameworks:** Vanilla JS únicamente. Sin React, Vue, ni bundlers.
- **Sin comentarios obvios:** Solo comentar el "por qué", nunca el "qué".
- **ES modules:** Toda función nueva va en su módulo correspondiente, exportada e importada en `app.js`.
- **Un módulo por responsabilidad:** No mezclar lógica de UI con lógica de datos.
- **TODO comments:** Usar `// TODO: [descripción]` para marcar integraciones pendientes con el backend.

---

## Credenciales de prueba (temporales)

| Usuario | Contraseña | Rol |
|---|---|---|
| admin | tierramor2024 | Administrador |
| rol1 | rol1pass | Limpieza |
| manto1 | manto123 | Mantenimiento |

⚠️ Estas credenciales son temporales y serán reemplazadas por Supabase Auth.
