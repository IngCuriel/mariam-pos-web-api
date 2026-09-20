import { PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';
import { resolveAllowedBranches } from '../utils/userBranches.js';
import {
  paddedUtcWindowForBusinessRange,
  businessCalendarDateFromDbInstant,
} from '../utils/businessTimezone.js';
import { validateCashierTransaction } from '../utils/cashierTransactionValidation.js';

/** Zona horaria de negocio para el filtro por día civil. */
const MEXICO_TZ = 'America/Mexico_City';

const prisma = new PrismaClient();

/**
 * Valores permitidos de `type` para una transacción de cajero.
 * Coincide con el enum `CashierTransactionType` del esquema Prisma.
 */
export const CASHIER_TRANSACTION_TYPES = ['RECARGA', 'PAGO_SERVICIO', 'PIN_ELECTRONICO'];

/**
 * Estructura base de totales para un listado vacío o sin transacciones.
 * `byType` incluye una entrada en 0 por cada valor del enum; `grandTotal` y
 * `count` inician en 0. Se usa una factoría para evitar compartir referencias
 * mutables entre respuestas.
 * @returns {{ byType: Record<string, number>, grandTotal: number, count: number }}
 */
export const emptyTotals = () => ({
  byType: CASHIER_TRANSACTION_TYPES.reduce((acc, type) => {
    acc[type] = 0;
    return acc;
  }, {}),
  grandTotal: 0,
  count: 0,
});

/**
 * Redondea un valor monetario a 2 decimales evitando el arrastre de error de
 * punto flotante (por ejemplo `1.005 -> 1.01`). Los valores negativos por
 * ruido numérico se saturan a 0 para respetar la invariante de montos >= 0.
 * @param {number} value
 * @returns {number}
 */
const roundMoney = (value) => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
};

/**
 * Calcula los totales de un conjunto de transacciones ya filtrado y autorizado.
 * `byType` incluye una entrada por cada valor del enum (0 cuando no hay
 * transacciones de ese tipo); `grandTotal` es la suma de las entradas de
 * `byType`; `count` es la cantidad de transacciones. Todos los montos se
 * redondean a 2 decimales y la invariante `grandTotal === suma(byType)` se
 * mantiene al derivar `grandTotal` de los valores ya redondeados.
 * @param {Array<{ type: string, amount: number }>} rows
 * @returns {{ byType: Record<string, number>, grandTotal: number, count: number }}
 */
export const calculateTotals = (rows) => {
  const totals = emptyTotals();
  if (!Array.isArray(rows) || rows.length === 0) return totals;

  // Acumula el monto crudo por tipo (solo tipos conocidos del enum).
  const rawByType = CASHIER_TRANSACTION_TYPES.reduce((acc, type) => {
    acc[type] = 0;
    return acc;
  }, {});

  for (const row of rows) {
    if (row == null) continue;
    const { type } = row;
    if (!Object.prototype.hasOwnProperty.call(rawByType, type)) continue;
    const amount = Number(row.amount);
    if (Number.isFinite(amount)) rawByType[type] += amount;
  }

  // Redondea cada entrada de `byType` y deriva `grandTotal` de esos valores ya
  // redondeados, garantizando `grandTotal === suma(byType)`.
  let grandTotal = 0;
  for (const type of CASHIER_TRANSACTION_TYPES) {
    const rounded = roundMoney(rawByType[type]);
    totals.byType[type] = rounded;
    grandTotal += rounded;
  }

  totals.grandTotal = roundMoney(grandTotal);
  totals.count = rows.length;
  return totals;
};

/**
 * Verifica si un usuario admin puede operar sobre una transacción de una
 * sucursal dada. El super admin puede con todas; el admin, solo con las suyas.
 * Reutiliza `resolveAllowedBranches` (mismo patrón que `ordersController`).
 * @param {number} userId
 * @param {string} userRole
 * @param {number} branchId
 * @returns {Promise<boolean>}
 */
