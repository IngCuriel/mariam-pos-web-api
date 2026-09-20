import express from 'express';
import { getUsers, updateUserRole } from '../controllers/usersController.js';
import { authenticate, requireSuperAdmin } from '../middleware/auth.js';

const router = express.Router();

// Gestión de usuarios y roles: SOLO super admin.
router.get('/', authenticate, requireSuperAdmin, getUsers);
router.patch('/:id/role', authenticate, requireSuperAdmin, updateUserRole);

export default router;
