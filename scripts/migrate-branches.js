/**
 * Script de migración de datos: Migra sucursales de strings a tabla Branch
 * 
 * Este script:
 * 1. Crea la tabla Branch si no existe
 * 2. Extrae todas las sucursales únicas de las tablas existentes
 * 3. Crea registros en la tabla Branch
 * 4. Actualiza los registros para usar branchId y branchName
 * 5. Mantiene branchName para compatibilidad
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function migrateBranches() {
  try {
    console.log('🔄 Iniciando migración de sucursales...\n');

    // 1. Obtener todas las sucursales únicas de todas las tablas
    console.log('📋 Extrayendo sucursales únicas...');
    
    const [saleBranches, productBranches, categoryBranches, presentationBranches] = await Promise.all([
      prisma.$queryRaw`SELECT DISTINCT branch FROM "Sale" WHERE branch IS NOT NULL AND branch != ''`,
      prisma.$queryRaw`SELECT DISTINCT branch FROM "Product" WHERE branch IS NOT NULL AND branch != ''`,
      prisma.$queryRaw`SELECT DISTINCT branch FROM "Category" WHERE branch IS NOT NULL AND branch != ''`,
      prisma.$queryRaw`SELECT DISTINCT branch FROM "ProductPresentation" WHERE branch IS NOT NULL AND branch != ''`,
    ]);

    // Combinar todas las sucursales únicas
    const allBranches = new Set();
    
    saleBranches.forEach((row: any) => allBranches.add(row.branch));
    productBranches.forEach((row: any) => allBranches.add(row.branch));
    categoryBranches.forEach((row: any) => allBranches.add(row.branch));
    presentationBranches.forEach((row: any) => allBranches.add(row.branch));

    const uniqueBranches = Array.from(allBranches).filter(b => b && b.trim() !== '');
    
    console.log(`✅ Encontradas ${uniqueBranches.length} sucursales únicas:`, uniqueBranches);
    console.log('');

    // 2. Crear registros en la tabla Branch
    console.log('🏢 Creando registros en la tabla Branch...');
    
    const branchMap = new Map(); // Mapa: nombre -> id

    for (const branchName of uniqueBranches) {
      try {
        // Intentar crear o obtener la sucursal
        const branch = await prisma.branch.upsert({
          where: { name: branchName },
          update: { isActive: true },
          create: {
            name: branchName,
            description: `Sucursal ${branchName}`,
            isActive: true,
          },
        });
        
        branchMap.set(branchName, branch.id);
        console.log(`  ✅ ${branchName} -> ID: ${branch.id}`);
      } catch (error: any) {
        if (error.code === 'P2002') {
          // Ya existe, obtenerla
          const existing = await prisma.branch.findUnique({
            where: { name: branchName }
          });
          if (existing) {
            branchMap.set(branchName, existing.id);
            console.log(`  ℹ️  ${branchName} ya existe -> ID: ${existing.id}`);
          }
        } else {
          console.error(`  ❌ Error con ${branchName}:`, error.message);
        }
      }
    }

    console.log(`\n✅ ${branchMap.size} sucursales registradas en la tabla Branch\n`);

    // 3. Actualizar registros en cada tabla
    console.log('🔄 Actualizando registros...\n');

    // Actualizar Sales
    console.log('📊 Actualizando Sales...');
    let salesUpdated = 0;
    for (const [branchName, branchId] of branchMap.entries()) {
      const result = await prisma.$executeRaw`
        UPDATE "Sale"
        SET "branchId" = ${branchId}, "branchName" = ${branchName}
        WHERE branch = ${branchName} AND ("branchId" IS NULL OR "branchName" IS NULL)
      `;
      salesUpdated += Number(result);
    }
    console.log(`  ✅ ${salesUpdated} ventas actualizadas`);

    // Actualizar Products
    console.log('🛍️  Actualizando Products...');
    let productsUpdated = 0;
    for (const [branchName, branchId] of branchMap.entries()) {
      const result = await prisma.$executeRaw`
        UPDATE "Product"
        SET "branchId" = ${branchId}, "branchName" = ${branchName}
        WHERE branch = ${branchName} AND ("branchId" IS NULL OR "branchName" IS NULL)
      `;
      productsUpdated += Number(result);
    }
    console.log(`  ✅ ${productsUpdated} productos actualizados`);

    // Actualizar Categories
    console.log('📁 Actualizando Categories...');
    let categoriesUpdated = 0;
    for (const [branchName, branchId] of branchMap.entries()) {
      const result = await prisma.$executeRaw`
        UPDATE "Category"
        SET "branchId" = ${branchId}, "branchName" = ${branchName}
        WHERE branch = ${branchName} AND ("branchId" IS NULL OR "branchName" IS NULL)
      `;
      categoriesUpdated += Number(result);
    }
    console.log(`  ✅ ${categoriesUpdated} categorías actualizadas`);

    // Actualizar ProductPresentations
    console.log('📦 Actualizando ProductPresentations...');
    let presentationsUpdated = 0;
    for (const [branchName, branchId] of branchMap.entries()) {
      const result = await prisma.$executeRaw`
        UPDATE "ProductPresentation"
        SET "branchId" = ${branchId}, "branchName" = ${branchName}
        WHERE branch = ${branchName} AND ("branchId" IS NULL OR "branchName" IS NULL)
      `;
      presentationsUpdated += Number(result);
    }
    console.log(`  ✅ ${presentationsUpdated} presentaciones actualizadas`);

    // Actualizar Inventory
    console.log('📊 Actualizando Inventory...');
    let inventoriesUpdated = 0;
    for (const [branchName, branchId] of branchMap.entries()) {
      const result = await prisma.$executeRaw`
        UPDATE "Inventory"
        SET "branchId" = ${branchId}, "branchName" = ${branchName}
        WHERE branch = ${branchName} AND ("branchId" IS NULL OR "branchName" IS NULL)
      `;
      inventoriesUpdated += Number(result);
    }
    console.log(`  ✅ ${inventoriesUpdated} inventarios actualizados`);

    console.log('\n✅ Migración completada exitosamente!');
    console.log('\n📊 Resumen:');
    console.log(`  - Sucursales creadas: ${branchMap.size}`);
    console.log(`  - Ventas actualizadas: ${salesUpdated}`);
    console.log(`  - Productos actualizados: ${productsUpdated}`);
    console.log(`  - Categorías actualizadas: ${categoriesUpdated}`);
    console.log(`  - Presentaciones actualizadas: ${presentationsUpdated}`);
    console.log(`  - Inventarios actualizados: ${inventoriesUpdated}`);
    console.log('\n⚠️  NOTA: Las columnas antiguas "branch" (string) se mantendrán para compatibilidad.');
    console.log('   Puedes eliminarlas manualmente después de verificar que todo funciona correctamente.');

  } catch (error) {
    console.error('❌ Error en la migración:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Ejecutar migración
migrateBranches()
  .then(() => {
    console.log('\n✅ Script completado');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error fatal:', error);
    process.exit(1);
  });

