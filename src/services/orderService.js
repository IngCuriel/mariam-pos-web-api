import { PrismaClient } from '@prisma/client';
import { createStatusChangeNotification } from '../controllers/notificationsController.js';
import { OrderStatus, canTransition } from '../constants/orderStatus.js';

const prisma = new PrismaClient();

const orderInclude = {
  items: true,
  branch: { select: { id: true, name: true } },
  user: { select: { id: true, name: true, email: true } },
  deliveryType: true,
  statusHistory: { orderBy: { createdAt: 'asc' } },
};

/** Registra un cambio de estado en el historial del pedido (para timeline tipo Mercado Libre). */
export async function recordStatusHistory(orderId, status) {
  await prisma.orderStatusHistory.create({
    data: { orderId: parseInt(orderId), status },
  });
}

/**
 * Admin confirma disponibilidad: ajusta cantidades, recalcula total,
 * pasa a PARTIALLY_AVAILABLE o AVAILABLE y notifica al cliente.
 * Solo válido si estado actual es UNDER_REVIEW.
 */
export async function reviewAvailability(orderId, itemsPayload) {
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
        },
      });
    }

    const updatedItems = await tx.orderItem.findMany({
      where: { orderId: id },
    });

    const newTotal = updatedItems.reduce((sum, i) => sum + i.subtotal, 0);
    const allAvailable = updatedItems.every((i) => i.isAvailable === true && (i.confirmedQuantity ?? i.quantity) >= i.quantity);
    // Si todo está disponible, pasar directo a En preparación (una sola notificación, sin "todo disponible")
    const newStatus = allAvailable ? OrderStatus.IN_PREPARATION : OrderStatus.PARTIALLY_AVAILABLE;

    await tx.order.update({
      where: { id },
      data: { total: newTotal, status: newStatus },
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

/**
 * Cliente acepta pedido actualizado. Pasa a IN_PREPARATION.
 * Solo válido si estado es PARTIALLY_AVAILABLE o AVAILABLE.
 * Si el pedido es envío a domicilio, puede enviar deliveryAddress (string) para guardarla.
 */
export async function confirmByCustomer(orderId, userId, options = {}) {
  const id = parseInt(orderId);
  const { deliveryAddress } = options;
  const order = await prisma.order.findUnique({
    where: { id },
    select: { id: true, status: true, userId: true, deliveryTypeId: true },
    include: { deliveryType: true },
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

  const isDelivery = order.deliveryType?.code === 'delivery';
  if (isDelivery && (!deliveryAddress || typeof deliveryAddress !== 'string' || !deliveryAddress.trim())) {
    const err = new Error('Para envío a domicilio debes indicar la dirección de entrega.');
    err.statusCode = 400;
    throw err;
  }

  const previousStatus = order.status;
  const updateData = {
    status: newStatus,
    confirmedAt: new Date(),
  };
  if (deliveryAddress && typeof deliveryAddress === 'string' && deliveryAddress.trim()) {
    updateData.deliveryAddress = deliveryAddress.trim();
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
 */
export async function cancelOrder(orderId, userId, isAdmin) {
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

  const updatedOrder = await prisma.order.update({
    where: { id },
    data: { status: newStatus },
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
