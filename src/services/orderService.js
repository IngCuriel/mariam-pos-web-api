import { PrismaClient } from '@prisma/client';
import { createStatusChangeNotification } from '../controllers/notificationsController.js';
import { OrderStatus, canTransition } from '../constants/orderStatus.js';

const prisma = new PrismaClient();

const orderInclude = {
  items: true,
  branch: { select: { id: true, name: true } },
  user: { select: { id: true, name: true, email: true } },
};

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
 */
export async function confirmByCustomer(orderId, userId) {
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

  const previousStatus = order.status;

  const updatedOrder = await prisma.order.update({
    where: { id },
    data: {
      status: newStatus,
      confirmedAt: new Date(),
    },
    include: orderInclude,
  });

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
 * Admin marca pedido como listo para recoger. IN_PREPARATION -> READY_FOR_PICKUP.
 */
export async function markAsReady(orderId) {
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

  const newStatus = OrderStatus.READY_FOR_PICKUP;
  if (!canTransition(order.status, newStatus)) {
    const err = new Error(
      `No se puede marcar como listo en estado ${order.status}. El pedido debe estar en preparación.`
    );
    err.statusCode = 400;
    throw err;
  }

  const previousStatus = order.status;

  const updatedOrder = await prisma.order.update({
    where: { id },
    data: {
      status: newStatus,
      readyAt: new Date(),
    },
    include: orderInclude,
  });

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

  await createStatusChangeNotification(
    order.userId,
    'order',
    id,
    newStatus,
    previousStatus
  );

  return updatedOrder;
}
