# StockFlow — Gestión de inventario y operación de almacén

Aplicación web para administrar inventario de calzado deportivo, operaciones de almacén, órdenes de entrada y salida, compras de clientes, tickets de soporte y trazabilidad de entregas.

El proyecto usa **HTML, CSS y JavaScript puro** en el frontend, conectado directamente a **Supabase** para autenticación, base de datos, funciones RPC y políticas de seguridad.

## Objetivo

Digitalizar la operación de un almacén: conocer el stock disponible, ubicar productos físicamente, controlar movimientos, preparar pedidos, aprobar compras y conservar una bitácora de las acciones realizadas.

## Tecnologías

| Tecnología | Uso |
| --- | --- |
| HTML5 | Estructura de pantallas, formularios, tablas y diálogos. |
| CSS3 | Diseño responsive con paneles, menú lateral, tarjetas y estilos neón. |
| JavaScript | Lógica del frontend, filtros, validaciones y llamadas a Supabase. |
| Supabase Auth | Inicio de sesión, creación de cuentas y manejo de sesión. |
| Supabase PostgreSQL | Datos de inventario, órdenes, tickets, racks, posiciones y auditoría. |
| Supabase RPC | Operaciones críticas y seguras, como aprobar movimientos, preparar pedidos y validar PIN. |

## Arquitectura

```text
Usuario
  │
  ▼
Frontend estático (HTML + CSS + JavaScript)
  │  Supabase Client / RPC
  ▼
Supabase
  ├── Auth: usuarios y sesión
  ├── PostgreSQL: tablas y relaciones
  ├── RLS: permisos por rol
  └── Functions/RPC: reglas de negocio atómicas
```

La lógica sensible se mantiene en funciones de Supabase. Por ejemplo, el stock se modifica al aprobar un movimiento desde una RPC, no desde el navegador de manera directa.

## Roles del sistema

| Rol | Capacidades principales |
| --- | --- |
| Cliente | Ver catálogo con stock real, crear compras, elegir preferencia de retiro, ver ubicación, conversar por chat, revisar tickets y usar PIN de retiro. |
| Operador | Revisar solicitudes, preparar pedidos, asignar posición física, responder tickets y validar PIN de retiro. |
| Administrador | Acceso completo: dashboard, resumen, inventario, movimientos, almacén, compras, tickets, ubicación de productos, bitácora y validación de PIN. |

## Modelo de datos

### Tablas principales solicitadas

| Tabla | Propósito |
| --- | --- |
| `inventory_items` | Datos maestros: SKU, nombre, categoría, dimensiones, costo, precio y proveedor. |
| `inventory` | Stock actual, mínimo, máximo, ubicación y posición física del artículo. |
| `inventory_movements` | Órdenes INBOUND, OUTBOUND y ajustes, con cantidad, motivo, estado y aprobación. |

Relación central:

```text
inventory_items (1) ── (1) inventory (1) ── (N) inventory_movements
```

### Tablas complementarias

| Tabla | Propósito |
| --- | --- |
| `profiles` | Perfil de cada usuario y rol (`cliente`, `operador`, `administrador`). |
| `warehouses` | Almacenes con nombre y dirección. |
| `racks` | Racks asociados a un almacén. |
| `rack_positions` | Posiciones físicas de cada rack. |
| `position_reservations` | Reserva temporal de posiciones para INBOUND. |
| `customer_orders` | Solicitudes de compra creadas por clientes. |
| `customer_order_fulfillments` | Posición reservada para preparar un pedido. |
| `customer_order_pickup_pins` | PIN temporal de retiro; no se expone al personal. |
| `customer_order_messages` | Conversación asociada a cada compra. |
| `tickets` | Solicitudes de soporte. |
| `ticket_messages` | Respuestas y seguimiento de tickets. |
| `notifications` | Avisos internos por cambios de estado. |
| `audit_log` | Bitácora administrativa de acciones relevantes. |

