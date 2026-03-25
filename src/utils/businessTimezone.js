import { DateTime } from 'luxon';

/** Zona para interpretar fechas de negocio (filtros por día civil). */
export const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'America/Mexico_City';

/**
 * Inicio del día civil YYYY-MM-DD en la zona de negocio, como Date UTC (Prisma/Postgres).
 * @param {string} yyyyMmDd
 * @returns {Date}
 */
export function startOfBusinessDayUtc(yyyyMmDd) {
  const dt = DateTime.fromISO(`${yyyyMmDd}T00:00:00.000`, { zone: BUSINESS_TIMEZONE });
  if (!dt.isValid) {
    throw new Error(`Fecha inválida: ${yyyyMmDd}`);
  }
  return dt.startOf('day').toUTC().toJSDate();
}

/**
 * Último instante del día civil YYYY-MM-DD en la zona de negocio.
 * @param {string} yyyyMmDd
 * @returns {Date}
 */
export function endOfBusinessDayUtc(yyyyMmDd) {
  const dt = DateTime.fromISO(`${yyyyMmDd}T00:00:00.000`, { zone: BUSINESS_TIMEZONE });
  if (!dt.isValid) {
    throw new Error(`Fecha inválida: ${yyyyMmDd}`);
  }
  return dt.endOf('day').toUTC().toJSDate();
}
