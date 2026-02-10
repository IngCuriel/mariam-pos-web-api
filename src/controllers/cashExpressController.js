import { PrismaClient } from '@prisma/client';
import { createStatusChangeNotification } from './notificationsController.js';

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

    // Obtener configuración para validar monto máximo y calcular comisión
    let config = await prisma.cashExpressConfig.findFirst();
    if (!config) {
      // Crear configuración por defecto si no existe
      config = await prisma.cashExpressConfig.create({
        data: {
          serviceDays: '[1,2,3,4,5]',
          startTime: '09:00',
          endTime: '20:00',
          holidays: '[]',
          nonWorkingDayMessage: 'Tu solicitud será procesada el próximo día hábil.',
          availableBalance: 0,
          dailyMinimumDeposit: 500,
          maxAmount: 1000,
          commissionPercentage: 6.5,
        },
      });
    }

    const maxAmount = config.maxAmount || 1000;
    const commissionPercentage = config.commissionPercentage || 6.5;

    // Validaciones
    if (!amount || amount <= 0) {
      return res.status(400).json({
        error: 'El monto debe ser mayor a $0'
      });
    }

    if (amount > maxAmount) {
      return res.status(400).json({
        error: `El monto máximo permitido es ${maxAmount.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}`
      });
    }

    // Los datos del remitente y destinatario son opcionales al crear la solicitud
    // Se pedirán después de que el admin valide el depósito

    // Calcular comisión como porcentaje
    const commission = (amount * commissionPercentage) / 100;
    
    // Calcular total con decimales
    const totalWithDecimals = amount + commission;
    
    // Redondear el total hacia arriba al siguiente peso entero (para depósitos en efectivo)
    // Esto asegura que el usuario siempre deposite un monto entero
    const totalToDeposit = Math.ceil(totalWithDecimals);

    // Calcular fecha estimada de entrega
    const availabilityResult = await calculateAvailabilityDate(parseFloat(amount));
    const estimatedDeliveryDate = availabilityResult ? availabilityResult.date : null;

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
        status: 'PENDIENTE',
        estimatedDeliveryDate: estimatedDeliveryDate
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

    // Obtener la solicitud actual una sola vez
    const currentRequest = await prisma.cashExpressRequest.findUnique({
      where: { id: parseInt(id) }
    });

    if (!currentRequest) {
      return res.status(404).json({
        error: 'Solicitud no encontrada'
      });
    }

    // Si se valida el depósito, usar fecha estimada como default si no se proporciona availableFrom
    let finalAvailableFrom = availableFrom;
    if (status === 'DEPOSITO_VALIDADO') {
      // Si no se proporciona availableFrom, usar estimatedDeliveryDate como default
      if (!availableFrom && currentRequest.estimatedDeliveryDate) {
        finalAvailableFrom = currentRequest.estimatedDeliveryDate.toISOString();
      } else if (!availableFrom) {
        // Si no hay fecha estimada ni disponible, usar fecha actual
        finalAvailableFrom = new Date().toISOString();
      }
    }

    // Si se está marcando como ENTREGADO, descontar del saldo
    if (status === 'ENTREGADO' && currentRequest.status !== 'ENTREGADO') {
      // Obtener configuración para actualizar el saldo
      let config = await prisma.cashExpressConfig.findFirst();
      if (!config) {
        return res.status(500).json({
          error: 'Configuración de Efectivo Express no encontrada'
        });
      }

      const amountToDeduct = currentRequest.amount; // Monto a entregar (sin comisión)
      const previousBalance = config.availableBalance;
      const newBalance = previousBalance - amountToDeduct;

      // Verificar que haya saldo suficiente
      if (newBalance < 0) {
        return res.status(400).json({
          error: `Saldo insuficiente. Saldo actual: ${previousBalance.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}, Monto a entregar: ${amountToDeduct.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}`
        });
      }

      // Actualizar saldo en configuración
      config = await prisma.cashExpressConfig.update({
        where: { id: config.id },
        data: {
          availableBalance: newBalance
        }
      });

      // Registrar retiro en historial
      await prisma.cashExpressBalanceHistory.create({
        data: {
          amount: -amountToDeduct, // Negativo porque es un retiro
          description: `Entrega de efectivo - Solicitud ${currentRequest.folio}`,
          previousBalance,
          newBalance,
          userId: req.userId, // Admin que marca como entregado
          cashExpressConfigId: config.id,
          cashExpressRequestId: parseInt(id) // Ligar con la solicitud
        }
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
        // Usar fecha proporcionada o la fecha estimada como default
        availableFrom: new Date(finalAvailableFrom)
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

    // Crear notificación si el estado cambió
    if (currentRequest.status !== status) {
      await createStatusChangeNotification(
        currentRequest.userId,
        'cash_express',
        parseInt(id),
        status,
        currentRequest.status
      );
    }

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

    // Permitir actualizar cuando el depósito está validado, pendiente o rebotado
    // Esto permite que el cliente complete los datos antes de enviar el comprobante
    const allowedStatuses = ['PENDIENTE', 'REBOTADO', 'DEPOSITO_VALIDADO'];
    if (!allowedStatuses.includes(request.status)) {
      return res.status(400).json({
        error: 'Solo se pueden actualizar los datos cuando la solicitud está pendiente, rebotada o validada'
      });
    }

    // Validar que los campos requeridos estén presentes (teléfonos son opcionales)
    if (!senderName || !recipientName || !relationship) {
      return res.status(400).json({
        error: 'Los campos requeridos son: nombre del remitente, nombre del destinatario y relación'
      });
    }

    // Actualizar los datos (teléfonos pueden ser vacíos o null)
    const updatedRequest = await prisma.cashExpressRequest.update({
      where: { id: parseInt(id) },
      data: {
        senderName,
        senderPhone: senderPhone || null, // Opcional, puede ser null
        recipientName,
        recipientPhone: recipientPhone || null, // Opcional, puede ser null
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
    const previousStatus = request.status;
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

    // Crear notificación si el estado cambió
    if (previousStatus !== 'EN_ESPERA_CONFIRMACION') {
      await createStatusChangeNotification(
        userId,
        'cash_express',
        parseInt(id),
        'EN_ESPERA_CONFIRMACION',
        previousStatus
      );
    }

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
          maxAmount: 1000,
          commissionPercentage: 6.5,
        },
      });
    }

    // Obtener cuentas bancarias activas
    const bankAccounts = await prisma.cashExpressBankAccount.findMany({
      where: {
        cashExpressConfigId: config.id,
        isActive: true,
      },
      orderBy: {
        displayOrder: 'asc',
      },
    });

    res.json({
      id: config.id,
      serviceDays: JSON.parse(config.serviceDays),
      startTime: config.startTime,
      endTime: config.endTime,
      holidays: JSON.parse(config.holidays),
      nonWorkingDayMessage: config.nonWorkingDayMessage,
      availableBalance: config.availableBalance || 0,
      dailyMinimumDeposit: config.dailyMinimumDeposit || 500,
      maxAmount: config.maxAmount || 1000,
      commissionPercentage: config.commissionPercentage || 6.5,
      bankAccounts: bankAccounts.map(account => ({
        id: account.id,
        beneficiaryName: account.beneficiaryName,
        accountNumber: account.accountNumber,
        clabe: account.clabe,
        concept: account.concept,
        bankName: account.bankName,
        displayOrder: account.displayOrder,
        isActive: account.isActive,
      })),
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
    const { serviceDays, startTime, endTime, holidays, nonWorkingDayMessage, dailyMinimumDeposit, maxAmount, commissionPercentage } = req.body;

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

    // Validar maxAmount si se proporciona
    if (maxAmount !== undefined && (maxAmount <= 0 || maxAmount > 100000)) {
      return res.status(400).json({
        error: 'El monto máximo debe estar entre $1 y $100,000',
      });
    }

    // Validar commissionPercentage si se proporciona
    if (commissionPercentage !== undefined && (commissionPercentage < 0 || commissionPercentage > 100)) {
      return res.status(400).json({
        error: 'El porcentaje de comisión debe estar entre 0% y 100%',
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
      const updateData = {
        serviceDays: JSON.stringify(serviceDays),
        startTime,
        endTime,
        holidays: JSON.stringify(holidays || []),
        nonWorkingDayMessage: nonWorkingDayMessage || 'Tu solicitud será procesada el próximo día hábil.',
      };

      if (dailyMinimumDeposit !== undefined) {
        updateData.dailyMinimumDeposit = dailyMinimumDeposit;
      }

      if (maxAmount !== undefined) {
        updateData.maxAmount = maxAmount;
      }

      if (commissionPercentage !== undefined) {
        updateData.commissionPercentage = commissionPercentage;
      }

      config = await prisma.cashExpressConfig.update({
        where: { id: config.id },
        data: updateData,
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
        maxAmount: config.maxAmount || 1000,
        commissionPercentage: config.commissionPercentage || 6.5,
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

    // Mensaje más breve y preciso
    let message;
    if (isAvailableNow) {
      message = 'Una vez validado el depósito, el efectivo estará disponible inmediatamente.';
    } else {
      message = formattedDate;
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

    const config = await prisma.cashExpressConfig.findFirst();
    if (!config) {
      return res.status(404).json({
        error: 'Configuración no encontrada',
      });
    }

    const history = await prisma.cashExpressBalanceHistory.findMany({
      where: {
        cashExpressConfigId: config.id,
      },
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
        cashExpressRequest: {
          select: {
            id: true,
            folio: true,
            amount: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
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

// Obtener cuentas bancarias activas (público, para mostrar al cliente)
export const getBankAccounts = async (req, res) => {
  try {
    const config = await prisma.cashExpressConfig.findFirst();
    
    if (!config) {
      return res.json([]);
    }

    const bankAccounts = await prisma.cashExpressBankAccount.findMany({
      where: {
        cashExpressConfigId: config.id,
        isActive: true,
      },
      orderBy: {
        displayOrder: 'asc',
      },
    });

    res.json(bankAccounts.map(account => ({
      id: account.id,
      beneficiaryName: account.beneficiaryName,
      accountNumber: account.accountNumber,
      clabe: account.clabe,
      concept: account.concept,
      bankName: account.bankName,
    })));
  } catch (error) {
    console.error('Error obteniendo cuentas bancarias:', error);
    res.status(500).json({
      error: 'Error al obtener cuentas bancarias',
    });
  }
};

// Crear cuenta bancaria (solo admin)
export const createBankAccount = async (req, res) => {
  try {
    const { beneficiaryName, accountNumber, clabe, concept, bankName, displayOrder } = req.body;

    if (!beneficiaryName || !accountNumber) {
      return res.status(400).json({
        error: 'El nombre del beneficiario y el número de cuenta son obligatorios',
      });
    }

    // Obtener configuración
    let config = await prisma.cashExpressConfig.findFirst();
    if (!config) {
      return res.status(404).json({
        error: 'Configuración no encontrada',
      });
    }

    // Obtener el máximo displayOrder para ponerlo al final
    const maxOrder = await prisma.cashExpressBankAccount.findFirst({
      where: { cashExpressConfigId: config.id },
      orderBy: { displayOrder: 'desc' },
      select: { displayOrder: true },
    });

    const newAccount = await prisma.cashExpressBankAccount.create({
      data: {
        beneficiaryName: beneficiaryName.trim(),
        accountNumber: accountNumber.trim(),
        clabe: clabe ? clabe.trim() : null,
        concept: concept ? concept.trim() : null,
        bankName: bankName ? bankName.trim() : null,
        displayOrder: displayOrder !== undefined ? displayOrder : (maxOrder?.displayOrder || 0) + 1,
        cashExpressConfigId: config.id,
      },
    });

    res.status(201).json({
      id: newAccount.id,
      beneficiaryName: newAccount.beneficiaryName,
      accountNumber: newAccount.accountNumber,
      clabe: newAccount.clabe,
      concept: newAccount.concept,
      bankName: newAccount.bankName,
      displayOrder: newAccount.displayOrder,
      isActive: newAccount.isActive,
    });
  } catch (error) {
    console.error('Error creando cuenta bancaria:', error);
    res.status(500).json({
      error: 'Error al crear cuenta bancaria',
    });
  }
};

// Actualizar cuenta bancaria (solo admin)
export const updateBankAccount = async (req, res) => {
  try {
    const { id } = req.params;
    const { beneficiaryName, accountNumber, clabe, concept, bankName, displayOrder, isActive } = req.body;

    if (!beneficiaryName || !accountNumber) {
      return res.status(400).json({
        error: 'El nombre del beneficiario y el número de cuenta son obligatorios',
      });
    }

    const account = await prisma.cashExpressBankAccount.findUnique({
      where: { id: parseInt(id) },
    });

    if (!account) {
      return res.status(404).json({
        error: 'Cuenta bancaria no encontrada',
      });
    }

    const updatedAccount = await prisma.cashExpressBankAccount.update({
      where: { id: parseInt(id) },
      data: {
        beneficiaryName: beneficiaryName.trim(),
        accountNumber: accountNumber.trim(),
        clabe: clabe !== undefined ? (clabe ? clabe.trim() : null) : account.clabe,
        concept: concept !== undefined ? (concept ? concept.trim() : null) : account.concept,
        bankName: bankName !== undefined ? (bankName ? bankName.trim() : null) : account.bankName,
        displayOrder: displayOrder !== undefined ? displayOrder : account.displayOrder,
        isActive: isActive !== undefined ? isActive : account.isActive,
      },
    });

    res.json({
      id: updatedAccount.id,
      beneficiaryName: updatedAccount.beneficiaryName,
      accountNumber: updatedAccount.accountNumber,
      clabe: updatedAccount.clabe,
      concept: updatedAccount.concept,
      bankName: updatedAccount.bankName,
      displayOrder: updatedAccount.displayOrder,
      isActive: updatedAccount.isActive,
    });
  } catch (error) {
    console.error('Error actualizando cuenta bancaria:', error);
    res.status(500).json({
      error: 'Error al actualizar cuenta bancaria',
    });
  }
};

// Eliminar cuenta bancaria (solo admin)
export const deleteBankAccount = async (req, res) => {
  try {
    const { id } = req.params;

    const account = await prisma.cashExpressBankAccount.findUnique({
      where: { id: parseInt(id) },
    });

    if (!account) {
      return res.status(404).json({
        error: 'Cuenta bancaria no encontrada',
      });
    }

    await prisma.cashExpressBankAccount.delete({
      where: { id: parseInt(id) },
    });

    res.json({ message: 'Cuenta bancaria eliminada exitosamente' });
  } catch (error) {
    console.error('Error eliminando cuenta bancaria:', error);
    res.status(500).json({
      error: 'Error al eliminar cuenta bancaria',
    });
  }
};

