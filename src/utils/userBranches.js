import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Select de Prisma para traer las sucursales asignadas a un usuario, ya listas
// para aplanar con flattenUserBranches.
export const USER_BRANCHES_SELECT = {
  branches: {
    select: {
      branch: { select: { id: true, name: true } },
    },
  },
};

// Convierte la relación UserBranch[] en un array simple [{ id, name }].
export const flattenUserBranches = (user) =>
  (user?.branches || []).map((b) => b.branch).filter(Boolean);

/**
 * Resuelve las sucursales que un usuario tiene permitido ver.
 *
 * Reglas de negocio:
 *  - SUPER_ADMIN: acceso a TODAS las sucursales (se devuelve null como
 *    "sin restricción", para que el llamador no aplique filtro).
 *  - ADMIN: solo las sucursales asignadas (puede quedar vacío → no ve nada).
 *  - Otros roles: sin acceso (array vacío).
 *
 * @param {number} userId
 * @param {string} role
 * @returns {Promise<{ unrestricted: boolean, branchIds: number[], branchNames: string[] }>}
 *   unrestricted=true significa "ve todas" (super admin).
 */
export const resolveAllowedBranches = async (userId, role) => {
  if (role === 'SUPER_ADMIN') {
    return { unrestricted: true, branchIds: [], branchNames: [] };
  }

  if (role !== 'ADMIN') {
    return { unrestricted: false, branchIds: [], branchNames: [] };
  }

  const links = await prisma.userBranch.findMany({
    where: { userId },
    select: { branch: { select: { id: true, name: true } } },
  });

  const branches = links.map((l) => l.branch).filter(Boolean);
  return {
    unrestricted: false,
    branchIds: branches.map((b) => b.id),
    branchNames: branches.map((b) => b.name),
  };
};
