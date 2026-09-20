import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const VALID_ROLES = ['CLIENTE', 'ADMIN', 'SUPER_ADMIN'];

// Campos seguros del usuario (nunca exponer el password) + sucursales asignadas
const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
  branches: {
    select: {
      branch: { select: { id: true, name: true } },
    },
  },
};

// Aplana la relación UserBranch a un array simple de sucursales
const shapeUser = (u) => ({
  ...u,
  branches: (u.branches || []).map((b) => b.branch),
});

// GET /api/users  (solo super admin) — lista paginada de usuarios.
// Query params:
//   page      (número de página, empieza en 1; por defecto 1)
//   pageSize  (registros por página; por defecto 10, máximo 100)
//   search    (busca por nombre o correo, opcional)
//   role      (filtra por rol exacto, opcional)
// Respuesta: { data: [...], pagination: { page, pageSize, total, totalPages } }
// Orden: los últimos en registrarse primero (createdAt desc).
export const getUsers = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const rawPageSize = parseInt(req.query.pageSize, 10) || 10;
    const pageSize = Math.min(100, Math.max(1, rawPageSize));

    const search = (req.query.search || '').trim();
    const role = (req.query.role || '').trim();

    // Filtros dinámicos
    const where = {};
    if (VALID_ROLES.includes(role)) {
      where.role = role;
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, users] = await prisma.$transaction([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    res.json({
      data: users.map(shapeUser),
      pagination: { page, pageSize, total, totalPages },
    });
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

    res.json(shapeUser(updated));
  } catch (error) {
    console.error('Error actualizando rol:', error);
    res.status(500).json({ error: 'Error al actualizar el rol' });
  }
};

// PATCH /api/users/:id/branches  (solo super admin) — asigna sucursales al usuario.
// Recibe { branchIds: number[] } y sincroniza la asignación completa.
export const updateUserBranches = async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const { branchIds } = req.body;

    if (Number.isNaN(targetId)) {
      return res.status(400).json({ error: 'ID de usuario inválido' });
    }

    if (!Array.isArray(branchIds)) {
      return res.status(400).json({ error: 'branchIds debe ser un arreglo' });
    }

    const ids = [...new Set(branchIds.map((n) => parseInt(n, 10)).filter((n) => !Number.isNaN(n)))];

    const targetUser = await prisma.user.findUnique({ where: { id: targetId } });
    if (!targetUser) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Solo admin/super admin pueden tener sucursales asignadas
    if (targetUser.role !== 'ADMIN' && targetUser.role !== 'SUPER_ADMIN') {
      return res.status(400).json({
        error: 'Solo los usuarios Admin o Super Admin pueden tener sucursales asignadas',
      });
    }

    // Validar que todas las sucursales existan
    if (ids.length > 0) {
      const existing = await prisma.branch.count({ where: { id: { in: ids } } });
      if (existing !== ids.length) {
        return res.status(400).json({ error: 'Una o más sucursales no existen' });
      }
    }

    // Sincronizar: borrar todas las actuales y crear las nuevas, en una transacción
    await prisma.$transaction([
      prisma.userBranch.deleteMany({ where: { userId: targetId } }),
      ...(ids.length > 0
        ? [prisma.userBranch.createMany({ data: ids.map((branchId) => ({ userId: targetId, branchId })) })]
        : []),
    ]);

    const updated = await prisma.user.findUnique({
      where: { id: targetId },
      select: USER_SELECT,
    });

    res.json(shapeUser(updated));
  } catch (error) {
    console.error('Error actualizando sucursales:', error);
    res.status(500).json({ error: 'Error al actualizar las sucursales' });
  }
};