## Funcionalidades implementadas

### Inventario y CRUD

- Crear artículos y su registro de inventario.
- Editar SKU, nombre, categoría, descripción, dimensiones, costo, precio, proveedor y stock.
- Eliminar artículos.
- Buscar por SKU o nombre.
- Filtrar por categoría, proveedor y estado de stock.
- Detectar productos bajo el stock mínimo.
- Calcular valor total de inventario.

### Movimientos de almacén

- Crear movimientos de entrada, salida y ajuste.
- Registrar cantidad, motivo, notas, proveedor y llegada estimada para INBOUND.
- Mantener movimientos inicialmente en estado `pendiente`.
- Aprobar o rechazar órdenes.
- Actualizar stock únicamente al aprobar el movimiento.
- Reservar posiciones libres para entradas INBOUND.

### Mapa físico de almacén

- Visualizar almacenes, racks y posiciones.
- Diferenciar espacios libres, ocupados y reservados.
- Hacer clic en una posición para consultar el producto, el pedido DESP o la reserva INBOUND que la ocupa.
- Evitar que dos operaciones activas usen la misma posición.

### Compras y despacho

- Catálogo exclusivo para clientes con stock disponible real.
- Filtros por categoría, marca, talla, color y precio.
- Solicitud de compra con cantidad y rack preferido opcional.
- Aprobación, rechazo u observación por operador/administrador.
- Asignación obligatoria de almacén, rack y posición libre si el cliente no eligió una preferencia.
- Flujo de estado: `pendiente → aprobado → listo para retiro → entregado`.
- Visualización de almacén, rack y posición de recojo para el cliente.
- Chat relacionado con cada orden.

### PIN de retiro

1. El personal marca un pedido como **Listo para retiro**.
2. Supabase genera un PIN de seis dígitos.
3. El PIN aparece únicamente en el historial del cliente.
4. Operador o administrador solo ingresan el PIN que comunica el cliente.
5. Si coincide, el pedido queda como entregado, se libera la posición y se registra la entrega en la bitácora.
6. Si no coincide, el sistema informa que el PIN es incorrecto sin revelar el código real.

### Tickets, avisos y bitácora

- Crear tickets por categoría, prioridad y detalle.
- Responder, resolver o denegar solicitudes según el rol.
- Notificar compras nuevas y cambios de estado.
- Consultar bitácora exclusiva de administrador.
- Registrar entregas validadas por PIN como **Producto entregado**, con pedido, producto, cantidad y usuario responsable.

## Dashboard del administrador

El administrador usa un solo menú lateral dentro de `portal.html`:

- Dashboard: gráfico semanal de solicitudes y entregas.
- Resumen: métricas operativas y movimientos recientes.
- Inventario.
- Movimientos.
- Almacén.
- Solicitudes de compra.
- Tickets.
- Ubicar producto.
- Bitácora.

## Seguridad y buenas prácticas

- Autenticación mediante Supabase Auth.
- Roles almacenados en `profiles`.
- Políticas RLS para limitar accesos por rol.
- Funciones `security definer` para operaciones críticas.
- Validación de stock, posición libre y permisos antes de aprobar una operación.
- El PIN no se devuelve en consultas del personal; el personal únicamente recibe el resultado de validación.
- No se usa la clave `service_role` en el frontend.
- Se escapan textos provenientes de la base de datos antes de insertarlos en HTML.

## Estructura del proyecto

```text
inventario-supabase/
├── index.html                  # Centro operativo de inventario
├── portal.html                 # Login y portal por rol
├── catalog.html                # Tienda exclusiva para clientes
├── register.html               # Registro de nuevos clientes
├── app.js                      # Inventario, movimientos y almacén
├── portal.js                   # Sesión, roles, tickets, avisos y dashboard
├── store.js                    # Compras, despacho, chat y PIN
├── catalog.js                  # Filtros y solicitudes desde el catálogo
├── admin-audit.js              # Bitácora del administrador
├── admin-tickets.js            # Tickets globales del administrador
├── dashboard-session.js        # Datos de sesión y cierre de sesión operativo
├── styles.css                  # Estilos del centro operativo
├── portal.css                  # Estilos de login, portal, tienda y dashboard
├── warehouse.css               # Estilos del mapa de almacén
├── config.example.js           # Plantilla de configuración de Supabase
└── supabase/                   # Esquema, migraciones y datos de demostración
```

