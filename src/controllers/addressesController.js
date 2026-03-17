import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Listar direcciones del usuario autenticado */
export const getMyAddresses = async (req, res) => {
  try {
    const userId = req.userId;
    const addresses = await prisma.userAddress.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    res.json(addresses);
  } catch (error) {
    console.error('Error listando direcciones:', error);
    res.status(500).json({ error: 'Error al obtener direcciones' });
  }
};

/** Crear dirección */
export const createAddress = async (req, res) => {
  try {
    const userId = req.userId;
    const { label, street, colony, postalCode, city, state, references, isDefault, latitude, longitude } = req.body || {};

    if (!label?.trim() || !street?.trim() || !colony?.trim() || !postalCode?.trim() || !city?.trim()) {
      return res.status(400).json({
        error: 'Faltan campos requeridos: label, street, colony, postalCode, city',
      });
    }

    if (isDefault) {
      await prisma.userAddress.updateMany({
        where: { userId },
        data: { isDefault: false },
      });
    }

    const lat = latitude != null && !Number.isNaN(Number(latitude)) ? Number(latitude) : null;
    const lng = longitude != null && !Number.isNaN(Number(longitude)) ? Number(longitude) : null;
    const address = await prisma.userAddress.create({
      data: {
        userId,
        label: label.trim(),
        street: street.trim(),
        colony: colony.trim(),
        postalCode: String(postalCode).trim(),
        city: city.trim(),
        state: state?.trim() || null,
        references: references?.trim() || null,
        latitude: lat,
        longitude: lng,
        isDefault: Boolean(isDefault),
      },
    });
    res.status(201).json(address);
  } catch (error) {
    console.error('Error creando dirección:', error);
    res.status(500).json({ error: 'Error al crear dirección' });
  }
};

/** Actualizar dirección */
export const updateAddress = async (req, res) => {
  try {
    const userId = req.userId;
    const id = Number(req.params.id);
    const { label, street, colony, postalCode, city, state, references, isDefault, latitude, longitude } = req.body || {};

    const existing = await prisma.userAddress.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Dirección no encontrada' });
    }

    if (isDefault) {
      await prisma.userAddress.updateMany({
        where: { userId },
        data: { isDefault: false },
      });
    }

    const lat = latitude !== undefined ? (latitude != null && !Number.isNaN(Number(latitude)) ? Number(latitude) : null) : existing.latitude;
    const lng = longitude !== undefined ? (longitude != null && !Number.isNaN(Number(longitude)) ? Number(longitude) : null) : existing.longitude;
    const address = await prisma.userAddress.update({
      where: { id },
      data: {
        ...(label !== undefined && { label: label?.trim() ?? existing.label }),
        ...(street !== undefined && { street: street?.trim() ?? existing.street }),
        ...(colony !== undefined && { colony: colony?.trim() ?? existing.colony }),
        ...(postalCode !== undefined && { postalCode: String(postalCode).trim() ?? existing.postalCode }),
        ...(city !== undefined && { city: city?.trim() ?? existing.city }),
        ...(state !== undefined && { state: state?.trim() || null }),
        ...(references !== undefined && { references: references?.trim() || null }),
        ...(latitude !== undefined && { latitude: lat }),
        ...(longitude !== undefined && { longitude: lng }),
        ...(isDefault !== undefined && { isDefault: Boolean(isDefault) }),
      },
    });
    res.json(address);
  } catch (error) {
    console.error('Error actualizando dirección:', error);
    res.status(500).json({ error: 'Error al actualizar dirección' });
  }
};

/** Eliminar dirección */
export const deleteAddress = async (req, res) => {
  try {
    const userId = req.userId;
    const id = Number(req.params.id);

    const existing = await prisma.userAddress.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Dirección no encontrada' });
    }

    await prisma.userAddress.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error('Error eliminando dirección:', error);
    res.status(500).json({ error: 'Error al eliminar dirección' });
  }
};

/** Marcar dirección como predeterminada */
export const setDefaultAddress = async (req, res) => {
  try {
    const userId = req.userId;
    const id = Number(req.params.id);

    const existing = await prisma.userAddress.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      return res.status(404).json({ error: 'Dirección no encontrada' });
    }

    await prisma.userAddress.updateMany({
      where: { userId },
      data: { isDefault: false },
    });
    const address = await prisma.userAddress.update({
      where: { id },
      data: { isDefault: true },
    });
    res.json(address);
  } catch (error) {
    console.error('Error estableciendo dirección predeterminada:', error);
    res.status(500).json({ error: 'Error al actualizar' });
  }
};
