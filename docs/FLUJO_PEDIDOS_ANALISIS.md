# Análisis: Flujo optimizado de pedidos para recoger en tienda

Este documento lista la **estructura actual** y los **archivos que hay que modificar** antes de implementar el nuevo flujo. No se genera código aquí; es la guía para no romper la arquitectura existente.

---

## Proyectos involucrados

| Referencia en el requerimiento | Carpeta real en el repo |
|-------------------------------|--------------------------|
| Backend: mariam-pos-web-api    | `mariam-pos-web-api`      |
| Cliente: mariam-pos-client     | `mariam-store-client`     |
| Admin: mariam-pos-admin        | `mariam-store-admin`     |

---

## 1. Estado actual del backend (mariam-pos-web-api)

### Base de datos (Prisma)

- **`prisma/schema.prisma`**
  - **OrderStatus** (enum): `PENDIENTE`, `CONFIRMADO`, `EN_PREPARACION`, `LISTO`, `ENTREGADO`, `CANCELADO`.
  - **Order**: `id`, `folio`, `total`, `status`, `notes`, `userId`, `branchId`, `createdAt`, `updatedAt`. No tiene `confirmedAt`, `readyAt`, etc.
  - **OrderItem**: `id`, `orderId`, `productId`, `productName`, `quantity`, `unitPrice`, `subtotal`, `isAvailable` (Boolean?). No tiene cantidad confirmada por ítem (solo disponibilidad sí/no).
  - **Notification**: ya existe y se usa para órdenes (`type: 'order'`, `entityId`). No hace falta tabla `order_notifications` si se sigue usando esta.

### Controladores y rutas

- **`src/controllers/ordersController.js`**
  - `createOrder`: crea pedido con `status: 'PENDIENTE'` (hardcodeado). No usa `UNDER_REVIEW`.
  - `getOrders`, `getOrderById`: filtran por usuario/rol, incluyen items y branch.
  - `updateOrderStatus`: valida contra lista de estados actual (`validStatuses`). Crea notificación al cambiar estado.
  - `updateOrderItemsAvailability`: solo si `order.status === 'PENDIENTE'`. Actualiza `isAvailable` por ítem; **no** recalcula total ni cambia estado del pedido.
  - No existe: “confirmar disponibilidad” (recalcular total + pasar a AVAILABLE/PARTIALLY_AVAILABLE), “aceptar pedido actualizado” por cliente, ni “marcar como listo” específico.

- **`src/routes/orders.js`**
  - `POST /` → createOrder  
  - `GET /`, `GET /:id` → getOrders, getOrderById  
  - `PATCH /:id/status` (admin) → updateOrderStatus  
  - `PATCH /:id/items-availability` (admin) → updateOrderItemsAvailability  

No hay rutas para: confirmación de disponibilidad por admin, confirmación por cliente, ni “marcar como listo”.

### Notificaciones

- **`src/controllers/notificationsController.js`**
  - `createStatusChangeNotification(userId, type, entityId, status, previousStatus)`.
  - `STATUS_MESSAGES` solo tiene claves para los estados actuales (`ORDER_PENDIENTE`, `ORDER_CONFIRMADO`, etc.). Faltarán mensajes para los nuevos estados.

### Servicios

- No existe **OrderService**. Toda la lógica está en `ordersController.js`.

---

## 2. Estado actual del cliente (mariam-store-client)

### Servicios

- **`src/services/ordersService.js`**: `createOrder`, `getOrders`, `getOrderById`. No hay llamadas para “aceptar pedido actualizado” ni “cancelar pedido”.

### Páginas

- **`src/pages/Orders.jsx`**: lista de pedidos; estados y etiquetas son los actuales (PENDIENTE, CONFIRMADO, etc.).
- **`src/pages/OrderDetail.jsx`**: detalle de un pedido; muestra estado, productos, disponibilidad (✓/✕/?) y total. No hay botones “Aceptar pedido actualizado” ni “Cancelar pedido” para `PARTIALLY_AVAILABLE`.
- **`src/pages/Cart.jsx`**: crea pedido vía `createOrder`; no envía estado inicial (lo define el backend).

### Constantes

- Estados y colores están hardcodeados en cada componente. No hay constante centralizada compartida con el backend.

---

## 3. Estado actual del admin (mariam-store-admin)

### Servicios

- **`src/services/ordersService.js`**: `getOrders`, `getOrderById`, `updateOrderStatus`, `updateOrderItemsAvailability`. No hay llamada a “confirmar disponibilidad”.

### Páginas

