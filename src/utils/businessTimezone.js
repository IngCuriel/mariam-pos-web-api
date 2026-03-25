import { DateTime } from 'luxon';

/** Zona para interpretar fechas de negocio (filtros por día civil). */
export const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'America/Mexico_City';

/**
 * Inicio del día civil YYYY-MM-DD en la zona de negocio, como Date UTC (Prisma/Postgres).
 * @param {string} yyyyMmDd
 * @returns {Date}
 */
export function startOfBusinessDayUtc(yyyyMmDd) {
  const [y, mo, d] = yyyyMmDd.split('-').map((n) => parseInt(n, 10));
  if (!y || !mo || !d) {
    throw new Error(`Fecha inválida: ${yyyyMmDd}`);
  }
  const dt = DateTime.fromObject(
    { year: y, month: mo, day: d },
    { zone: BUSINESS_TIMEZONE }
  ).startOf('day');
  if (!dt.isValid) {
    throw new Error(`Fecha inválida: ${yyyyMmDd}`);
  }
  return dt.toUTC().toJSDate();
}

/**
 * Último instante del día civil YYYY-MM-DD en la zona de negocio.
 * @param {string} yyyyMmDd
 * @returns {Date}
 */
export function endOfBusinessDayUtc(yyyyMmDd) {
  const [y, mo, d] = yyyyMmDd.split('-').map((n) => parseInt(n, 10));
  if (!y || !mo || !d) {
    throw new Error(`Fecha inválida: ${yyyyMmDd}`);
  }
  const dt = DateTime.fromObject(
    { year: y, month: mo, day: d },
    { zone: BUSINESS_TIMEZONE }
  ).endOf('day');
  if (!dt.isValid) {
    throw new Error(`Fecha inválida: ${yyyyMmDd}`);
  }
  return dt.toUTC().toJSDate();
}

/**
 * Fecha civil YYYY-MM-DD en zona de negocio a partir del instante guardado en BD.
 * @param {Date} jsDate
 * @returns {string}
 */
export function businessCalendarDateFromDbInstant(jsDate) {
  return DateTime.fromJSDate(jsDate)
    .setZone(BUSINESS_TIMEZONE)
    .toFormat('yyyy-LL-dd');
}

/**
 * Filtra filas cuyo createdAt cae en el rango de días civiles [dateFrom, dateTo] (inclusive).
 * @param {{ createdAt: Date }[]} rows
 * @param {string} dateFrom YYYY-MM-DD
 * @param {string} dateTo YYYY-MM-DD
 */
export function filterRowsByBusinessDateRange(rows, dateFrom, dateTo) {
  return rows.filter((row) => {
    const ymd = businessCalendarDateFromDbInstant(row.createdAt);
    return ymd >= dateFrom && ymd <= dateTo;
  });
}

/**
 * Ventana UTC amplia para traer candidatos de BD y luego filtrar por día civil en MX.
 * @param {string} dateFrom
 * @param {string} dateTo
 * @param {number} padHours
 * @returns {{ gte: Date, lte: Date }}
 */
export function paddedUtcWindowForBusinessRange(dateFrom, dateTo, padHours = 48) {
  const start = startOfBusinessDayUtc(dateFrom);
  const end = endOfBusinessDayUtc(dateTo);
  const padMs = padHours * 60 * 60 * 1000;
  return {
    gte: new Date(start.getTime() - padMs),
    lte: new Date(end.getTime() + padMs),
  };
}
