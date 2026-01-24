import express from 'express';
import {
  createOrder,
  getOrders,
  getOrderById,
  updateOrderStatus,
  updateOrderItemsAvailability
} from '../controllers/ordersController.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Todas las rutas requieren autenticación
router.use(authenticate);

// Rutas para clientes y admin
router.post('/', createOrder);
router.get('/', getOrders);
router.get('/:id', getOrderById);

// Rutas solo para admin
router.patch('/:id/status', requireAdmin, updateOrderStatus);
router.patch('/:id/items-availability', requireAdmin, updateOrderItemsAvailability);

export default router;

