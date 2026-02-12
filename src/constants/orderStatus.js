/**
 * Estados del pedido - flujo recoger en tienda.
 * No usar strings hardcodeados en controladores/servicios.
 */
export const OrderStatus = {
  CREATED: 'CREATED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  PARTIALLY_AVAILABLE: 'PARTIALLY_AVAILABLE',
  AVAILABLE: 'AVAILABLE',
  IN_PREPARATION: 'IN_PREPARATION',
  READY_FOR_PICKUP: 'READY_FOR_PICKUP',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

/** Transiciones permitidas: desde estado -> [estados válidos] */
export const ORDER_STATUS_TRANSITIONS = {
  [OrderStatus.CREATED]: [OrderStatus.UNDER_REVIEW, OrderStatus.CANCELLED],
  [OrderStatus.UNDER_REVIEW]: [OrderStatus.PARTIALLY_AVAILABLE, OrderStatus.AVAILABLE, OrderStatus.CANCELLED],
  [OrderStatus.PARTIALLY_AVAILABLE]: [OrderStatus.IN_PREPARATION, OrderStatus.CANCELLED],
  [OrderStatus.AVAILABLE]: [OrderStatus.IN_PREPARATION, OrderStatus.CANCELLED],
  [OrderStatus.IN_PREPARATION]: [OrderStatus.READY_FOR_PICKUP, OrderStatus.CANCELLED],
  [OrderStatus.READY_FOR_PICKUP]: [OrderStatus.COMPLETED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
};

export function canTransition(fromStatus, toStatus) {
  const allowed = ORDER_STATUS_TRANSITIONS[fromStatus];
  return Array.isArray(allowed) && allowed.includes(toStatus);
}
