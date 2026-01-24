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

    // Los datos del remitente y destinatario son opcionales al crear la solicitud
    // Se pedirán después de que el admin valide el depósito

    const commission = 65;
    const totalToDeposit = amount + commission;

    // Crear solicitud (solo con el monto)
    const request = await prisma.cashExpressRequest.create({
      data: {
        folio: generateFolio(),
        amount: parseFloat(amount),
        commission,
        totalToDeposit,
        senderName: senderName || null,
        senderPhone: senderPhone || null,
        recipientName: recipientName || null,
        recipientPhone: recipientPhone || null,
        relationship: relationship || null,
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
export const uploadSignedReceipt = async (req, res) => {
  try {
    const { id } = req.params;
    const { signedReceipt } = req.body; // URL de Cloudinary

    if (!signedReceipt) {
      return res.status(400).json({
        error: 'Se requiere el comprobante firmado'
      });
    }

    // Verificar que la solicitud existe
    const request = await prisma.cashExpressRequest.findUnique({
      where: { id: parseInt(id) }
    });

    if (!request) {
      return res.status(404).json({
        error: 'Solicitud no encontrada'
      });
    }

    // Solo permitir subir comprobante firmado cuando el estado es DEPOSITO_VALIDADO
    if (request.status !== 'DEPOSITO_VALIDADO') {
      return res.status(400).json({
        error: 'Solo se puede subir comprobante firmado cuando el depósito está validado'
      });
    }

    // Actualizar el comprobante firmado
    const updatedRequest = await prisma.cashExpressRequest.update({
      where: { id: parseInt(id) },
      data: {
        signedReceipt
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

    return res.json({
      message: 'Comprobante firmado subido correctamente',
      request: updatedRequest
    });
  } catch (error) {
    console.error('Error subiendo comprobante firmado:', error);
    return res.status(500).json({
      error: 'Error al subir el comprobante firmado'
    });
  }
};

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

    // Solo permitir subir/reemplazar comprobante en estados PENDIENTE o REBOTADO
    // Cuando está EN_ESPERA_CONFIRMACION, el admin está revisando, no se puede modificar
    if (request.status !== 'PENDIENTE' && request.status !== 'REBOTADO') {
      return res.status(400).json({
        error: 'Solo se puede subir o reemplazar comprobante en solicitudes pendientes o rechazadas. Si tu comprobante está en revisión, espera la respuesta del administrador.'
      });
    }

    // Actualizar solo el comprobante, SIN cambiar el estado
    // El estado solo cambia cuando el usuario confirma/envía el comprobante
    const updatedRequest = await prisma.cashExpressRequest.update({
      where: { id: parseInt(id) },
      data: {
        depositReceipt,
        // Mantener el estado actual (no cambiar automáticamente)
        // Limpiar motivo de rechazo si había uno
        ...(request.status === 'REBOTADO' && { rejectionReason: null })
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

// Actualizar datos del remitente y destinatario (solo cuando el depósito está validado)
export const updateRecipientData = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;
    const { senderName, senderPhone, recipientName, recipientPhone, relationship } = req.body;

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

    // Solo permitir actualizar cuando el depósito está validado
    if (request.status !== 'DEPOSITO_VALIDADO') {
      return res.status(400).json({
        error: 'Solo se pueden actualizar los datos cuando el depósito está validado'
      });
    }

    // Validar que todos los campos estén presentes
    if (!senderName || !senderPhone || !recipientName || !recipientPhone || !relationship) {
      return res.status(400).json({
        error: 'Todos los campos son requeridos'
      });
    }

    // Actualizar los datos
    const updatedRequest = await prisma.cashExpressRequest.update({
      where: { id: parseInt(id) },
      data: {
        senderName,
        senderPhone,
        recipientName,
        recipientPhone,
        relationship
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
      message: 'Datos actualizados exitosamente',
      request: updatedRequest
    });
  } catch (error) {
    console.error('Error actualizando datos:', error);
    res.status(500).json({
      error: 'Error al actualizar datos'
    });
  }
};

// Confirmar/Enviar comprobante (cambia estado a EN_ESPERA_CONFIRMACION)
export const confirmDepositReceipt = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.userId;

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

    if (!request.depositReceipt) {
      return res.status(400).json({
        error: 'No hay comprobante para confirmar. Por favor, sube un comprobante primero.'
      });
    }

    if (request.status !== 'PENDIENTE' && request.status !== 'REBOTADO') {
      return res.status(400).json({
        error: 'Solo se puede confirmar comprobante en solicitudes pendientes o rebotadas'
      });
    }

    // Cambiar estado a "En espera de confirmación" y guardar fecha de envío
    const updatedRequest = await prisma.cashExpressRequest.update({
      where: { id: parseInt(id) },
      data: {
        status: 'EN_ESPERA_CONFIRMACION',
        receiptSentAt: new Date(), // Guardar fecha de envío del comprobante
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
      message: 'Comprobante enviado a revisión exitosamente',
      request: updatedRequest
    });
    } catch (error) {
    console.error('Error confirmando comprobante:', error);
    res.status(500).json({
      error: 'Error al confirmar comprobante'
    });
  }
};

// Obtener configuración de Efectivo Express
export const getConfig = async (req, res) => {
  try {
    let config = await prisma.cashExpressConfig.findFirst();

    // Si no existe configuración, crear una por defecto
    if (!config) {
      config = await prisma.cashExpressConfig.create({
        data: {
          serviceDays: '[1,2,3,4,5]', // Lunes a viernes
          startTime: '09:00',
          endTime: '20:00',
          holidays: '[]',
          nonWorkingDayMessage: 'Tu solicitud será procesada el próximo día hábil.',
          availableBalance: 0,
          dailyMinimumDeposit: 500,
        },
      });
    }

    res.json({
      id: config.id,
      serviceDays: JSON.parse(config.serviceDays),
      startTime: config.startTime,
      endTime: config.endTime,
      holidays: JSON.parse(config.holidays),
      nonWorkingDayMessage: config.nonWorkingDayMessage,
      availableBalance: config.availableBalance || 0,
      dailyMinimumDeposit: config.dailyMinimumDeposit || 500,
    });
  } catch (error) {
    console.error('Error obteniendo configuración:', error);
    res.status(500).json({
      error: 'Error al obtener configuración',
    });
  }
};

// Actualizar configuración de Efectivo Express
export const updateConfig = async (req, res) => {
  try {
    const { serviceDays, startTime, endTime, holidays, nonWorkingDayMessage, dailyMinimumDeposit } = req.body;

    // Validaciones
    if (!Array.isArray(serviceDays) || serviceDays.length === 0) {
      return res.status(400).json({
        error: 'Debe seleccionar al menos un día de servicio',
      });
    }

    if (!startTime || !endTime) {
      return res.status(400).json({
        error: 'Debe especificar horario de inicio y fin',
      });
    }

    // Validar formato de hora (HH:MM)
    const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
      return res.status(400).json({
        error: 'Formato de hora inválido. Use HH:MM (24 horas)',
      });
    }

    // Validar que startTime < endTime
    const [startHour, startMin] = startTime.split(':').map(Number);
    const [endHour, endMin] = endTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    if (startMinutes >= endMinutes) {
      return res.status(400).json({
        error: 'El horario de inicio debe ser anterior al horario de fin',
      });
    }

    // Validar holidays si se proporciona
    if (holidays && !Array.isArray(holidays)) {
      return res.status(400).json({
        error: 'Los días festivos deben ser un array',
      });
    }

    // Obtener o crear configuración
    let config = await prisma.cashExpressConfig.findFirst();

    if (!config) {
      config = await prisma.cashExpressConfig.create({
        data: {
          serviceDays: JSON.stringify(serviceDays),
          startTime,
          endTime,
          holidays: JSON.stringify(holidays || []),
          nonWorkingDayMessage: nonWorkingDayMessage || 'Tu solicitud será procesada el próximo día hábil.',
          dailyMinimumDeposit: dailyMinimumDeposit || 500,
        },
      });
    } else {
      config = await prisma.cashExpressConfig.update({
        where: { id: config.id },
        data: {
          serviceDays: JSON.stringify(serviceDays),
          startTime,
          endTime,
          holidays: JSON.stringify(holidays || []),
          nonWorkingDayMessage: nonWorkingDayMessage || 'Tu solicitud será procesada el próximo día hábil.',
          ...(dailyMinimumDeposit !== undefined && { dailyMinimumDeposit }),
        },
      });
    }

    res.json({
      message: 'Configuración actualizada exitosamente',
      config: {
        id: config.id,
        serviceDays: JSON.parse(config.serviceDays),
        startTime: config.startTime,
        endTime: config.endTime,
        holidays: JSON.parse(config.holidays),
        nonWorkingDayMessage: config.nonWorkingDayMessage,
        availableBalance: config.availableBalance || 0,
        dailyMinimumDeposit: config.dailyMinimumDeposit || 500,
      },
    });
  } catch (error) {
    console.error('Error actualizando configuración:', error);
    res.status(500).json({
      error: 'Error al actualizar configuración',
    });
  }
};

// Calcular fecha estimada de entrega basada en saldo y solicitudes pendientes
export const calculateAvailabilityDate = async (amount) => {
  try {
    const config = await prisma.cashExpressConfig.findFirst();
    if (!config) {
      return null;
    }

    const availableBalance = config.availableBalance || 0;
    const dailyMinimumDeposit = config.dailyMinimumDeposit || 500;
    const serviceDays = JSON.parse(config.serviceDays || '[1,2,3,4,5]');
    const holidays = JSON.parse(config.holidays || '[]');

    // Contar solicitudes pendientes que están esperando procesamiento
    const pendingRequests = await prisma.cashExpressRequest.count({
      where: {
        status: {
          in: ['PENDIENTE', 'EN_ESPERA_CONFIRMACION', 'DEPOSITO_VALIDADO']
        }
      }
    });

    // Calcular el monto total de solicitudes pendientes
    const pendingAmounts = await prisma.cashExpressRequest.findMany({
      where: {
        status: {
          in: ['PENDIENTE', 'EN_ESPERA_CONFIRMACION', 'DEPOSITO_VALIDADO']
        }
      },
      select: {
        amount: true
      }
    });

    const totalPendingAmount = pendingAmounts.reduce((sum, req) => sum + req.amount, 0);

    // Si hay saldo suficiente para cubrir esta solicitud y las pendientes, está disponible hoy
    if (availableBalance >= (amount + totalPendingAmount)) {
      return { date: new Date(), isAvailableNow: true, pendingRequests: pendingRequests };
    }

    // Calcular cuánto dinero falta considerando solicitudes pendientes
    const totalNeeded = (amount + totalPendingAmount) - availableBalance;
    
    // Calcular cuántos días hábiles se necesitan
    // Considerando que cada día se abona mínimo dailyMinimumDeposit
    const daysNeeded = Math.ceil(totalNeeded / dailyMinimumDeposit);

    // Calcular fecha de disponibilidad
    let currentDate = new Date();
    let workingDaysAdded = 0;
    let daysToAdd = 0;

    while (workingDaysAdded < daysNeeded) {
      daysToAdd++;
      const checkDate = new Date(currentDate);
      checkDate.setDate(currentDate.getDate() + daysToAdd);
      
      const dayOfWeek = checkDate.getDay();
      const dateString = `${checkDate.getFullYear()}-${(checkDate.getMonth() + 1).toString().padStart(2, '0')}-${checkDate.getDate().toString().padStart(2, '0')}`;
      
      // Verificar si es día hábil y no es festivo
      if (serviceDays.includes(dayOfWeek) && !holidays.includes(dateString)) {
        workingDaysAdded++;
      }
    }

    const availabilityDate = new Date(currentDate);
    availabilityDate.setDate(currentDate.getDate() + daysToAdd);
    
    return { date: availabilityDate, isAvailableNow: false, pendingRequests: pendingRequests };
  } catch (error) {
    console.error('Error calculando fecha de disponibilidad:', error);
    return null;
  }
};

// Obtener fecha estimada de entrega (endpoint público para clientes)
export const getSuggestedAvailability = async (req, res) => {
  try {
    const { amount } = req.query;
    
    if (!amount || isNaN(parseFloat(amount))) {
      return res.status(400).json({
        error: 'Se requiere el monto para calcular la fecha estimada de entrega',
      });
    }

    const result = await calculateAvailabilityDate(parseFloat(amount));
    
    if (!result) {
      return res.status(500).json({
        error: 'Error al calcular fecha estimada de entrega',
      });
    }

    const { date, isAvailableNow, pendingRequests } = result;
    const now = new Date();

    // Formatear fecha de manera profesional
    const formattedDate = date.toLocaleDateString('es-MX', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    let message;
    if (isAvailableNow) {
      message = 'Tu solicitud puede ser procesada y entregada inmediatamente. El efectivo estará disponible de forma instantánea una vez validado el depósito.';
    } else {
      const daysUntil = Math.ceil((date - now) / (1000 * 60 * 60 * 24));
      if (pendingRequests > 0) {
        message = `Fecha estimada de entrega: ${formattedDate}. Esta estimación considera el volumen actual de solicitudes en proceso (${pendingRequests} solicitud${pendingRequests > 1 ? 'es' : ''} pendiente${pendingRequests > 1 ? 's' : ''}) y los tiempos de procesamiento del servicio.`;
      } else {
        message = `Fecha estimada de entrega: ${formattedDate}. Esta estimación se basa en los tiempos de procesamiento y la capacidad operativa del servicio.`;
      }
    }

    res.json({
      estimatedDeliveryDate: date.toISOString(),
      isAvailableNow,
      pendingRequests: pendingRequests || 0,
      message,
      formattedDate,
    });
  } catch (error) {
    console.error('Error obteniendo fecha estimada de entrega:', error);
    res.status(500).json({
      error: 'Error al calcular fecha estimada de entrega',
    });
  }
};

// Agregar abono de saldo (solo admin)
export const addBalance = async (req, res) => {
  try {
    const userId = req.userId;
    const { amount, description } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        error: 'El monto debe ser mayor a 0',
      });
    }

    // Obtener configuración
    let config = await prisma.cashExpressConfig.findFirst();
    if (!config) {
      return res.status(404).json({
        error: 'Configuración no encontrada',
      });
    }

    const previousBalance = config.availableBalance || 0;
    const newBalance = previousBalance + parseFloat(amount);

    // Actualizar saldo
    config = await prisma.cashExpressConfig.update({
      where: { id: config.id },
      data: {
        availableBalance: newBalance,
      },
    });

    // Registrar en historial
    await prisma.cashExpressBalanceHistory.create({
      data: {
        amount: parseFloat(amount),
        description: description || 'Abono de saldo',
        previousBalance,
        newBalance,
        userId,
        cashExpressConfigId: config.id,
      },
    });

    res.json({
      message: 'Abono agregado exitosamente',
      balance: {
        previousBalance,
        amount: parseFloat(amount),
        newBalance,
      },
    });
  } catch (error) {
    console.error('Error agregando abono:', error);
    res.status(500).json({
      error: 'Error al agregar abono',
    });
  }
};

// Obtener historial de saldo (solo admin)
export const getBalanceHistory = async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const history = await prisma.cashExpressBalanceHistory.findMany({
      take: parseInt(limit),
      skip: parseInt(offset),
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    const total = await prisma.cashExpressBalanceHistory.count();

    res.json({
      history,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    console.error('Error obteniendo historial:', error);
    res.status(500).json({
      error: 'Error al obtener historial',
    });
  }
};

// Obtener saldo actual (público, para mostrar al cliente)
export const getCurrentBalance = async (req, res) => {
  try {
    const config = await prisma.cashExpressConfig.findFirst();
    
    if (!config) {
      return res.json({
        availableBalance: 0,
        dailyMinimumDeposit: 500,
      });
    }

    res.json({
      availableBalance: config.availableBalance || 0,
      dailyMinimumDeposit: config.dailyMinimumDeposit || 500,
    });
  } catch (error) {
    console.error('Error obteniendo saldo:', error);
    res.status(500).json({
      error: 'Error al obtener saldo',
    });
  }
};

