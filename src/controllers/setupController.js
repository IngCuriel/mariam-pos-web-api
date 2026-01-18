import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Endpoint temporal para crear usuario admin (solo desarrollo)
export const createAdmin = async (req, res) => {
  try {
    const adminEmail = 'admin@mariamstore.com';
    const adminPassword = 'admin123';
    
    // Verificar si ya existe
    const existingAdmin = await prisma.user.findUnique({
      where: { email: adminEmail }
    });

    if (existingAdmin) {
      return res.json({
        message: 'Usuario admin ya existe',
        email: adminEmail,
        password: adminPassword
      });
    }

    // Crear admin
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'Administrador',
        password: hashedPassword,
        role: 'ADMIN',
        isActive: true
      }
    });

    res.json({
      message: 'Usuario admin creado exitosamente',
      email: adminEmail,
      password: adminPassword,
      user: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role
      }
    });
  } catch (error) {
    console.error('Error creando admin:', error);
    res.status(500).json({
      error: 'Error al crear usuario admin',
      details: error.message
    });
  }
};