## Instalación local

1. Clonar o descargar el código fuente.
2. Crear un proyecto en Supabase.
3. En Supabase SQL Editor, ejecutar las migraciones necesarias del directorio `supabase/`.
4. Copiar `config.example.js` como `config.js`.
5. Completar `window.SUPABASE_URL` y `window.SUPABASE_ANON_KEY` con los datos del proyecto.
6. Abrir el proyecto con Live Server, VS Code Live Preview o cualquier servidor estático.
7. Abrir `portal.html` para iniciar sesión.

> Nunca coloques la clave `service_role` en `config.js` ni en el navegador.

## Proyecto Supabase

- URL de la API usada por el frontend: `https://smxqczzyvlrpbxukjlkt.supabase.co`
- Panel del proyecto: [Supabase Dashboard](https://supabase.com/dashboard/project/smxqczzyvlrpbxukjlkt)

Para que el evaluador pueda revisar tablas, RLS y funciones RPC, se le debe invitar como colaborador del proyecto desde Supabase. El repositorio incluye todas las migraciones SQL para que también pueda revisar o recrear la estructura.

## Orden sugerido de migraciones

Ejecutar primero la base y luego las funcionalidades complementarias que se usarán:

1. `supabase/schema.sql`
2. `supabase/auth_tickets_migration.sql`
3. `supabase/profile_registration_migration.sql`
4. `supabase/warehouse_migration.sql`
5. `supabase/inventory_staff_access.sql`
6. `supabase/store_orders_migration.sql`
7. `supabase/catalog_client_only_migration.sql`
8. `supabase/catalog_filters_migration.sql`
9. `supabase/customer_dispatch_preference_migration.sql`
10. `supabase/order_dispatch_positions_migration.sql`
11. `supabase/customer_orders_summary_migration.sql`
12. `supabase/staff_orders_summary_migration.sql`
13. `supabase/ticket_workflow_migration.sql`
14. `supabase/audit_log_migration.sql`
15. `supabase/operations_upgrade_migration.sql`
16. `supabase/pickup_pin_migration.sql`
17. `supabase/seed_100_products.sql` para cargar productos de demostración.

Si una migración fue actualizada, se debe ejecutar nuevamente solo cuando su contenido indique que es reutilizable o se haya adaptado para la instalación actual.

## Prueba de demostración recomendada

1. Ingresar como administrador y crear un artículo.
2. Crear una orden INBOUND y aprobarla; comprobar actualización de stock/posición.
3. Crear una cuenta de cliente e ingresar al catálogo.
4. Solicitar un producto disponible.
5. Ingresar como administrador, aprobar la solicitud y asignar posición.
6. Marcar el pedido como listo para retiro.
7. Ingresar como cliente y consultar ubicación + PIN.
8. Validar el PIN como administrador.
9. Verificar estado `entregado` y la entrada **Producto entregado** en Bitácora.

## Bonus implementados

- Workflow de aprobación de movimientos.
- Actualización de stock controlada por funciones RPC.
- Seguridad por roles y RLS.
- Mapa físico de almacén y reserva de posiciones.
- Trazabilidad mediante bitácora.
- Gestión de proveedores e INBOUND.
- Flujo completo de compra, despacho y retiro con PIN.

## Entrega

Para la entrega final se debe proporcionar:

- Link del proyecto publicado.
- Link o acceso al proyecto de Supabase.
- Repositorio GitHub con el código fuente.
- Este `README.md`.