- **`src/pages/Pedidos.jsx`**: lista de pedidos con filtro por estado; usa los estados actuales.
- **`src/pages/PedidoDetail.jsx`**:
  - Solo permite editar disponibilidad cuando `order.status === 'PENDIENTE'`.
  - Tiene “Guardar Todo” para disponibilidad, pero **no** un botón “Confirmar disponibilidad” que dispare un endpoint que recalcule total y cambie estado a AVAILABLE/PARTIALLY_AVAILABLE.
  - Avanza estado manualmente con “Avanzar a {siguiente estado}” (PENDIENTE → CONFIRMADO → …). No hay flujo “Marcar como listo” específico para recoger en tienda.

---

## 4. Cambios necesarios (resumen por capa)

### 4.1 Base de datos (mariam-pos-web-api)

| Archivo | Cambio |
|--------|--------|
| **`prisma/schema.prisma`** | 1) Reemplazar o extender **OrderStatus** con: `CREATED`, `UNDER_REVIEW`, `PARTIALLY_AVAILABLE`, `AVAILABLE`, `IN_PREPARATION`, `READY_FOR_PICKUP`, `COMPLETED`, `CANCELLED`. 2) **Order**: añadir campos opcionales `confirmedAt`, `readyAt` (DateTime?). 3) **OrderItem**: añadir `confirmedQuantity` (Int?) para cantidad confirmada; si no, usar `quantity` cuando `isAvailable === true` y 0 cuando false. 4) Migración que actualice enum y datos existentes (mapear PENDIENTE→UNDER_REVIEW o mantener compatibilidad según decisión). |

Nota: si se quiere **no romper** contratos actuales, se puede mantener el enum actual y añadir nuevos valores, o hacer una migración en dos fases (nuevo enum + script de datos). Definir si “PENDIENTE” actual se considera UNDER_REVIEW o CREATED.

### 4.2 Backend – lógica y API

| Archivo | Cambio |
|--------|--------|
| **`src/constants/orderStatus.js`** (nuevo) | Constante o enum centralizado con todos los estados y transiciones permitidas (ej. UNDER_REVIEW → PARTIALLY_AVAILABLE, PARTIALLY_AVAILABLE → IN_PREPARATION, etc.). |
| **`src/services/orderService.js`** (nuevo) | Servicio con: `reviewAvailability(orderId, items[])` (ajustar cantidades, recalcular total, pasar a PARTIALLY_AVAILABLE o AVAILABLE, notificar cliente), `confirmByCustomer(orderId)` (solo si PARTIALLY_AVAILABLE o AVAILABLE → IN_PREPARATION, guardar confirmedAt, notificar admin si aplica), `markAsReady(orderId)` (IN_PREPARATION → READY_FOR_PICKUP, guardar readyAt, notificar cliente), `cancelOrder(orderId)` (validar que sea cancelable). Todas las transiciones validar estado actual y no permitir saltos inválidos. |
| **`src/controllers/ordersController.js`** | 1) createOrder: asignar estado inicial `UNDER_REVIEW` (o CREATED según diseño). 2) getOrders / getOrderById: sin cambios de contrato; el cliente/admin ya reciben status y items. 3) Sustituir o complementar updateOrderStatus y updateOrderItemsAvailability: que las nuevas acciones (confirmar disponibilidad, confirmar por cliente, marcar listo, cancelar) pasen por **orderService** y el controller solo llame al servicio y devuelva el pedido actualizado. Mantener PATCH `/:id/status` si se sigue usando para otros flujos o deprecarlo. 4) Nuevos handlers (o reutilizar) que llamen a `orderService.reviewAvailability`, `confirmByCustomer`, `markAsReady`, `cancelOrder`. |
| **`src/routes/orders.js`** | Añadir rutas: `POST /:id/review-availability` (admin), `POST /:id/confirm-by-customer` (cliente dueño), `POST /:id/mark-ready` (admin), `POST /:id/cancel` (cliente o admin según reglas). Proteger con authenticate y requireAdmin donde corresponda. |
| **`src/controllers/notificationsController.js`** | Añadir en **STATUS_MESSAGES** las claves para los nuevos estados (ORDER_UNDER_REVIEW, ORDER_PARTIALLY_AVAILABLE, ORDER_AVAILABLE, ORDER_IN_PREPARATION, ORDER_READY_FOR_PICKUP, ORDER_COMPLETED, ORDER_CANCELLED) con títulos y mensajes acordes al flujo (ej. “Tu pedido está listo para recoger en sucursal”). |

### 4.3 Cliente (mariam-store-client)

