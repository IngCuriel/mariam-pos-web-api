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
 * Tipos de entrega para la tienda (carrito): solo links activos, con costo y orden por sucursal.
 * Si la sucursal no tiene ninguno configurado, devuelve todos los DeliveryType activos.
 */
export async function getBranchDeliveryTypes(branchId) {
  if (!branchId) return [];
  const branch = await prisma.branch.findUnique({
    where: { id: Number(branchId) },
    include: {
      deliveryTypeLinks: {
        where: { isActive: true },
        include: { deliveryType: true }
      }
    }
  });
  if (!branch) return [];
  const links = branch.deliveryTypeLinks
    .filter((link) => link.deliveryType?.isActive)
    .sort((a, b) => {
      const orderA = a.displayOrder ?? 0;
      const orderB = b.displayOrder ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      return (a.deliveryType?.displayOrder ?? 0) - (b.deliveryType?.displayOrder ?? 0);
    });
  if (links.length > 0) {
    return links.map((link) => ({
      ...link.deliveryType,
      cost: link.costOverride != null ? Number(link.costOverride) : (link.deliveryType?.cost ?? 0)
    }));
  }
  return await prisma.deliveryType.findMany({
    where: { isActive: true },
    orderBy: { displayOrder: 'asc' }
  });
}

/**
 * Para admin: links de la sucursal con deliveryType y todos los tipos para poder agregar.
 * @returns {{ links: Array<{ deliveryTypeId, deliveryType, isActive, costOverride, displayOrder }>, allDeliveryTypes: Array }}
 */
export async function getBranchDeliveryTypesForAdmin(branchId) {
  if (!branchId) return { links: [], allDeliveryTypes: [] };
  const [branch, allDeliveryTypes] = await Promise.all([
    prisma.branch.findUnique({
      where: { id: Number(branchId) },
      include: {
        deliveryTypeLinks: {
          include: { deliveryType: true },
          orderBy: { displayOrder: 'asc' }
        }
      }
    }),
    prisma.deliveryType.findMany({ orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }] })
  ]);
  const links = branch?.deliveryTypeLinks ?? [];
  return { links, allDeliveryTypes: allDeliveryTypes ?? [] };
}

/**
 * Actualiza los tipos de entrega de una sucursal (admin).
 * @param {number} branchId - ID de la sucursal
 * @param {Array<{ deliveryTypeId: number, isActive?: boolean, costOverride?: number|null, displayOrder?: number }>} links
 * @returns {Promise<{ links, allDeliveryTypes }>}
 */
export async function setBranchDeliveryTypes(branchId, links) {
  const id = Number(branchId);
  const list = Array.isArray(links) ? links : [];
  await prisma.branchDeliveryType.deleteMany({ where: { branchId: id } });
  if (list.length > 0) {
    const data = list.map((item) => {
      const deliveryTypeId = Number(item.deliveryTypeId);
      if (Number.isNaN(deliveryTypeId)) return null;
      return {
        branchId: id,
        deliveryTypeId,
        isActive: item.isActive !== false,
        costOverride: item.costOverride != null ? Number(item.costOverride) : null,
        displayOrder: typeof item.displayOrder === 'number' ? item.displayOrder : 0
      };
    }).filter(Boolean);
    if (data.length > 0) {
      await prisma.branchDeliveryType.createMany({ data });
    }
  }
  return getBranchDeliveryTypesForAdmin(id);
}

