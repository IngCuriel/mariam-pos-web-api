import express from 'express';
import {
  getCashierTransactions,
  createCashierTransaction,
  updateCashierTransaction,
  deleteCashierTransaction,
} from '../controllers/cashierTransactionsController.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Todas las rutas del módulo requieren autenticación y rol de administrador.
// `authenticate` se ejecuta primero; solo si resuelve con éxito continúa
// `requireAdmin`, antes de invocar cualquier controlador (Req 8.1–8.4).
router.use(authenticate);
router.use(requireAdmin);

// Listado con filtros opcionales (dateFrom, dateTo, type, branchId) + totales.
router.get('/', getCashierTransactions);

// Creación de una transacción de cajero.
router.post('/', createCashierTransaction);

// Actualización de una transacción existente.
router.put('/:id', updateCashierTransaction);

// Eliminación de una transacción existente.
router.delete('/:id', deleteCashierTransaction);

export default router;
