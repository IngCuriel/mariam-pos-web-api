import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Generar folio único
const generateFolio = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `CE-${timestamp}-${random}`;
};

// Crear solicitud de efectivo express
export const createRequest = async (req, res) => {
  try {
    const userId = req.userId;
    const {
      amount,
      senderName,
      senderPhone,
      recipientName,
      recipientPhone,
      relationship
    } = req.body;

    // Validaciones
    if (!amount || amount <= 0 || amount > 1000) {
      return res.status(400).json({
        error: 'El monto debe estar entre $1 y $1,000'
      });
    }

    if (!senderName || !senderPhone || !recipientName || !recipientPhone || !relationship) {
      return res.status(400).json({
        error: 'Todos los campos son requeridos'
      });
    }

    const commission = 65;
    const totalToDeposit = amount + commission;

    // Crear solicitud
    const request = await prisma.cashExpressRequest.create({
      data: {
        folio: generateFolio(),
        amount: parseFloat(amount),
        commission,
        totalToDeposit,
        senderName,
        senderPhone,
        recipientName,
        recipientPhone,
        relationship,
        userId,
        status: 'PENDIENTE'
      }
    });

    res.status(201).json({
      message: 'Solicitud creada exitosamente',
      request
    });
  } catch (error) {
    console.error('Error creando solicitud:', error);
    res.status(500).json({
      error: 'Error al crear solicitud'
    });
  }
};

// Obtener solicitudes del usuario (o todas si es admin)
export const getRequests = async (req, res) => {
  try {
    const userId = req.userId;
    const userRole = req.userRole;
    const { status } = req.query;

    const where = {
      ...(userRole === 'CLIENTE' ? { userId } : {}), // Clientes solo ven las suyas
      ...(status ? { status } : {})
    };

    const requests = await prisma.cashExpressRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    res.json(requests);
  } catch (error) {
    console.error('Error obteniendo solicitudes:', error);
    res.status(500).json({
      error: 'Error al obtener solicitudes'
    });
  }
};

// Obtener una solicitud específica
export const getRequestById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const userRole = req.userRole;

    const request = await prisma.cashExpressRequest.findUnique({
      where: { id: parseInt(id) },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    if (!request) {
      return res.status(404).json({
        error: 'Solicitud no encontrada'
      });
    }

    // Verificar permisos (solo el dueño o admin puede ver)
    if (userRole !== 'ADMIN' && request.userId !== userId) {
      return res.status(403).json({
        error: 'No tienes permiso para ver esta solicitud'
      });
    }

    res.json(request);
  } catch (error) {
    console.error('Error obteniendo solicitud:', error);
    res.status(500).json({
      error: 'Error al obtener solicitud'
    });
  }
};

// Actualizar estado de solicitud (solo admin)
export const updateRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejectionReason, availableFrom } = req.body;

    const validStatuses = ['PENDIENTE', 'EN_ESPERA_CONFIRMACION', 'REBOTADO', 'DEPOSITO_VALIDADO', 'ENTREGADO', 'CANCELADO'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: 'Estado inválido'
      });
    }

    // Si se rebota, se requiere motivo
    if (status === 'REBOTADO' && !rejectionReason) {
      return res.status(400).json({
        error: 'Se requiere un motivo de rechazo'
      });
    }

    // Si se valida el depósito, se requiere fecha de disponibilidad
    if (status === 'DEPOSITO_VALIDADO' && !availableFrom) {
      return res.status(400).json({
        error: 'Se requiere la fecha y hora de disponibilidad para recoger'
      });
    }

    const updateData = {
      status,
      ...(status === 'REBOTADO' && { 
        rejectionReason,
        // NO limpiar comprobante para que el usuario pueda ver qué subió
      }),
      ...(status === 'DEPOSITO_VALIDADO' && { 
        depositValidatedAt: new Date(),
        // Fecha de disponibilidad es requerida
        availableFrom: new Date(availableFrom)
      }),
      ...(status === 'ENTREGADO' && { deliveredAt: new Date() })
    };

    const request = await prisma.cashExpressRequest.update({
      where: { id: parseInt(id) },
      data: updateData,
      include: {
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
      message: 'Estado actualizado exitosamente',
      request
    });
  } catch (error) {
    console.error('Error actualizando estado:', error);
    res.status(500).json({
      error: 'Error al actualizar estado'
    });
  }
};

// Subir comprobante de depósito
export const uploadDepositReceipt = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const { depositReceipt } = req.body; // URL de Cloudinary

    if (!depositReceipt) {
      return res.status(400).json({
        error: 'Se requiere el comprobante de depósito'
      });
    }

    // Verificar que la solicitud existe y pertenece al usuario
    const request = await prisma.cashExpressRequest.findUnique({
      where: { id: parseInt(id) }
    });

    if (!request) {
      return res.status(404).json({
        error: 'Solicitud no encontrada'
      });
    }

    if (request.userId !== userId) {
      return res.status(403).json({
        error: 'No tienes permiso para actualizar esta solicitud'
      });
    }

    if (request.status !== 'PENDIENTE' && request.status !== 'REBOTADO' && request.status !== 'EN_ESPERA_CONFIRMACION') {
      return res.status(400).json({
        error: 'Solo se puede subir comprobante en solicitudes pendientes, en espera de confirmación o rebotadas'
      });
    }

    // Determinar el nuevo estado basado en si ya había un comprobante
    const hasExistingReceipt = !!request.depositReceipt;
    const newStatus = hasExistingReceipt ? 'EN_ESPERA_CONFIRMACION' : 'EN_ESPERA_CONFIRMACION';

    // Actualizar comprobante y cambiar estado
    const updatedRequest = await prisma.cashExpressRequest.update({
      where: { id: parseInt(id) },
      data: {
        depositReceipt,
        status: newStatus, // Cambiar a "En espera de confirmación"
        rejectionReason: null // Limpiar motivo de rechazo si había uno
      },
      include: {
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
      message: 'Comprobante subido exitosamente',
      request: updatedRequest
    });
  } catch (error) {
    console.error('Error subiendo comprobante:', error);
    res.status(500).json({
      error: 'Error al subir comprobante'
    });
  }
};

