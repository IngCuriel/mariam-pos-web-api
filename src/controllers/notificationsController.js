import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Mensajes según el cambio de estado
const STATUS_MESSAGES = {
  // CashExpress
  CASH_EXPRESS_PENDIENTE: {
    title: 'Solicitud Pendiente',
    message: 'Tu solicitud de Efectivo Express está pendiente de depósito.',
    action: 'Realiza el depósito y sube tu comprobante.',
  },
  CASH_EXPRESS_EN_ESPERA_CONFIRMACION: {
    title: 'En Espera de Confirmación',
    message: 'Tu depósito está siendo validado.',
    action: 'Espera la confirmación de tu depósito.',
  },
  CASH_EXPRESS_REBOTADO: {
    title: 'Depósito Rechazado',
    message: 'Tu depósito fue rechazado. Verifica los datos.',
    action: 'Revisa los detalles y contacta con soporte.',
  },
  CASH_EXPRESS_DEPOSITO_VALIDADO: {
    title: 'Depósito Validado',
    message: 'Tu depósito ha sido validado exitosamente.',
    action: 'Tu solicitud está siendo procesada.',
  },
  CASH_EXPRESS_ENTREGADO: {
    title: 'Solicitud Entregada',
    message: 'Tu solicitud ha sido entregada exitosamente.',
    action: 'Gracias por usar Efectivo Express.',
  },
  CASH_EXPRESS_CANCELADO: {
    title: 'Solicitud Cancelada',
    message: 'Tu solicitud ha sido cancelada.',
    action: 'Contacta con soporte si tienes dudas.',
  },
  // Orders
  ORDER_PENDIENTE: {
    title: 'Pedido Pendiente',
    message: 'Tu pedido está pendiente de confirmación.',
    action: 'Revisa los detalles de tu pedido.',
  },
  ORDER_CONFIRMADO: {
    title: 'Pedido Confirmado',
    message: 'Tu pedido ha sido confirmado.',
    action: 'Tu pedido está siendo preparado.',
  },
  ORDER_EN_PREPARACION: {
    title: 'Pedido en Preparación',
    message: 'Tu pedido está siendo preparado.',
    action: 'Pronto estará listo para entrega.',
  },
  ORDER_LISTO: {
    title: 'Pedido Listo',
    message: 'Tu pedido está listo para recoger.',
    action: 'Ve a la sucursal a recoger tu pedido.',
  },
  ORDER_ENTREGADO: {
    title: 'Pedido Entregado',
    message: 'Tu pedido ha sido entregado exitosamente.',
    action: 'Gracias por tu compra.',
  },
  ORDER_CANCELADO: {
    title: 'Pedido Cancelado',
    message: 'Tu pedido ha sido cancelado.',
    action: 'Contacta con soporte si tienes dudas.',
  },
};

/**
 * Crear notificación cuando cambia el estado
 */
export const createStatusChangeNotification = async (userId, type, entityId, status, previousStatus = null) => {
  try {
    // Normalizar el nombre del estado para CashExpress
    let messageKey;
    if (type === 'cash_express') {
      const normalizedStatus = status.replace(/\s+/g, '_').toUpperCase();
      messageKey = `CASH_EXPRESS_${normalizedStatus}`;
    } else {
      messageKey = `ORDER_${status}`;
    }

    const message = STATUS_MESSAGES[messageKey];
    if (!message) {
      console.warn(`No hay mensaje para el estado: ${messageKey}`);
      return null;
    }

    // Calcular fecha de expiración (5 días desde ahora)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 5);

    const notification = await prisma.notification.create({
      data: {
        userId,
        type,
        entityId,
        title: message.title,
        message: message.message,
        action: message.action,
        status,
        previousStatus,
        read: false,
        expiresAt,
      },
    });

    return notification;
  } catch (error) {
    console.error('Error creando notificación:', error);
    return null;
  }
};

/**
 * Obtener notificaciones del usuario
 */
export const getNotifications = async (req, res) => {
  try {
    const userId = req.userId;
    const { read, limit = 50 } = req.query;

    const where = {
      userId,
      expiresAt: {
        gt: new Date(), // Solo notificaciones no expiradas
      },
    };

    if (read !== undefined) {
      where.read = read === 'true';
    }

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit),
    });

    // Limpiar notificaciones expiradas
    await prisma.notification.deleteMany({
      where: {
        expiresAt: {
          lte: new Date(),
        },
      },
    });

    res.json(notifications);
  } catch (error) {
    console.error('Error obteniendo notificaciones:', error);
    res.status(500).json({
      error: 'Error al obtener notificaciones',
    });
  }
};

/**
 * Obtener contador de notificaciones no leídas
 */
export const getUnreadCount = async (req, res) => {
  try {
    const userId = req.userId;

    const count = await prisma.notification.count({
      where: {
        userId,
        read: false,
        expiresAt: {
          gt: new Date(),
        },
      },
    });

    res.json({ count });
  } catch (error) {
    console.error('Error obteniendo contador:', error);
    res.status(500).json({
      error: 'Error al obtener contador',
    });
  }
};

/**
 * Marcar notificación como leída
 */
export const markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const notification = await prisma.notification.findUnique({
      where: { id: parseInt(id) },
    });

    if (!notification) {
      return res.status(404).json({
        error: 'Notificación no encontrada',
      });
    }

    // Verificar que la notificación pertenece al usuario
    if (notification.userId !== userId) {
      return res.status(403).json({
        error: 'No tienes permiso para esta notificación',
      });
    }

    // Si no está leída, actualizar y extender expiración a 1 día
    if (!notification.read) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 1);

      const updated = await prisma.notification.update({
        where: { id: parseInt(id) },
        data: {
          read: true,
          readAt: new Date(),
          expiresAt,
        },
      });

      return res.json(updated);
    }

    res.json(notification);
  } catch (error) {
    console.error('Error marcando como leída:', error);
    res.status(500).json({
      error: 'Error al marcar como leída',
    });
  }
};

/**
 * Marcar todas las notificaciones como leídas
 */
export const markAllAsRead = async (req, res) => {
  try {
    const userId = req.userId;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 1);

    const result = await prisma.notification.updateMany({
      where: {
        userId,
        read: false,
        expiresAt: {
          gt: new Date(),
        },
      },
      data: {
        read: true,
        readAt: new Date(),
        expiresAt,
      },
    });

    res.json({
      message: 'Todas las notificaciones marcadas como leídas',
      count: result.count,
    });
  } catch (error) {
    console.error('Error marcando todas como leídas:', error);
    res.status(500).json({
      error: 'Error al marcar todas como leídas',
    });
  }
};

/**
 * Eliminar notificación
 */
export const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const notification = await prisma.notification.findUnique({
      where: { id: parseInt(id) },
    });

    if (!notification) {
      return res.status(404).json({
        error: 'Notificación no encontrada',
      });
    }

    // Verificar que la notificación pertenece al usuario
    if (notification.userId !== userId) {
      return res.status(403).json({
        error: 'No tienes permiso para eliminar esta notificación',
      });
    }

    await prisma.notification.delete({
      where: { id: parseInt(id) },
    });

    res.json({
      message: 'Notificación eliminada',
    });
  } catch (error) {
    console.error('Error eliminando notificación:', error);
    res.status(500).json({
      error: 'Error al eliminar notificación',
    });
  }
};

