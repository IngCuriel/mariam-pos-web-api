import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed de base de datos...');

  // Crear usuario admin por defecto
  const adminEmail = 'admin@mariamstore.com';
  const adminPassword = 'admin123';
  
  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail }
  });

  if (!existingAdmin) {
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

    console.log('✅ Usuario admin creado:');
    console.log(`   Email: ${adminEmail}`);
    console.log(`   Contraseña: ${adminPassword}`);
    console.log(`   ID: ${admin.id}`);
  } else {
    console.log('ℹ️  Usuario admin ya existe');
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

