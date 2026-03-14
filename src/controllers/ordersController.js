import { PrismaClient } from '@prisma/client';
import { createStatusChangeNotification } from './notificationsController.js';
import * as orderService from '../services/orderService.js';
import { OrderStatus } from '../constants/orderStatus.js';

const prisma = new PrismaClient();

// Generar folio único
const generateFolio = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ORD-${timestamp}-${random}`;
};

// Tipos de entrega activos (configurables: recoger en sucursal, envío a domicilio, etc.)
export const getDeliveryTypes = async (req, res) => {
  try {
    const types = await prisma.deliveryType.findMany({
      where: { isActive: true },
      orderBy: { displayOrder: 'asc' },
    });
    res.json(types);
  } catch (error) {
    console.error('Error obteniendo tipos de entrega:', error);
    res.status(500).json({ error: 'Error al obtener tipos de entrega' });
  }
};

// Crear pedido (acepta deliveryTypeId y opcionalmente deliveryCost; total = subtotal + deliveryCost)
export const createOrder = async (req, res) => {
  try {
    const userId = req.userId;
    const {
      items,
      notes,
      branchId,
      deliveryTypeId: bodyDeliveryTypeId,
      deliveryCost: bodyDeliveryCost,
      orderAvailability,
    } = req.body || {};

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'El pedido debe contener al menos un producto'
      });
    }

    const subtotal = items.reduce((sum, item) => sum + (item.subtotal || item.unitPrice * item.quantity), 0);
    let deliveryTypeId = bodyDeliveryTypeId != null ? parseInt(bodyDeliveryTypeId, 10) : null;
    let deliveryCost = 0;

    if (deliveryTypeId) {
      const deliveryType = await prisma.deliveryType.findFirst({
        where: { id: deliveryTypeId, isActive: true },
      });
      if (!deliveryType) {
        return res.status(400).json({ error: 'Tipo de entrega no válido o inactivo' });
      }
      deliveryCost = bodyDeliveryCost != null ? Number(bodyDeliveryCost) : deliveryType.cost;
      if (Number.isNaN(deliveryCost) || deliveryCost < 0) deliveryCost = deliveryType.cost;
    }

    const total = subtotal + deliveryCost;

    const order = await prisma.order.create({
      data: {
        folio: generateFolio(),
        total,
        status: OrderStatus.UNDER_REVIEW,
        notes: notes || null,
        orderAvailability:
          orderAvailability === 'local_delivery' || orderAvailability === 'online_pickup'
            ? orderAvailability
            : null,
        userId,
        branchId: branchId || null,
        deliveryTypeId: deliveryTypeId || null,
        deliveryCost: deliveryTypeId ? deliveryCost : null,
        items: {
          create: items.map(item => ({
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            subtotal: item.subtotal || item.unitPrice * item.quantity,
            presentationName: item.presentationName ?? null,
            presentationQuantity: item.presentationQuantity ?? null
          }))
        }
      },
      include: {
        items: true,
        branch: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, email: true } },
        deliveryType: true,
        statusHistory: { orderBy: { createdAt: 'asc' } },
      }
    });

    await orderService.recordStatusHistory(order.id, OrderStatus.UNDER_REVIEW);

    const orderWithHistory = await prisma.order.findUnique({
      where: { id: order.id },
      include: {
        items: true,
        branch: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, email: true } },
        deliveryType: true,
        statusHistory: { orderBy: { createdAt: 'asc' } },
      }
    });

    res.status(201).json({
      message: 'Pedido creado exitosamente',
      order: orderWithHistory
    });
  } catch (error) {
    console.error('Error creando pedido:', error);
    res.status(500).json({
      error: 'Error al crear pedido'
    });
  }
};

// Conteos por estado (solo admin) para el panel de seguimiento
export const getOrderCounts = async (req, res) => {
  try {
    const userRole = req.userRole;
    if (userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Solo administradores pueden ver los conteos' });
    }

    const counts = await prisma.order.groupBy({
      by: ['status'],
      _count: { id: true },
      where: {},
    });

    const countByStatus = counts.reduce((acc, row) => {
      acc[row.status] = row._count.id;
      return acc;
    }, {});

    const allStatuses = Object.values(OrderStatus);
    const result = {};
    let total = 0;
    for (const s of allStatuses) {
      result[s] = countByStatus[s] || 0;
      total += result[s];
    }

    res.json({ counts: result, total });
  } catch (error) {
    console.error('Error obteniendo conteos:', error);
    res.status(500).json({ error: 'Error al obtener conteos' });
  }
};

// Obtener pedidos del usuario (o todas si es admin) con paginación
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export const getOrders = async (req, res) => {
  try {
    const userId = req.userId;
    const userRole = req.userRole;
    const { status, page: pageStr, limit: limitStr } = req.query;

    const page = Math.max(1, parseInt(pageStr, 10) || 1);
    let limit = parseInt(limitStr, 10) || DEFAULT_LIMIT;
    limit = Math.min(MAX_LIMIT, Math.max(1, limit));
    const skip = (page - 1) * limit;

    const where = {
      ...(userRole === 'CLIENTE' ? { userId } : {}),
      ...(status ? { status } : {})
    };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          items: true,
          branch: { select: { id: true, name: true } },
          user: { select: { id: true, name: true, email: true } },
          deliveryType: true,
        }
      }),
      prisma.order.count({ where })
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    res.json({
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Error obteniendo pedidos:', error);
    res.status(500).json({
      error: 'Error al obtener pedidos'
    });
  }
};

// Obtener un pedido específico
export const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const userRole = req.userRole;

    const order = await prisma.order.findUnique({
      where: { id: parseInt(id) },
      include: {
        items: true,
        branch: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, email: true } },
        deliveryType: true,
        statusHistory: { orderBy: { createdAt: 'asc' } },
      }
    });

    if (!order) {
      return res.status(404).json({
        error: 'Pedido no encontrado'
      });
    }

    // Verificar permisos (solo el dueño o admin puede ver)
    if (userRole !== 'ADMIN' && order.userId !== userId) {
      return res.status(403).json({
        error: 'No tienes permiso para ver este pedido'
      });
    }

    res.json(order);
  } catch (error) {
    console.error('Error obteniendo pedido:', error);
    res.status(500).json({
      error: 'Error al obtener pedido'
    });
  }
};

// Actualizar estado de pedido (solo admin) - uso limitado; preferir endpoints de flujo
// Cuando status es COMPLETED se puede enviar deliveredAt (ISO) para registrar cuándo fue entregado.
export const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, deliveredAt: deliveredAtBody } = req.body || {};

    const validStatuses = Object.values(OrderStatus);
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: 'Estado inválido'
      });
    }

    const currentOrder = await prisma.order.findUnique({
      where: { id: parseInt(id) },
      select: { status: true, userId: true }
    });

    if (!currentOrder) {
      return res.status(404).json({
        error: 'Pedido no encontrado'
      });
    }

    const data = { status };
    if (status === OrderStatus.COMPLETED) {
      const deliveredAtDate = deliveredAtBody ? new Date(deliveredAtBody) : new Date();
      if (Number.isNaN(deliveredAtDate.getTime())) {
        return res.status(400).json({ error: 'La fecha/hora de entrega no es válida.' });
      }
      data.deliveredAt = deliveredAtDate;
    }

    const order = await prisma.order.update({
      where: { id: parseInt(id) },
      data,
      include: {
        items: true,
        branch: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, email: true } },
        deliveryType: true,
        statusHistory: { orderBy: { createdAt: 'asc' } },
      }
    });

    await orderService.recordStatusHistory(parseInt(id), status);

    if (currentOrder.status !== status) {
      await createStatusChangeNotification(
        currentOrder.userId,
        'order',
        parseInt(id),
        status,
        currentOrder.status
      );
    }

    res.json({
      message: 'Estado actualizado exitosamente',
      order
    });
  } catch (error) {
    console.error('Error actualizando estado:', error);
    res.status(500).json({
      error: 'Error al actualizar estado'
    });
  }
};

// Actualizar disponibilidad de items del pedido (solo admin, solo cuando está PENDIENTE)
export const updateOrderItemsAvailability = async (req, res) => {
  try {
    const { id } = req.params;
    const { items } = req.body; // Array de { itemId, isAvailable }

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({
        error: 'Se requiere un array de items con su disponibilidad'
      });
    }

    // Verificar que el pedido existe y está en estado PENDIENTE
    const order = await prisma.order.findUnique({
      where: { id: parseInt(id) },
      include: { items: true }
    });

    if (!order) {
      return res.status(404).json({
        error: 'Pedido no encontrado'
      });
    }

    if (order.status !== OrderStatus.UNDER_REVIEW) {
      return res.status(400).json({
        error: 'Solo se puede actualizar la disponibilidad cuando el pedido está en revisión'
      });
    }

    // Actualizar cada item
    const updatePromises = items.map(({ itemId, isAvailable }) => {
      // Verificar que el item pertenece al pedido
      const item = order.items.find(i => i.id === itemId);
      if (!item) {
        throw new Error(`Item ${itemId} no pertenece al pedido ${id}`);
      }

      return prisma.orderItem.update({
        where: { id: itemId },
        data: { isAvailable }
      }); // confirmedQuantity y subtotal se fijan al "Confirmar disponibilidad"
    });

    await Promise.all(updatePromises);

    // Obtener el pedido actualizado
    const updatedOrder = await prisma.order.findUnique({
      where: { id: parseInt(id) },
      include: {
        items: true,
        branch: {
          select: {
            id: true,
            name: true
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    res.json({
      message: 'Disponibilidad de items actualizada exitosamente',
      order: updatedOrder
    });
  } catch (error) {
    console.error('Error actualizando disponibilidad de items:', error);
    res.status(500).json({
      error: error.message || 'Error al actualizar disponibilidad de items'
    });
  }
};

// Confirmar disponibilidad (admin): recalcula total y pasa a AVAILABLE o PARTIALLY_AVAILABLE
export const confirmOrderAvailability = async (req, res) => {
  try {
    const { id } = req.params;
    const { items } = req.body;
    const order = await orderService.reviewAvailability(id, items);
    res.json({
      message: 'Disponibilidad confirmada. El cliente ha sido notificado.',
      order
    });
  } catch (error) {
    const code = error.statusCode || 500;
    res.status(code).json({
      error: error.message || 'Error al confirmar disponibilidad'
    });
  }
};

// Cliente acepta pedido actualizado -> IN_PREPARATION
export const confirmOrderByCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const order = await orderService.confirmByCustomer(id, userId);
    res.json({
      message: 'Pedido aceptado. Estamos preparando tu pedido.',
      order
    });
  } catch (error) {
    const code = error.statusCode || 500;
    res.status(code).json({
      error: error.message || 'Error al aceptar el pedido'
    });
  }
};

// Admin marca como listo para recoger -> READY_FOR_PICKUP (opcional: readyAt en body)
export const markOrderReady = async (req, res) => {
  try {
    const { id } = req.params;
    const { readyAt } = req.body || {};
    const order = await orderService.markAsReady(id, readyAt);
    res.json({
      message: 'Pedido marcado como listo para recoger.',
      order
    });
  } catch (error) {
    const code = error.statusCode || 500;
    res.status(code).json({
      error: error.message || 'Error al marcar como listo'
    });
  }
};

// Cancelar pedido (cliente o admin)
export const cancelOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const isAdmin = req.userRole === 'ADMIN';
    const order = await orderService.cancelOrder(id, userId, isAdmin);
    res.json({
      message: 'Pedido cancelado.',
      order
    });
  } catch (error) {
    const code = error.statusCode || 500;
    res.status(code).json({
      error: error.message || 'Error al cancelar el pedido'
    });
  }
};

