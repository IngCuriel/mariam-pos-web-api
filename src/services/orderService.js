import { PrismaClient } from '@prisma/client';
import { createStatusChangeNotification } from '../controllers/notificationsController.js';
import { OrderStatus, canTransition } from '../constants/orderStatus.js';
import { getBranchDeliveryTypes } from './branchService.js';

const prisma = new PrismaClient();

const orderInclude = {
  items: true,
  branch: { select: { id: true, name: true, description: true, logo: true } },
  user: { select: { id: true, name: true, email: true } },
  deliveryType: true,
  statusHistory: { orderBy: { createdAt: 'asc' } },
};

/** Admin de cajero/entrega: vista operativa de ítems confirmados. */
const OPERATIONAL_ITEMS_VIEWER_EMAIL = 'admin@mariamstore.com';
const OPERATIONAL_ITEMS_STATUSES = new Set([
  OrderStatus.IN_PREPARATION,
  OrderStatus.READY_FOR_PICKUP,
]);

export function shouldShowOperationalItemsOnly(order, viewerEmail) {
  if (!order?.status || !viewerEmail) return false;
  const normalizedEmail = String(viewerEmail).trim().toLowerCase();
  if (normalizedEmail !== OPERATIONAL_ITEMS_VIEWER_EMAIL) return false;
  return OPERATIONAL_ITEMS_STATUSES.has(order.status);
}

export function mapOrderItemsForOperationalView(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item.isAvailable !== false)
    .map((item) => ({
      ...item,
      quantity: item.confirmedQuantity != null ? item.confirmedQuantity : item.quantity,
    }));
}

/** Ajusta items en GET /orders/:id para el admin de operaciones (solo lectura). */
export function mapOrderForGetByIdResponse(order, viewerEmail) {
  if (!shouldShowOperationalItemsOnly(order, viewerEmail)) {
    return order;
  }
  return {
    ...order,
    items: mapOrderItemsForOperationalView(order.items),
  };
}

/**
 * Adjunta el `code` (SKU) del producto a cada ítem de los pedidos indicados.
 *
 * `OrderItem` guarda `productId` y `productName` como snapshot, pero NO tiene
 * relación Prisma con `Product`, por lo que el `code` no viaja en el `include`.
 * El POS local necesita el `code` para resolver el producto local correcto al
 * cobrar un pedido (el `productId` es el id de la tienda y no coincide con el id
 * local). Este helper resuelve el `code` con una sola consulta a `Product`
 * (`{id, code}`) y lo inyecta en cada ítem como campo `code`.
 *
 * Es tolerante: si un producto fue borrado o no tiene `code`, el ítem queda con
 * `code: null` (el POS cae a su producto genérico en ese caso).
 *
 * @param {Array<object>} orders - Pedidos con `items` ya incluidos. Se mutan in situ.
 * @returns {Promise<Array<object>>} Los mismos pedidos, con `code` en cada ítem.
 */
export async function attachProductCodesToOrders(orders) {
  if (!Array.isArray(orders) || orders.length === 0) return orders;

  // Reunir todos los productId presentes en los ítems (sin duplicados ni nulos).
  const productIds = new Set();
  for (const order of orders) {
    for (const item of order?.items ?? []) {
      if (item?.productId != null) productIds.add(item.productId);
    }
  }
  if (productIds.size === 0) return orders;

  const products = await prisma.product.findMany({
    where: { id: { in: [...productIds] } },
    select: { id: true, code: true },
  });
  const codeById = new Map(products.map((p) => [p.id, p.code ?? null]));

  // Alternativas sugeridas: una sola consulta para todos los ítems. Solo se
  // devuelven las que siguen a la venta en la tienda en línea.
  const suggestedIds = new Set();
  for (const order of orders) {
    for (const item of order?.items ?? []) {
      for (const sid of item?.suggestedProductIds ?? []) suggestedIds.add(sid);
    }
  }
  const suggestedById = new Map();
  if (suggestedIds.size > 0) {
    const suggested = await prisma.product.findMany({
      where: { id: { in: [...suggestedIds] } },
      select: {
        id: true,
        code: true,
        name: true,
        price: true,
        isPromo: true,
        promoPrice: true,
        promoEndsAt: true,
        icon: true,
        unitAbbreviation: true,
        showInStore: true,
        productAvailability: true,
        images: { orderBy: { displayOrder: 'asc' }, take: 1, select: { url: true } },
        _count: { select: { presentations: true, priceTiers: true } },
      },
    });
    for (const p of suggested) {
      if (!isSuggestableProduct(p)) continue;
      suggestedById.set(p.id, {
        id: p.id,
        code: p.code ?? null,
        name: p.name,
        price: p.price,
        isPromo: p.isPromo,
        promoPrice: p.promoPrice,
        promoEndsAt: p.promoEndsAt,
        unitAbbreviation: p.unitAbbreviation ?? null,
        imageUrl: p.images?.[0]?.url ?? p.icon ?? null,
        // Con presentaciones o mayoreo el cliente debe elegir en el detalle del producto.
        hasOptions: (p._count?.presentations ?? 0) > 0 || (p._count?.priceTiers ?? 0) > 0,
      });
    }
  }

  for (const order of orders) {
    if (!Array.isArray(order?.items)) continue;
    order.items = order.items.map((item) => ({
      ...item,
      code: item?.productId != null ? codeById.get(item.productId) ?? null : null,
      suggestedProducts: (item?.suggestedProductIds ?? [])
        .map((sid) => suggestedById.get(sid))
        .filter(Boolean),
    }));
  }
  return orders;
}

