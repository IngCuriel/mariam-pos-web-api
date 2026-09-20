import express from 'express';
import { getUsers, updateUserRole, updateUserBranches, generateResetLink } from '../controllers/usersController.js';
import { authenticate, requireSuperAdmin } from '../middleware/auth.js';

const router = express.Router();

// Gestión de usuarios y roles: SOLO super admin.
router.get('/', authenticate, requireSuperAdmin, getUsers);
router.patch('/:id/role', authenticate, requireSuperAdmin, updateUserRole);
router.patch('/:id/branches', authenticate, requireSuperAdmin, updateUserBranches);
router.post('/:id/reset-link', authenticate, requireSuperAdmin, generateResetLink);

export default router;
