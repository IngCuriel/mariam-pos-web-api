import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const VALID_ROLES = ['CLIENTE', 'ADMIN', 'SUPER_ADMIN'];

// Campos seguros del usuario (nunca exponer el password)
const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
};

// GET /api/users  (solo super admin) — lista todos los usuarios
export const getUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: USER_SELECT,
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    res.json(users);
  } catch (error) {
    console.error('Error obteniendo usuarios:', error);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
};

// PATCH /api/users/:id/role  (solo super admin) — cambia el rol de un usuario
export const updateUserRole = async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const { role } = req.body;

    if (Number.isNaN(targetId)) {
      return res.status(400).json({ error: 'ID de usuario inválido' });
    }

    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetId },
      select: USER_SELECT,
    });

    if (!targetUser) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Un super admin no puede quitarse a sí mismo el rol (evita perder acceso)
    if (targetUser.id === req.userId && role !== 'SUPER_ADMIN') {
      return res.status(400).json({
        error: 'No puedes cambiar tu propio rol de Super Admin',
      });
    }

    const updated = await prisma.user.update({
      where: { id: targetId },
      data: { role },
      select: USER_SELECT,
    });

    res.json(updated);
  } catch (error) {
    console.error('Error actualizando rol:', error);
    res.status(500).json({ error: 'Error al actualizar el rol' });
  }
};