/** Variante para un solo pedido: reutiliza {@link attachProductCodesToOrders}. */
export async function attachProductCodesToOrder(order) {
  if (!order) return order;
  const [result] = await attachProductCodesToOrders([order]);
  return result;
}

/** Registra un cambio de estado en el historial del pedido (para timeline tipo Mercado Libre). */
export async function recordStatusHistory(orderId, status) {
  await prisma.orderStatusHistory.create({
    data: { orderId: parseInt(orderId), status },
  });
}

/** Máximo de productos sugeridos (alternativas) por ítem no disponible. */
export const MAX_SUGGESTED_PRODUCTS = 3;

/** Un producto se puede sugerir solo si se vende en la tienda en línea. */
const isSuggestableProduct = (p) =>
  p != null && p.showInStore !== false && p.productAvailability !== 'in_store_only';

/**
 * Normaliza los ids sugeridos de un ítem: enteros positivos, sin duplicados,
 * sin el propio producto del ítem y como máximo MAX_SUGGESTED_PRODUCTS.
 * Lanza 400 si el formato es inválido o excede el máximo.
 */
export function normalizeSuggestedProductIds(value, ownProductId) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    const err = new Error('suggestedProductIds debe ser un arreglo de ids de producto');
    err.statusCode = 400;
    throw err;
  }
  const ids = [];
  for (const raw of value) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      const err = new Error('suggestedProductIds contiene un id de producto inválido');
      err.statusCode = 400;
      throw err;
    }
    if (n !== ownProductId && !ids.includes(n)) ids.push(n);
  }
  if (ids.length > MAX_SUGGESTED_PRODUCTS) {
    const err = new Error(`Solo se pueden sugerir hasta ${MAX_SUGGESTED_PRODUCTS} productos por artículo`);
    err.statusCode = 400;
    throw err;
  }
  return ids;
}

/** Margen para no rechazar una fecha "ahora" por diferencias de reloj entre terminal y servidor. */
const ESTIMATED_AVAILABLE_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Normaliza la fecha estimada de disponibilidad ("sobre pedido").
 * - undefined / null / '' => null (sin fecha estimada).
 * - Fecha inválida o en el pasado => error 400.
 */
export function parseEstimatedAvailableAt(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const err = new Error('La fecha estimada de disponibilidad no es válida');
    err.statusCode = 400;
    throw err;
  }
  if (date.getTime() < Date.now() - ESTIMATED_AVAILABLE_CLOCK_SKEW_MS) {
    const err = new Error('La fecha estimada de disponibilidad no puede ser en el pasado');
    err.statusCode = 400;
    throw err;
  }
  return date;
}

/**
 * Admin confirma disponibilidad: ajusta cantidades, recalcula total,
 * pasa a PARTIALLY_AVAILABLE o AVAILABLE y notifica al cliente.
 * Solo válido si estado actual es UNDER_REVIEW.
 *
 * options.estimatedAvailableAt (opcional): fecha/hora estimada en que el pedido
 * completo estará disponible (pedidos "sobre pedido"). Se ignora si el pedido
 * queda cancelado por no haber productos disponibles.
 */
