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

  // Si no existe, crearla y asignar por defecto todos los tipos de entrega activos
  if (!branch) {
    branch = await prisma.branch.create({
      data: {
        name: branchName,
        description: `Sucursal ${branchName}`,
        isActive: true
      }
    });
    const activeDeliveryTypes = await prisma.deliveryType.findMany({
      where: { isActive: true },
      select: { id: true }
    });
    if (activeDeliveryTypes.length > 0) {
      await prisma.branchDeliveryType.createMany({
        data: activeDeliveryTypes.map((dt) => ({ branchId: branch.id, deliveryTypeId: dt.id }))
      });
    }
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
 * Obtiene todas las sucursales (activas e inactivas) para configuración admin
 * @returns {Promise<Array>} - Lista de sucursales
 */
export async function getAllBranchesForAdmin() {
  return await prisma.branch.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      description: true,
      logo: true,
      isActive: true,
      createdAt: true,
      updatedAt: true
    }
  });
}

/**
 * Actualiza una sucursal (ej. isActive)
 * @param {number} id - ID de la sucursal
 * @param {Object} data - Datos a actualizar (ej. { isActive: false })
 * @returns {Promise<Object>} - Sucursal actualizada
 */
export async function updateBranch(id, data) {
  return await prisma.branch.update({
    where: { id: Number(id) },
    data
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

/**
 * Tipos de entrega vinculados a una sucursal (para config admin y para carrito por sucursal).
 * Si la sucursal no tiene ninguno configurado, devuelve todos los activos (comportamiento por defecto).
 * @param {number} branchId - ID de la sucursal
 * @returns {Promise<Array<{id: number, code: string, name: string, cost: number, isActive: boolean, displayOrder: number}>>}
 */
export async function getBranchDeliveryTypes(branchId) {
  if (!branchId) return [];
  const branch = await prisma.branch.findUnique({
    where: { id: Number(branchId) },
    include: {
      deliveryTypeLinks: {
        include: { deliveryType: true },
        orderBy: { deliveryType: { displayOrder: 'asc' } }
      }
    }
  });
  if (!branch) return [];
  const types = branch.deliveryTypeLinks
    .filter((link) => link.deliveryType?.isActive)
    .map((link) => link.deliveryType);
  if (types.length > 0) return types;
  return await prisma.deliveryType.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: 'asc' }
  });
}

/**
 * Actualiza los tipos de entrega de una sucursal.
 * @param {number} branchId - ID de la sucursal
 * @param {number[]} deliveryTypeIds - IDs de los tipos de entrega a vincular
 * @returns {Promise<Array>} - Tipos de entrega ahora vinculados
 */
export async function setBranchDeliveryTypes(branchId, deliveryTypeIds) {
  const id = Number(branchId);
  const ids = Array.isArray(deliveryTypeIds)
    ? deliveryTypeIds.map((x) => Number(x)).filter((x) => !Number.isNaN(x))
    : [];
  await prisma.branchDeliveryType.deleteMany({ where: { branchId: id } });
  if (ids.length > 0) {
    await prisma.branchDeliveryType.createMany({
      data: ids.map((deliveryTypeId) => ({ branchId: id, deliveryTypeId }))
    });
  }
  return getBranchDeliveryTypes(id);
}

