import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

/**
 * Obtiene o crea una sucursal automáticamente
 * @param {string} branchName - Nombre de la sucursal
 * @returns {Promise<{id: number, name: string}>} - Objeto con id y name de la sucursal
 */
export async function getOrCreateBranch(branchName) {
  if (!branchName || branchName.trim() === '') {
    branchName = 'Sucursal Default';
  }

  // Buscar sucursal existente
  let branch = await prisma.branch.findUnique({
    where: { name: branchName }
  });

  // Si no existe, crearla
  if (!branch) {
    branch = await prisma.branch.create({
      data: {
        name: branchName,
        description: `Sucursal ${branchName}`,
        isActive: true
      }
    });
    console.log(`✅ Sucursal creada: ${branchName} (ID: ${branch.id})`);
  }

  return branch;
}

/**
 * Obtiene todas las sucursales activas
 * @returns {Promise<Array>} - Lista de sucursales
 */
export async function getAllBranches() {
  return await prisma.branch.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      isActive: true,
      createdAt: true
    }
  });
}

/**
 * Obtiene una sucursal por ID
 * @param {number} branchId - ID de la sucursal
 * @returns {Promise<Object|null>} - Sucursal o null
 */
export async function getBranchById(branchId) {
  if (!branchId) return null;
  return await prisma.branch.findUnique({
    where: { id: branchId }
  });
}

/**
 * Obtiene una sucursal por nombre
 * @param {string} branchName - Nombre de la sucursal
 * @returns {Promise<Object|null>} - Sucursal o null
 */
export async function getBranchByName(branchName) {
  if (!branchName) return null;
  return await prisma.branch.findUnique({
    where: { name: branchName }
  });
}