async function adminCanAccessBranch(userId, userRole, branchId) {
  const allowed = await resolveAllowedBranches(userId, userRole);
  if (allowed.unrestricted) return true;
  if (branchId == null) return false;
  return allowed.branchIds.includes(branchId);
}

/**
 * Normaliza un parámetro de fecha `YYYY-MM-DD` (recorta a 10 caracteres).
 * @param {unknown} value
 * @returns {string} cadena vacía si el valor está ausente.
 */
const normalizeDateParam = (value) =>
  value != null ? String(value).trim().slice(0, 10) : '';

/**
 * Compara un instante de BD contra un rango de días civiles de negocio (MX),
 * ambos límites inclusivos. Es el análogo de `filterRowsByBusinessDateRange`
 * pero aplicado sobre `registeredAt` en lugar de `createdAt` (el util
 * compartido no se modifica porque lo usan CashExpress y Ventas).
 * @param {Date} instant
 * @param {string} dateFrom YYYY-MM-DD
 * @param {string} dateTo YYYY-MM-DD
 * @returns {boolean}
 */
const registeredAtInBusinessRange = (instant, dateFrom, dateTo) => {
  const ymd = businessCalendarDateFromDbInstant(instant);
  return ymd >= dateFrom && ymd <= dateTo;
};

/**
 * Forma de inclusión de relaciones anidadas para las respuestas de una
 * transacción: `branch` (`id`, `name`) y `user` (`id`, `name`, `email`).
 * Se centraliza para mantener consistencia entre listado, creación,
 * actualización y demás respuestas.
 */
const TRANSACTION_INCLUDE = {
  branch: { select: { id: true, name: true } },
  user: { select: { id: true, name: true, email: true } },
};

/**
 * Trunca un instante a precisión de segundos (elimina los milisegundos),
 * devolviendo un nuevo `Date`. Se usa al asignar `registeredAt = ahora` cuando
 * el cuerpo de la solicitud no lo trae (Req 2.2).
 * @param {Date} instant
 * @returns {Date}
 */
const truncateToSeconds = (instant) => {
  const copy = new Date(instant.getTime());
  copy.setMilliseconds(0);
  return copy;
};