export async function reviewAvailability(orderId, itemsPayload, options = {}) {
  const estimatedAvailableAt = parseEstimatedAvailableAt(options.estimatedAvailableAt);
  const id = parseInt(orderId);
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!order) {
    const err = new Error('Pedido no encontrado');
    err.statusCode = 404;
    throw err;
  }

  if (order.status !== OrderStatus.UNDER_REVIEW) {
    const err = new Error(
      `Solo se puede confirmar disponibilidad cuando el pedido está en revisión. Estado actual: ${order.status}`
    );
    err.statusCode = 400;
    throw err;
  }

  if (!itemsPayload || !Array.isArray(itemsPayload)) {
    const err = new Error('Se requiere un array de items con itemId e isAvailable (y opcionalmente confirmedQuantity)');
    err.statusCode = 400;
    throw err;
  }

  const orderItemIds = new Set(order.items.map((i) => i.id));
  const payloadIds = new Set(itemsPayload.map((i) => i.itemId));
  if (orderItemIds.size !== payloadIds.size || [...orderItemIds].some((id) => !payloadIds.has(id))) {
    const err = new Error('Debe enviar la disponibilidad de todos los productos del pedido');
    err.statusCode = 400;
    throw err;
  }

  // Sugerencias (alternativas de la tienda en línea) solo para ítems NO disponibles.
  // Se validan antes de escribir: existen, se venden en línea y son de la sucursal del pedido.
  const suggestionsByItemId = new Map();
  for (const it of itemsPayload) {
    const line = order.items.find((i) => i.id === it.itemId);
    if (!line) continue;
    const ids = it.isAvailable === true ? [] : normalizeSuggestedProductIds(it.suggestedProductIds, line.productId);
    suggestionsByItemId.set(it.itemId, ids);
  }
  const allSuggestedIds = [...new Set([...suggestionsByItemId.values()].flat())];
  if (allSuggestedIds.length > 0) {
    const suggested = await prisma.product.findMany({
      where: { id: { in: allSuggestedIds } },
      select: { id: true, branchId: true, showInStore: true, productAvailability: true },
    });
    const byId = new Map(suggested.map((p) => [p.id, p]));
    for (const sid of allSuggestedIds) {
      const p = byId.get(sid);
      const sameBranch = order.branchId == null || p?.branchId == null || p.branchId === order.branchId;
      if (!isSuggestableProduct(p) || !sameBranch) {
        const err = new Error('Uno de los productos sugeridos no está disponible en la tienda en línea de esta sucursal');
        err.statusCode = 400;
        throw err;
      }
    }
  }

  const previousStatus = order.status;

  await prisma.$transaction(async (tx) => {
    for (const it of itemsPayload) {
      const { itemId, isAvailable, confirmedQuantity } = it;
      const line = order.items.find((i) => i.id === itemId);
      if (!line) continue;

      const available = isAvailable === true;
      const qty = available
        ? Math.min(
            Math.max(0, confirmedQuantity != null ? Number(confirmedQuantity) : line.quantity),
            line.quantity
          )
        : 0;

      const subtotal = qty * line.unitPrice;

      await tx.orderItem.update({
        where: { id: itemId },
        data: {
          isAvailable: available ? true : false,
          confirmedQuantity: qty,
          subtotal,
          // Alternativas sugeridas (vacío cuando el ítem sí está disponible).
          suggestedProductIds: available ? [] : suggestionsByItemId.get(itemId) ?? [],
        },
      });
    }

    const updatedItems = await tx.orderItem.findMany({
      where: { orderId: id },
    });

    const newTotal = updatedItems.reduce((sum, i) => sum + i.subtotal, 0);
    const allAvailable = updatedItems.every((i) => i.isAvailable === true && (i.confirmedQuantity ?? i.quantity) >= i.quantity);
    const noProductsAvailable = newTotal === 0 || updatedItems.every((i) => i.isAvailable === false);

    let newStatus;
    let cancellationReason = null;
    if (noProductsAvailable) {
      newStatus = OrderStatus.CANCELLED;
      cancellationReason =
        'No hay disponibilidad de los productos solicitados en este momento. Te invitamos a explorar otros productos.';
    } else if (allAvailable) {
      newStatus = OrderStatus.AVAILABLE;
    } else {
      newStatus = OrderStatus.PARTIALLY_AVAILABLE;
    }

    await tx.order.update({
      where: { id },
      data: {
        total: newTotal,
        status: newStatus,
        cancellationReason,
        // Sin productos disponibles el pedido se cancela: no aplica fecha estimada.
        estimatedAvailableAt: newStatus === OrderStatus.CANCELLED ? null : estimatedAvailableAt,
      },
    });
  });

  const updatedOrder = await prisma.order.findUnique({
    where: { id },
    include: orderInclude,
  });

  await recordStatusHistory(id, updatedOrder.status);
  await createStatusChangeNotification(
    order.userId,
    'order',
    id,
    updatedOrder.status,
    previousStatus
  );

  return updatedOrder;
}

