import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed de base de datos...');

  // Crear usuario admin por defecto
  const adminPassword = 'admin123';
  const defaultAdmins = [
    { email: 'admin@mariamstore.com', name: 'Administrador' },
    { email: 'superadmin@mariamstore.com', name: 'Super Administrador' },
  ];

  const hashedAdminPassword = await bcrypt.hash(adminPassword, 10);

  for (const adminUser of defaultAdmins) {
    const existingAdmin = await prisma.user.findUnique({
      where: { email: adminUser.email },
    });

    if (!existingAdmin) {
      const admin = await prisma.user.create({
        data: {
          email: adminUser.email,
          name: adminUser.name,
          password: hashedAdminPassword,
          role: 'ADMIN',
          isActive: true,
        },
      });

      console.log('✅ Usuario admin creado:');
      console.log(`   Email: ${adminUser.email}`);
      console.log(`   Contraseña: ${adminPassword}`);
      console.log(`   ID: ${admin.id}`);
    } else {
      console.log(`ℹ️  Usuario admin ya existe: ${adminUser.email}`);
    }
  }

  // Crear usuario cliente de prueba
  const clientEmail = 'cliente@test.com';
  const clientPassword = 'cliente123';
  
  const existingClient = await prisma.user.findUnique({
    where: { email: clientEmail }
  });

  if (!existingClient) {
    const hashedPassword = await bcrypt.hash(clientPassword, 10);
    
    const client = await prisma.user.create({
      data: {
        email: clientEmail,
        name: 'Cliente de Prueba',
        password: hashedPassword,
        role: 'CLIENTE',
        isActive: true
      }
    });

    console.log('✅ Usuario cliente de prueba creado:');
    console.log(`   Email: ${clientEmail}`);
    console.log(`   Contraseña: ${clientPassword}`);
    console.log(`   ID: ${client.id}`);
  } else {
    console.log('ℹ️  Usuario cliente ya existe');
  }

  console.log('✨ Seed completado!');
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

