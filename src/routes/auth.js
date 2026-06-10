import express from 'express';
import {
  register,
  login,
  verifyToken,
  getProfile,
  updateProfile,
  forgotPassword,
  validateResetToken,
  resetPassword,
} from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { createAdmin } from '../controllers/setupController.js';

const router = express.Router();

// Rutas públicas
router.post('/register', register);
router.post('/login', login);
router.get('/verify', verifyToken);
router.post('/forgot-password', forgotPassword);
router.get('/reset-password/validate', validateResetToken);
router.post('/reset-password', resetPassword);

// Ruta temporal para crear admin (solo desarrollo - remover en producción)
router.post('/setup-admin', createAdmin);

// Rutas protegidas
router.get('/profile', authenticate, getProfile);
router.patch('/profile', authenticate, updateProfile);

export default router;

