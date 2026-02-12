import express from 'express';
import {
  createOrder,
  getOrders,
  getOrderById,
  getOrderCounts,
  updateOrderStatus,
  updateOrderItemsAvailability,
  confirmOrderAvailability,
  confirmOrderByCustomer,
  markOrderReady,
  cancelOrder,
} from '../controllers/ordersController.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

router.use(authenticate);

// Cliente y admin
router.post('/', createOrder);
router.get('/', getOrders);
router.get('/counts', requireAdmin, getOrderCounts);
router.get('/:id', getOrderById);

// Admin: revisión y disponibilidad
router.patch('/:id/status', requireAdmin, updateOrderStatus);
router.patch('/:id/items-availability', requireAdmin, updateOrderItemsAvailability);
router.post('/:id/review-availability', requireAdmin, confirmOrderAvailability);
router.post('/:id/mark-ready', requireAdmin, markOrderReady);

// Cliente: aceptar pedido actualizado o cancelar
router.post('/:id/confirm-by-customer', confirmOrderByCustomer);
router.post('/:id/cancel', cancelOrder);

export default router;

