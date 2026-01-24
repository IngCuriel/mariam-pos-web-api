import express from 'express';
import {
  createRequest,
  getRequests,
  getRequestById,
  updateRequestStatus,
  uploadDepositReceipt,
  confirmDepositReceipt
} from '../controllers/cashExpressController.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Todas las rutas requieren autenticación
router.use(authenticate);

// Rutas para clientes y admin
router.post('/', createRequest);
router.get('/', getRequests);
router.get('/:id', getRequestById);

// Rutas para clientes (subir y confirmar comprobante)
router.patch('/:id/receipt', uploadDepositReceipt);
router.post('/:id/receipt/confirm', confirmDepositReceipt);

// Rutas solo para admin
router.patch('/:id/status', requireAdmin, updateRequestStatus);

export default router;