| Archivo | Cambio |
|--------|--------|
| **`src/constants/orderStatus.js`** (o similar) | Constantes/etiquetas de estados y colores para UI, alineados con el backend (UNDER_REVIEW, PARTIALLY_AVAILABLE, AVAILABLE, IN_PREPARATION, READY_FOR_PICKUP, COMPLETED, CANCELLED). |
| **`src/services/ordersService.js`** | Añadir: `confirmOrderByCustomer(orderId)`, `cancelOrder(orderId)` (y si el backend lo expone, opcionalmente algo para “notificaciones de pedido”). |
| **`src/pages/Orders.jsx`** | Usar constantes centralizadas; mensaje para UNDER_REVIEW: “Estamos revisando la disponibilidad de tus productos.”; mostrar resto de estados con etiquetas nuevas. |
| **`src/pages/OrderDetail.jsx`** | 1) Mostrar por producto ✔ Disponible / ❌ Agotado (y cantidad confirmada si aplica). 2) Mostrar total actualizado (viene del backend). 3) Si estado es PARTIALLY_AVAILABLE (o AVAILABLE si también se permite aceptar desde ahí): mostrar botones “Aceptar pedido actualizado” y “Cancelar pedido”; al aceptar llamar a `confirmOrderByCustomer(id)` y recargar/redirigir; al cancelar llamar a `cancelOrder(id)`. 4) Para READY_FOR_PICKUP mostrar mensaje: “Tu pedido ya está listo para recoger en sucursal.” |

### 4.4 Admin (mariam-store-admin)

| Archivo | Cambio |
|--------|--------|
| **`src/constants/orderStatus.js`** (o similar) | Mismo criterio que en cliente: estados y etiquetas alineados al backend. |
| **`src/services/ordersService.js`** | Añadir: `reviewOrderAvailability(orderId, payload)` (enviar items con cantidades confirmadas / isAvailable), `markOrderReady(orderId)`. |
| **`src/pages/PedidoDetail.jsx`** | 1) Cuando estado sea UNDER_REVIEW (o el que se use para “pendiente de revisión”): permitir editar cantidad disponible por producto (y/o marcar no disponible). 2) Botón **“Confirmar disponibilidad”**: al hacer clic llamar al nuevo endpoint de review-availability; al éxito recargar pedido (estado y total actualizados). 3) Para pedidos en IN_PREPARATION mostrar botón **“Marcar como listo”** que llame a markOrderReady. 4) Sustituir o ajustar el avance manual de estado (NEXT_STATUS) para que respete el nuevo flujo (no permitir saltos inválidos). 5) Opcional: usar Toast/modal en lugar de alert/confirm. |
| **`src/pages/Pedidos.jsx`** | Usar constantes de estado; filtros y badges con los nuevos nombres. |

---

## 5. Transiciones de estado a validar en el backend

Sugerencia de transiciones (todas validadas en **orderService**):

- CREATED / UNDER_REVIEW → PARTIALLY_AVAILABLE | AVAILABLE (al “Confirmar disponibilidad”).
- PARTIALLY_AVAILABLE | AVAILABLE → IN_PREPARATION (cliente “Aceptar pedido actualizado”) o CANCELLED (cliente “Cancelar pedido”).
- IN_PREPARATION → READY_FOR_PICKUP (admin “Marcar como listo”).
- READY_FOR_PICKUP → COMPLETED (cuando se entregue/recoga; puede ser manual o futuro flujo).
- Cualquier estado cancelable → CANCELLED (según reglas de negocio).

No permitir, por ejemplo: UNDER_REVIEW → IN_PREPARATION sin pasar por AVAILABLE/PARTIALLY_AVAILABLE.

---

## 6. Notificaciones

- Seguir usando **Notification** (type `order`, entityId = orderId). No es necesario crear tabla `order_notifications` si se mantiene este modelo.
- Al: confirmar disponibilidad, cliente aceptar, marcar como listo (y opcionalmente cancelar), llamar a `createStatusChangeNotification` con el estado nuevo para que el cliente (o admin) vea la notificación al cargar “Mis pedidos” o el listado de pedidos.

---

## 7. Orden sugerido de implementación

1. **Backend: schema y migración** (OrderStatus, Order.confirmedAt/readyAt, OrderItem.confirmedQuantity).
2. **Backend: constantes y orderService** (transiciones, reviewAvailability, confirmByCustomer, markAsReady, cancelOrder).
3. **Backend: controllers y rutas** (nuevos endpoints que usen orderService; mantener los existentes que sigan siendo necesarios).
4. **Backend: notificaciones** (mensajes para los nuevos estados).
5. **Cliente: constantes, ordersService, Orders.jsx y OrderDetail.jsx** (mensajes, botones, llamadas a la API).
6. **Admin: constantes, ordersService, PedidoDetail.jsx y Pedidos.jsx** (confirmar disponibilidad, marcar como listo, estados).

Con esto se puede implementar el flujo sin romper la arquitectura existente y manteniendo la separación entre API, cliente y admin.