/** Construye string de dirección desde un UserAddress */
function formatUserAddress(addr) {
  const parts = [
    addr.street,
    addr.colony,
    [addr.postalCode, addr.city].filter(Boolean).join(' '),
  ].filter(Boolean);
  if (addr.state) parts.push(addr.state);
  if (addr.references?.trim()) parts.push(`Ref: ${addr.references.trim()}`);
  return parts.join(', ');
}

/**
 * Cliente acepta pedido actualizado. Pasa a IN_PREPARATION.
 * Solo válido si estado es PARTIALLY_AVAILABLE o AVAILABLE.
 * Si el pedido no tiene forma de entrega, debe enviar deliveryTypeId (y opcionalmente deliveryCost).
 * Para envío a domicilio: enviar deliveryAddress (string) o addressId (id de UserAddress del usuario).
 */
export async function confirmByCustomer(orderId, userId, options = {}) {
  const id = parseInt(orderId);
  const { deliveryAddress: deliveryAddressRaw, addressId, deliveryTypeId: bodyDeliveryTypeId, deliveryCost: bodyDeliveryCost } = options;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      deliveryType: { select: { id: true, code: true } },
      items: { select: { subtotal: true } },
    },
  });

  if (!order) {
    const err = new Error('Pedido no encontrado');
    err.statusCode = 404;
    throw err;
  }

  if (order.userId !== userId) {
    const err = new Error('No tienes permiso para confirmar este pedido');
    err.statusCode = 403;
    throw err;
  }

  const newStatus = OrderStatus.IN_PREPARATION;
  if (!canTransition(order.status, newStatus)) {
    const err = new Error(
      `No se puede aceptar el pedido en estado ${order.status}. Debe estar en Disponible o Parcialmente disponible.`
    );
    err.statusCode = 400;
    throw err;
  }

  let deliveryTypeId = order.deliveryTypeId;
  let deliveryCost = order.deliveryCost != null ? Number(order.deliveryCost) : 0;
  let total = order.total;

  if (order.deliveryTypeId == null) {
    if (bodyDeliveryTypeId == null) {
      const err = new Error('Debes elegir la forma de entrega para aceptar el pedido.');
      err.statusCode = 400;
      throw err;
    }
    const requestedId = Number(bodyDeliveryTypeId);
    let chosen = null;
    if (order.branchId != null) {
      const allowedTypes = await getBranchDeliveryTypes(order.branchId);
      chosen = Array.isArray(allowedTypes) ? allowedTypes.find((t) => t.id === requestedId) : null;
    } else {
      const dt = await prisma.deliveryType.findFirst({
        where: { id: requestedId, isActive: true },
      });
      chosen = dt ? { id: dt.id, cost: dt.cost ?? 0 } : null;
    }
    if (!chosen) {
      const err = new Error('La forma de entrega elegida no es válida para este pedido.');
      err.statusCode = 400;
      throw err;
    }
    deliveryTypeId = chosen.id;
    deliveryCost = bodyDeliveryCost != null && !Number.isNaN(Number(bodyDeliveryCost)) && Number(bodyDeliveryCost) >= 0
      ? Number(bodyDeliveryCost)
      : (chosen.cost ?? 0);
    const subtotal = order.items.reduce((sum, i) => sum + (i.subtotal || 0), 0);
    total = subtotal + deliveryCost;
  }

  const deliveryTypeForCode = deliveryTypeId != null
    ? await prisma.deliveryType.findUnique({ where: { id: deliveryTypeId }, select: { code: true } })
    : null;
  const isDelivery = deliveryTypeForCode?.code === 'delivery';
  let deliveryAddress = null;
  // Snapshot de la ubicación del cliente: se congela en el pedido al confirmar,
  // así el histórico no cambia aunque el cliente edite/borre su dirección luego.
  let deliveryLatitude = null;
  let deliveryLongitude = null;
  if (isDelivery) {
    if (addressId != null) {
      const userAddress = await prisma.userAddress.findFirst({
        where: { id: Number(addressId), userId },
      });
      if (!userAddress) {
        const err = new Error('La dirección seleccionada no es válida.');
        err.statusCode = 400;
        throw err;
      }
      deliveryAddress = formatUserAddress(userAddress);
      if (userAddress.latitude != null && userAddress.longitude != null) {
        deliveryLatitude = userAddress.latitude;
        deliveryLongitude = userAddress.longitude;
      }
    } else if (typeof deliveryAddressRaw === 'string' && deliveryAddressRaw.trim()) {
      deliveryAddress = deliveryAddressRaw.trim();
    }
    if (!deliveryAddress) {
      const err = new Error('Para envío a domicilio debes indicar la dirección de entrega.');
      err.statusCode = 400;
      throw err;
    }
  }

  const previousStatus = order.status;
  const updateData = {
    status: newStatus,
    confirmedAt: new Date(),
    ...(order.deliveryTypeId == null ? { deliveryTypeId, deliveryCost, total } : {}),
  };
  if (deliveryAddress) {
    updateData.deliveryAddress = deliveryAddress;
  }
  if (deliveryLatitude != null && deliveryLongitude != null) {
    updateData.deliveryLatitude = deliveryLatitude;
    updateData.deliveryLongitude = deliveryLongitude;
  }

  const updatedOrder = await prisma.order.update({
    where: { id },
    data: updateData,
    include: orderInclude,
  });

  await recordStatusHistory(id, newStatus);
  await createStatusChangeNotification(
    order.userId,
    'order',
    id,
    newStatus,
    previousStatus
  );

  return updatedOrder;
}