/**
 * GET /api/cashier-transactions
 * Lista las transacciones de cajero aplicando autorización por sucursal y los
 * filtros opcionales `dateFrom`, `dateTo`, `type` y `branchId`. Devuelve los
 * registros (con `branch` y `user` anidados) ordenados por `registeredAt` desc,
 * e `id` desc como desempate, junto con los totales del periodo.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const getCashierTransactions = async (req, res) => {
  try {
    const userId = req.userId;
    const userRole = req.userRole;
    const { type, branchId: branchIdParam } = req.query;

    // Sucursales permitidas del usuario. Un admin sin sucursales no ve nada.
    const allowed = await resolveAllowedBranches(userId, userRole);
    if (!allowed.unrestricted && allowed.branchIds.length === 0) {
      return res.json({ transactions: [], totals: emptyTotals() });
    }

    // Validación de `type` (opcional): debe pertenecer al enum si viene.
    if (type != null && String(type).trim() !== '') {
      if (!CASHIER_TRANSACTION_TYPES.includes(String(type))) {
        return res.status(400).json({
          error: `El parámetro 'type' no es válido. Valores permitidos: ${CASHIER_TRANSACTION_TYPES.join(', ')}.`,
          field: 'type',
        });
      }
    }

    // Validación de rango de fechas (opcional). Si viene uno, deben venir ambos.
    const fromRaw = normalizeDateParam(req.query.dateFrom);
    const toRaw = normalizeDateParam(req.query.dateTo);
    let dateRange = null;
    if (fromRaw || toRaw) {
      if (!fromRaw || !toRaw) {
        return res.status(400).json({
          error: "Para filtrar por fecha envía 'dateFrom' y 'dateTo' en formato YYYY-MM-DD (día civil hora de México).",
          field: !fromRaw ? 'dateFrom' : 'dateTo',
        });
      }
      const start = DateTime.fromISO(fromRaw, { zone: MEXICO_TZ }).startOf('day');
      if (!start.isValid) {
        return res.status(400).json({
          error: "El parámetro 'dateFrom' tiene un formato inválido. Use YYYY-MM-DD.",
          field: 'dateFrom',
        });
      }
      const end = DateTime.fromISO(toRaw, { zone: MEXICO_TZ }).startOf('day');
      if (!end.isValid) {
        return res.status(400).json({
          error: "El parámetro 'dateTo' tiene un formato inválido. Use YYYY-MM-DD.",
          field: 'dateTo',
        });
      }
      if (start > end) {
        return res.status(400).json({
          error: "El parámetro 'dateFrom' no puede ser posterior a 'dateTo'.",
          field: 'dateFrom',
        });
      }
      dateRange = { from: fromRaw, to: toRaw };
    }

    const where = {};

    // Filtro de sucursales permitidas (el super admin no aplica restricción).
    if (!allowed.unrestricted) {
      where.branchId = { in: allowed.branchIds };
    }

    // Filtro por `branchId` específico, intersectado con las permitidas. Si el
    // usuario no puede ver esa sucursal, se devuelve lista vacía + totales en 0
    // sin exponer datos de otras sucursales.
    if (branchIdParam != null && String(branchIdParam).trim() !== '') {
      const requestedBranchId = Number.parseInt(branchIdParam, 10);
      if (!Number.isInteger(requestedBranchId)) {
        return res.status(400).json({
          error: "El parámetro 'branchId' debe ser un entero.",
          field: 'branchId',
        });
      }
      if (!allowed.unrestricted && !allowed.branchIds.includes(requestedBranchId)) {
        return res.json({ transactions: [], totals: emptyTotals() });
      }
      where.branchId = requestedBranchId;
    }

    // Filtro por `type` (ya validado arriba).
    if (type != null && String(type).trim() !== '') {
      where.type = String(type);
    }

    // Prefiltro por ventana UTC amplia sobre `registeredAt`: acota los
    // candidatos de BD antes de aplicar la comparación por día civil MX.
    if (dateRange) {
      where.registeredAt = paddedUtcWindowForBusinessRange(dateRange.from, dateRange.to);
    }

    const rows = await prisma.cashierTransaction.findMany({
      where,
      orderBy: [{ registeredAt: 'desc' }, { id: 'desc' }],
      include: TRANSACTION_INCLUDE,
    });

    // Comparación fina por día civil de negocio (MX) sobre `registeredAt`. El
    // prefiltro UTC es amplio (padding) para no perder registros cerca de los
    // límites del día; aquí se recorta al rango civil exacto.
    const transactions = dateRange
      ? rows.filter((row) =>
          registeredAtInBusinessRange(row.registeredAt, dateRange.from, dateRange.to)
        )
      : rows;

    // Totales calculados sobre el conjunto completo filtrado y autorizado:
    // `byType` (una entrada por tipo del enum), `grandTotal` (suma de `byType`)
    // y `count`, con montos redondeados a 2 decimales.
    const totals = calculateTotals(transactions);

    return res.json({ transactions, totals });
  } catch (error) {
    console.error('Error al listar transacciones de cajero:', error);
    return res.status(500).json({ error: 'Error al listar las transacciones de cajero.' });
  }
};

/**
 * POST /api/cashier-transactions
 * Crea una transacción de cajero. El flujo es:
 *   1. Validar el formato de la entrada (`validateCashierTransaction`); si algún
 *      campo es inválido, se rechaza con 400 identificando cada campo causante
 *      SIN persistir nada (Req 2.4–2.7, 3.x).
 *   2. Verificar que la `branchId` exista en `Branch`; si no, 400 con
 *      `field: 'branchId'` (Req 2.6, 3.4).
 *   3. Verificar el acceso por sucursal con `adminCanAccessBranch`; si el usuario
 *      no puede operar sobre esa sucursal, 403 sin persistir (Req 9.5, 9.6).
 *   4. Asignar `registeredAt = ahora (UTC, precisión de segundos)` si no viene;
 *      conservar el valor recibido si viene (Req 2.2, 2.3).
 *   5. Asignar `userId` con el usuario autenticado para auditoría.
 *   6. Persistir y responder 201 con el registro creado, incluyendo `branch` y
 *      `user` anidados (Req 2.1).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const createCashierTransaction = async (req, res) => {
  try {
    const userId = req.userId;
    const userRole = req.userRole;
    const { type, amount, branchId, cashierName, notes, registeredAt } = req.body ?? {};

    // Instante de recepción de la solicitud: referencia para validar que
    // `registeredAt` no sea futuro y valor por defecto si no viene.
    const now = new Date();

    // 1. Validación de formato de la entrada. Recolecta todos los errores para
    // reportar cada campo inválido en una sola respuesta, sin persistir nada.
    const { valid, errors } = validateCashierTransaction(
      { type, amount, branchId, cashierName, notes, registeredAt },
      { now }
    );
    if (!valid) {
      return res.status(400).json({
        error: 'La transacción tiene campos inválidos.',
        field: errors[0].field,
        errors,
      });
    }

    // `branchId` ya validado como entero positivo; normalizamos a número.
    const branchIdNum = Number(branchId);

    // 2. La sucursal debe existir en `Branch` (Req 2.6, 3.4).
    const branch = await prisma.branch.findUnique({ where: { id: branchIdNum } });
    if (!branch) {
      return res.status(400).json({
        error: 'La sucursal indicada no existe.',
        field: 'branchId',
        errors: [{ field: 'branchId', message: 'La sucursal indicada no existe.' }],
      });
    }

    // 3. Autorización por sucursal: el admin solo puede crear en sus sucursales
    // asignadas; el admin sin sucursales queda denegado (Req 9.5, 9.6).
    if (!(await adminCanAccessBranch(userId, userRole, branchIdNum))) {
      return res.status(403).json({
        error: 'No tienes permisos sobre la sucursal indicada.',
      });
    }

    // 4. `registeredAt`: se conserva el valor recibido; si no viene, se asigna
    // el instante actual truncado a precisión de segundos (Req 2.2, 2.3).
    const resolvedRegisteredAt =
      registeredAt != null ? new Date(registeredAt) : truncateToSeconds(now);

    // 5 y 6. Persistir con `userId` de auditoría y responder con las relaciones
    // anidadas `branch` y `user`.
    const created = await prisma.cashierTransaction.create({
      data: {
        type,
        amount: Number(amount),
        branchId: branchIdNum,
        cashierName: cashierName.trim(),
        notes: notes != null ? notes : null,
        registeredAt: resolvedRegisteredAt,
        userId: userId ?? null,
      },
      include: TRANSACTION_INCLUDE,
    });

    return res.status(201).json(created);
  } catch (error) {
    console.error('Error al crear la transacción de cajero:', error);
    return res.status(500).json({ error: 'Error al crear la transacción de cajero.' });
  }
};

/**
 * PUT /api/cashier-transactions/:id
 * Actualiza una transacción de cajero existente. El flujo es:
 *   1. Validar el FORMATO de `:id` (entero positivo); si es inválido, 400
 *      indicando que el identificador no es válido, sin modificar nada (Req 6.5).
 *   2. Cargar la transacción; si no existe, 404 "no encontrado" sin modificar
 *      nada (Req 6.2).
 *   3. Construir el objeto EFECTIVO fusionando los campos provistos en el cuerpo
 *      sobre los valores actuales del registro, y validar ese objeto con las
 *      MISMAS reglas de creación (`validateCashierTransaction`). Si algún campo
 *      resulta inválido, se rechaza la solicitud COMPLETA con 400 identificando
 *      cada campo y motivo, SIN modificar nada (Req 6.3, 6.4).
 *   4. Verificar el acceso a la sucursal ACTUAL del registro y, si `branchId`
 *      cambia, también a la NUEVA sucursal; 403 si alguna queda fuera de las
 *      sucursales permitidas, sin modificar nada (Req 9.6, 9.7). Si la sucursal
 *      nueva cambia, verificar además que exista en `Branch`.
 *   5. Persistir solo los campos provistos y responder 200 con el registro
 *      actualizado, incluyendo `branch` y `user` anidados (Req 6.1).
 *
 * Nota sobre validación parcial: `validateCashierTransaction` valida un payload
 * de creación completo (exige los campos obligatorios). Para respetar la
 * semántica de actualización parcial, se validan los VALORES EFECTIVOS (los
 * provistos fusionados sobre los actuales): así se aplican las reglas de
 * creación a los campos modificados sin exigir reenviar campos no tocados, y se
 * garantiza que el registro resultante siga siendo válido.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const updateCashierTransaction = async (req, res) => {
  try {
    const userId = req.userId;
    const userRole = req.userRole;

    // 1. Validación del formato de `:id`: debe ser un entero positivo (Req 6.5).
    const idRaw = req.params.id;
    const id = Number(idRaw);
    if (
      idRaw == null ||
      String(idRaw).trim() === '' ||
      !Number.isInteger(id) ||
      id <= 0
    ) {
      return res.status(400).json({
        error: 'El identificador de la transacción no es válido.',
        field: 'id',
      });
    }

    // 2. Cargar la transacción existente; si no existe, 404 (Req 6.2).
    const existing = await prisma.cashierTransaction.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Transacción de cajero no encontrada.' });
    }

    const body = req.body ?? {};
    const now = new Date();

    // Determinar qué campos vienen en el cuerpo (solo estos se modifican). Se usa
    // `hasOwnProperty` para distinguir "no enviado" de "enviado con valor nulo".
    const provided = (key) => Object.prototype.hasOwnProperty.call(body, key);

    // 3. Construir el objeto EFECTIVO: valores provistos sobre los actuales. Se
    // valida este objeto con las mismas reglas de creación, aplicándolas a los
    // campos modificados sin exigir reenviar los no tocados (Req 6.3).
    const effective = {
      type: provided('type') ? body.type : existing.type,
      amount: provided('amount') ? body.amount : existing.amount,
      branchId: provided('branchId') ? body.branchId : existing.branchId,
      cashierName: provided('cashierName') ? body.cashierName : existing.cashierName,
      notes: provided('notes') ? body.notes : existing.notes,
      registeredAt: provided('registeredAt') ? body.registeredAt : existing.registeredAt,
    };

    const { valid, errors } = validateCashierTransaction(effective, { now });
    if (!valid) {
      // Rechazo de la solicitud completa sin modificar nada (Req 6.4).
      return res.status(400).json({
        error: 'La transacción tiene campos inválidos.',
        field: errors[0].field,
        errors,
      });
    }

    // 4. Autorización por sucursal. Se verifica SIEMPRE el acceso a la sucursal
    // ACTUAL del registro (Req 9.7) y, si `branchId` cambia, también a la NUEVA
    // (Req 9.6). Un admin sin sucursales queda denegado en ambos casos.
    if (!(await adminCanAccessBranch(userId, userRole, existing.branchId))) {
      return res.status(403).json({
        error: 'No tienes permisos sobre la sucursal de la transacción.',
      });
    }

    const newBranchId = Number(effective.branchId);
    const branchChanged = newBranchId !== existing.branchId;
    if (branchChanged) {
      // La nueva sucursal debe existir en `Branch` (misma regla que crear).
      const branch = await prisma.branch.findUnique({ where: { id: newBranchId } });
      if (!branch) {
        return res.status(400).json({
          error: 'La sucursal indicada no existe.',
          field: 'branchId',
          errors: [{ field: 'branchId', message: 'La sucursal indicada no existe.' }],
        });
      }
      if (!(await adminCanAccessBranch(userId, userRole, newBranchId))) {
        return res.status(403).json({
          error: 'No tienes permisos sobre la sucursal indicada.',
        });
      }
    }

    // 5. Persistir solo los campos provistos, normalizando igual que en creación.
    const data = {};
    if (provided('type')) data.type = effective.type;
    if (provided('amount')) data.amount = Number(effective.amount);
    if (provided('branchId')) data.branchId = newBranchId;
    if (provided('cashierName')) data.cashierName = effective.cashierName.trim();
    if (provided('notes')) data.notes = body.notes != null ? body.notes : null;
    if (provided('registeredAt')) data.registeredAt = new Date(effective.registeredAt);

    const updated = await prisma.cashierTransaction.update({
      where: { id },
      data,
      include: TRANSACTION_INCLUDE,
    });

    return res.json(updated);
  } catch (error) {
    console.error('Error al actualizar la transacción de cajero:', error);
    return res.status(500).json({ error: 'Error al actualizar la transacción de cajero.' });
  }
};

/**
 * DELETE /api/cashier-transactions/:id
 * Elimina una transacción de cajero existente. El flujo es:
 *   1. Validar el FORMATO de `:id` (entero positivo); si es inválido o está
 *      ausente, 400 indicando que el identificador no es válido, sin eliminar
 *      nada (Req 7.3).
 *   2. Cargar la transacción; si no existe, 404 "no encontrado" sin modificar
 *      ningún otro registro (Req 7.4).
 *   3. Verificar el acceso a la sucursal de la transacción con
 *      `adminCanAccessBranch`; 403 si queda fuera de las sucursales permitidas,
 *      sin eliminar nada (Req 9.7).
 *   4. Eliminar y responder 200 con una confirmación que incluye el `id`
 *      eliminado (Req 7.1, 7.2). Si la eliminación falla, el registro se
 *      conserva sin cambios y se responde con un error (Req 7.5).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export const deleteCashierTransaction = async (req, res) => {
  try {
    const userId = req.userId;
    const userRole = req.userRole;

    // 1. Validación del formato de `:id`: debe ser un entero positivo (Req 7.3).
    const idRaw = req.params.id;
    const id = Number(idRaw);
    if (
      idRaw == null ||
      String(idRaw).trim() === '' ||
      !Number.isInteger(id) ||
      id <= 0
    ) {
      return res.status(400).json({
        error: 'El identificador de la transacción no es válido.',
        field: 'id',
      });
    }

    // 2. Cargar la transacción existente; si no existe, 404 (Req 7.4).
    const existing = await prisma.cashierTransaction.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Transacción de cajero no encontrada.' });
    }

    // 3. Autorización por sucursal: el admin solo puede eliminar transacciones
    // de sus sucursales asignadas; el admin sin sucursales queda denegado
    // (Req 9.7).
    if (!(await adminCanAccessBranch(userId, userRole, existing.branchId))) {
      return res.status(403).json({
        error: 'No tienes permisos sobre la sucursal de la transacción.',
      });
    }

    // 4. Eliminar y confirmar con el `id` eliminado (Req 7.1, 7.2). Si la
    // operación falla, el `catch` conserva el registro y devuelve un error 500
    // indicando que la eliminación no se completó (Req 7.5).
    await prisma.cashierTransaction.delete({ where: { id } });

    return res.json({
      message: 'Transacción de cajero eliminada correctamente.',
      id,
    });
  } catch (error) {
    console.error('Error al eliminar la transacción de cajero:', error);
    return res.status(500).json({ error: 'No se pudo completar la eliminación de la transacción de cajero.' });
  }
};

export { MEXICO_TZ, prisma, adminCanAccessBranch };
