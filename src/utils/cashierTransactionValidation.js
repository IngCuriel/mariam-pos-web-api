/**
 * Validaciones de entrada para transacciones de cajero (CashierTransaction).
 *
 * Este módulo contiene lógica de validación pura: no accede a la base de datos
 * ni verifica la existencia de la sucursal (eso se hace en el controlador). Aquí
 * solo se valida el FORMATO de `branchId` (entero positivo).
 *
 * Forma del error de validación:
 *   Cada helper individual devuelve `null` cuando el valor es válido, o un objeto
 *   `{ field, message }` cuando es inválido, donde:
 *     - `field`: string con el nombre del campo causante (p. ej. 'amount').
 *     - `message`: string legible que describe el motivo del rechazo.
 *
 *   El agregador `validateCashierTransaction` devuelve siempre
 *   `{ valid: boolean, errors: Array<{ field, message }> }`, permitiendo al
 *   controlador reportar todos los campos inválidos de una sola vez.
 *
 * Se eligió devolver estructuras `{ field, message }` (en lugar de lanzar
 * excepciones como el resto de utils) porque los errores de validación de
 * entrada son un resultado esperado del flujo y DEBEN identificar el campo
 * causante para construir la respuesta HTTP de error de validación.
 */

/** Valores permitidos de tipo de transacción (debe coincidir con CashierTransactionType de Prisma). */
export const CASHIER_TRANSACTION_TYPES = ['RECARGA', 'PAGO_SERVICIO', 'PIN_ELECTRONICO'];

/** Límites de monto (inclusivos) según el modelo de datos. */
export const AMOUNT_MIN = 0.01;
export const AMOUNT_MAX = 999999999.99;

/** Longitudes máximas de texto. */
export const CASHIER_NAME_MAX_LENGTH = 100;
export const NOTES_MAX_LENGTH = 500;

/**
 * Valida `type`: obligatorio y debe pertenecer a CASHIER_TRANSACTION_TYPES.
 * @param {*} type
 * @returns {{ field: string, message: string } | null}
 */
export function validateType(type) {
  if (type === undefined || type === null || type === '') {
    return { field: 'type', message: 'El tipo de transacción es obligatorio.' };
  }
  if (!CASHIER_TRANSACTION_TYPES.includes(type)) {
    return {
      field: 'type',
      message: `El tipo de transacción debe ser uno de: ${CASHIER_TRANSACTION_TYPES.join(', ')}.`,
    };
  }
  return null;
}

/**
 * Valida `amount`: numérico, en el rango [0.01, 999999999.99] inclusive y con
 * un máximo de 2 decimales.
 * @param {*} amount
 * @returns {{ field: string, message: string } | null}
 */
export function validateAmount(amount) {
  if (amount === undefined || amount === null || amount === '') {
    return { field: 'amount', message: 'El monto es obligatorio.' };
  }

  const numeric = typeof amount === 'number' ? amount : Number(amount);
  if (typeof amount === 'boolean' || Number.isNaN(numeric) || !Number.isFinite(numeric)) {
    return { field: 'amount', message: 'El monto debe ser un valor numérico.' };
  }

  if (numeric < AMOUNT_MIN || numeric > AMOUNT_MAX) {
    return {
      field: 'amount',
      message: `El monto debe estar entre ${AMOUNT_MIN} y ${AMOUNT_MAX} inclusive.`,
    };
  }

  if (!hasAtMostTwoDecimals(numeric)) {
    return { field: 'amount', message: 'El monto no puede tener más de 2 decimales.' };
  }

  return null;
}

/**
 * Determina si un número tiene como máximo 2 decimales, evitando falsos
 * positivos por errores de coma flotante (p. ej. 0.1 + 0.2).
 * @param {number} value
 * @returns {boolean}
 */
function hasAtMostTwoDecimals(value) {
  // Se compara el valor redondeado a 2 decimales contra el original con una
  // tolerancia pequeña para absorber el ruido de punto flotante.
  const rounded = Math.round(value * 100) / 100;
  return Math.abs(value - rounded) < 1e-9;
}

/**
 * Valida el FORMATO de `branchId`: entero positivo. NO verifica existencia en BD
 * (eso corresponde al controlador).
 * @param {*} branchId
 * @returns {{ field: string, message: string } | null}
 */
