import express from 'express';
import {
  register,
  login,
  verifyToken,
  getProfile
} from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Rutas públicas
router.post('/register', register);
router.post('/login', login);
router.get('/verify', verifyToken);

// Rutas protegidas
router.get('/profile', authenticate, getProfile);

export default router;