/**
 * Admin marca pedido como listo para recoger o como enviado (en camino).
 * Si el pedido es envío a domicilio (deliveryType.code === 'delivery') -> IN_TRANSIT; si no -> READY_FOR_PICKUP.
 * @param {number|string} orderId
 * @param {string|Date} [readyAt] - Fecha/hora en que estará listo o en que salió en camino (ISO string o Date).
 */
export async function markAsReady(orderId, readyAt) {
  const id = parseInt(orderId);
  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true, status: true, userId: true, deliveryType: true },
  });

  if (!order) {
    const err = new Error('Pedido no encontrado');
    err.statusCode = 404;
    throw err;
  }

  const isDelivery = order.deliveryType?.code === 'delivery';
  const newStatus = isDelivery ? OrderStatus.IN_TRANSIT : OrderStatus.READY_FOR_PICKUP;

  if (!canTransition(order.status, newStatus)) {
    const err = new Error(
      `No se puede marcar como listo en estado ${order.status}. El pedido debe estar en preparación.`
    );
    err.statusCode = 400;
    throw err;
  }

  const previousStatus = order.status;
  const readyAtDate = readyAt ? new Date(readyAt) : new Date();
  if (Number.isNaN(readyAtDate.getTime())) {
    const err = new Error('La fecha/hora indicada no es válida.');
    err.statusCode = 400;
    throw err;
  }

  const updatedOrder = await prisma.order.update({
    where: { id },
    data: {
      status: newStatus,
      readyAt: readyAtDate,
    },
    include: orderInclude,
  });

  await recordStatusHistory(id, newStatus);
  await createStatusChangeNotification(
    order.userId,
    'order',
    id,
    newStatus,
    previousStatus
  );

  return updatedOrder;
}

/**
 * Cancelar pedido. Solo desde estados cancelables.
 * @param {string|number} orderId
 * @param {number} userId
 * @param {boolean} isAdmin
 * @param {string} [cancellationReason] - Motivo de cancelación (opcional)
 */
export async function cancelOrder(orderId, userId, isAdmin, cancellationReason = null) {
  const id = parseInt(orderId);
  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true, status: true, userId: true },
  });

  if (!order) {
    const err = new Error('Pedido no encontrado');
    err.statusCode = 404;
    throw err;
  }

  if (!isAdmin && order.userId !== userId) {
    const err = new Error('No tienes permiso para cancelar este pedido');
    err.statusCode = 403;
    throw err;
  }

  const newStatus = OrderStatus.CANCELLED;
  if (!canTransition(order.status, newStatus)) {
    const err = new Error(
      `No se puede cancelar el pedido en estado ${order.status}.`
    );
    err.statusCode = 400;
    throw err;
  }

  const previousStatus = order.status;
  const reasonToSave =
    cancellationReason && String(cancellationReason).trim()
      ? String(cancellationReason).trim()
      : null;

  const updatedOrder = await prisma.order.update({
    where: { id },
    data: { status: newStatus, cancellationReason: reasonToSave },
    include: orderInclude,
  });

  await recordStatusHistory(id, newStatus);
  await createStatusChangeNotification(
    order.userId,
    'order',
    id,
    newStatus,
    previousStatus
  );

  return updatedOrder;
}