export function validateBranchId(branchId) {
  if (branchId === undefined || branchId === null || branchId === '') {
    return { field: 'branchId', message: 'La sucursal es obligatoria.' };
  }

  const numeric = typeof branchId === 'number' ? branchId : Number(branchId);
  if (
    typeof branchId === 'boolean' ||
    Number.isNaN(numeric) ||
    !Number.isInteger(numeric) ||
    numeric <= 0
  ) {
    return { field: 'branchId', message: 'La sucursal debe ser un identificador entero positivo.' };
  }

  return null;
}

/**
 * Valida `cashierName`: string no vacío tras `trim`, máximo 100 caracteres.
 * @param {*} cashierName
 * @returns {{ field: string, message: string } | null}
 */
export function validateCashierName(cashierName) {
  if (typeof cashierName !== 'string' || cashierName.trim().length === 0) {
    return { field: 'cashierName', message: 'El nombre del cajero es obligatorio.' };
  }

  if (cashierName.trim().length > CASHIER_NAME_MAX_LENGTH) {
    return {
      field: 'cashierName',
      message: `El nombre del cajero no puede exceder ${CASHIER_NAME_MAX_LENGTH} caracteres.`,
    };
  }

  return null;
}

/**
 * Valida `notes`: opcional. Si se proporciona, debe ser string de hasta 500
 * caracteres. Los valores `undefined` y `null` se consideran ausentes (válidos).
 * @param {*} notes
 * @returns {{ field: string, message: string } | null}
 */
export function validateNotes(notes) {
  if (notes === undefined || notes === null) {
    return null;
  }

  if (typeof notes !== 'string') {
    return { field: 'notes', message: 'Las notas deben ser una cadena de texto.' };
  }

  if (notes.length > NOTES_MAX_LENGTH) {
    return { field: 'notes', message: `Las notas no pueden exceder ${NOTES_MAX_LENGTH} caracteres.` };
  }

  return null;
}

/**
 * Valida `registeredAt`: opcional. Si se proporciona, debe tener un formato de
 * fecha válido y no ser posterior a `now` (el instante de recepción de la
 * solicitud). Los valores `undefined` y `null` se consideran ausentes (válidos).
 * @param {*} registeredAt Valor recibido (string ISO, Date, o timestamp).
 * @param {Date} [now] Instante de referencia; por defecto la hora actual.
 * @returns {{ field: string, message: string } | null}
 */
export function validateRegisteredAt(registeredAt, now = new Date()) {
  if (registeredAt === undefined || registeredAt === null) {
    return null;
  }

  // Rechazar tipos que no representan una fecha (p. ej. boolean, objetos planos).
  if (
    typeof registeredAt !== 'string' &&
    typeof registeredAt !== 'number' &&
    !(registeredAt instanceof Date)
  ) {
    return { field: 'registeredAt', message: 'La fecha de registro tiene un formato inválido.' };
  }

  // Un string vacío o solo espacios no es una fecha válida.
  if (typeof registeredAt === 'string' && registeredAt.trim().length === 0) {
    return { field: 'registeredAt', message: 'La fecha de registro tiene un formato inválido.' };
  }

  const parsed = registeredAt instanceof Date ? registeredAt : new Date(registeredAt);
  if (Number.isNaN(parsed.getTime())) {
    return { field: 'registeredAt', message: 'La fecha de registro tiene un formato inválido.' };
  }

  if (parsed.getTime() > now.getTime()) {
    return {
      field: 'registeredAt',
      message: 'La fecha de registro no puede ser posterior al instante de recepción.',
    };
  }

  return null;
}

/**
 * Valida el conjunto completo de campos de una transacción de cajero.
 *
 * Recolecta todos los errores en un solo arreglo para que el controlador pueda
 * reportar cada campo inválido en una única respuesta.
 *
 * @param {object} data
 * @param {*} data.type
 * @param {*} data.amount
 * @param {*} data.branchId
 * @param {*} data.cashierName
 * @param {*} [data.notes]
 * @param {*} [data.registeredAt]
 * @param {object} [options]
 * @param {Date} [options.now] Instante de referencia para `registeredAt`.
 * @returns {{ valid: boolean, errors: Array<{ field: string, message: string }> }}
 */
export function validateCashierTransaction(data = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const errors = [];

  const checks = [
    validateType(data.type),
    validateAmount(data.amount),
    validateBranchId(data.branchId),
    validateCashierName(data.cashierName),
    validateNotes(data.notes),
    validateRegisteredAt(data.registeredAt, now),
  ];

  for (const error of checks) {
    if (error) {
      errors.push(error);
    }
  }

  return { valid: errors.length === 0, errors };
}
