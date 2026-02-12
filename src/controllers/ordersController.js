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

// Crear pedido
export const createOrder = async (req, res) => {
  try {
    const userId = req.userId;
    const { items, notes, branchId } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'El pedido debe contener al menos un producto'
      });
    }

    // Calcular total
    const total = items.reduce((sum, item) => sum + (item.subtotal || item.unitPrice * item.quantity), 0);

    // Crear pedido con items
    const order = await prisma.order.create({
      data: {
        folio: generateFolio(),
        total,
        status: OrderStatus.UNDER_REVIEW,
        notes: notes || null,
        userId,
        branchId: branchId || null,
        items: {
          create: items.map(item => ({
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            subtotal: item.subtotal || item.unitPrice * item.quantity
          }))
        }
      },
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

    res.status(201).json({
      message: 'Pedido creado exitosamente',
      order
    });
  } catch (error) {
    console.error('Error creando pedido:', error);
    res.status(500).json({
      error: 'Error al crear pedido'
    });
  }
};

// Obtener pedidos del usuario (o todas si es admin)
export const getOrders = async (req, res) => {
  try {
    const userId = req.userId;
    const userRole = req.userRole;
    const { status } = req.query;

    const where = {
      ...(userRole === 'CLIENTE' ? { userId } : {}), // Clientes solo ven las suyas
      ...(status ? { status } : {})
    };

    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
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

    res.json(orders);
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
export const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

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

    const order = await prisma.order.update({
      where: { id: parseInt(id) },
      data: { status },
      include: {
        items: true,
        branch: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, email: true } }
      }
    });

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

// Admin marca como listo para recoger -> READY_FOR_PICKUP
export const markOrderReady = async (req, res) => {
  try {
    const { id } = req.params;
    const order = await orderService.markAsReady(id);
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

