import express from 'express';
import {
  createRequest,
  getRequests,
  getRequestById,
  updateRequestStatus,
  uploadDepositReceipt,
  confirmDepositReceipt,
  uploadSignedReceipt,
  getConfig,
  updateConfig,
  getSuggestedAvailability,
  addBalance,
  getBalanceHistory,
  getCurrentBalance,
} from '../controllers/cashExpressController.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Rutas públicas (no requieren autenticación)
router.get('/availability/suggested', getSuggestedAvailability);
router.get('/balance/current', getCurrentBalance);

// Todas las demás rutas requieren autenticación
router.use(authenticate);

// Rutas para clientes y admin
router.post('/', createRequest);
router.get('/', getRequests);
router.get('/:id', getRequestById);

// Rutas para clientes (subir y confirmar comprobante)
router.patch('/:id/receipt', uploadDepositReceipt);
router.post('/:id/receipt/confirm', confirmDepositReceipt);

// Rutas de configuración
router.get('/config/get', getConfig);
router.put('/config/update', requireAdmin, updateConfig);

// Rutas de saldo (solo admin)
router.post('/balance/add', requireAdmin, addBalance);
router.get('/balance/history', requireAdmin, getBalanceHistory);

// Rutas solo para admin
router.patch('/:id/status', requireAdmin, updateRequestStatus);
router.patch('/:id/signed-receipt', requireAdmin, uploadSignedReceipt);

export default router;

