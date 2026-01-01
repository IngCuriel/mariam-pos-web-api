import { PrismaClient } from '@prisma/client';
import { getOrCreateBranch } from '../services/branchService.js';
import { assignEmojiToProduct } from '../services/emojiService.js';
const prisma = new PrismaClient();

// Crear productos en bulk (con categorías, presentaciones e inventario)
export const createProductsBulk = async (req, res) => {
  try {
    const products = req.body;

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'Debes enviar un arreglo de productos válido' });
    }

    // Usamos una transacción global
    const result = await prisma.$transaction(async (tx) => {
      const createdProducts = [];

      for (const productData of products) {
        const {
          id: originalId,
          code,
          name,
          status,
          saleType,
          price,
          cost,
          description,
          icon,
          categoryId,
          trackInventory,
          isKit,
          branch,
          createdAt,
          category,
          presentations = [],
          inventory,
          kitItems = []
        } = productData;

        // 0. Obtener o crear sucursal PRIMERO (antes de usarla)
        const branchObj = await getOrCreateBranch(branch || "Sucursal Default");
        const branchId = branchObj.id;
        
        // 0.5. Asignar emoji automáticamente si no tiene icono
        const finalIcon = assignEmojiToProduct({ icon, name, description });
        
        // 1. Validar y crear/actualizar categoría si viene en el producto
        let finalCategoryId = categoryId;
        if (category && category.id) {
          // Verificar si la categoría ya existe
          const existingCategory = await tx.category.findUnique({
            where: { id: category.id }
          });

          if (!existingCategory) {
            // Crear nueva categoría solo si no existe
            const newCategory = await tx.category.create({
              data: {
                id: category.id,
                name: category.name,
                description: category.description,
                showInPOS: category.showInPOS || false,
                branchId: branchId
              }
            });
            finalCategoryId = newCategory.id;
            console.log(`✅ Categoría creada: ${category.name} (ID: ${category.id})`);
          } else {
            // Actualizar categoría existente
            await tx.category.update({
              where: { id: category.id },
              data: {
                name: category.name,
                description: category.description,
                showInPOS: category.showInPOS || false,
                branchId: branchId
              }
            });
            finalCategoryId = existingCategory.id;
            console.log(`✅ Categoría actualizada: ${category.name} (ID: ${category.id})`);
          }
        } else if (categoryId) {
          // Si solo viene categoryId, validar que existe
          const existingCategory = await tx.category.findUnique({
            where: { id: categoryId }
          });
          if (!existingCategory) {
            console.warn(`⚠️  Categoría con ID ${categoryId} no existe, se omitirá el producto ${name}`);
            continue; // Saltar este producto si la categoría no existe
          }
          finalCategoryId = categoryId;
        }

        // 2. Validar que tenemos una categoría válida antes de crear/actualizar producto
        if (!finalCategoryId) {
          console.warn(`⚠️  Producto ${name} (código: ${code}) no tiene categoría válida, se omitirá`);
          continue; // Saltar este producto si no tiene categoría
        }

        // Verificar que la categoría existe
        const categoryExists = await tx.category.findUnique({
          where: { id: finalCategoryId }
        });
        if (!categoryExists) {
          console.warn(`⚠️  Categoría con ID ${finalCategoryId} no existe para producto ${name}, se omitirá`);
          continue; // Saltar este producto si la categoría no existe
        }

        // 3. Crear o actualizar producto
        // Buscar si ya existe un producto con el mismo código EN LA MISMA SUCURSAL
        // (Los códigos pueden repetirse entre diferentes sucursales)
        // Si se repite el mismo código y sucursal, se actualiza; si no, se registra
        let product;
        let existingProduct = null;
        
        if (code && code.trim() !== '') {
          // Buscar solo dentro de la misma sucursal por código
          existingProduct = await tx.product.findFirst({
            where: {
              code: code.trim(),
              branchId: branchId
            }
          });
        }

        if (existingProduct) {
          // Si existe producto con mismo código y sucursal → ACTUALIZAR
          product = await tx.product.update({
            where: { id: existingProduct.id },
            data: {
              code: code ? code.trim() : null,
              name,
              status,
              saleType,
              price,
              cost,
              description,
              icon: finalIcon,
              categoryId: finalCategoryId,
              trackInventory: trackInventory || false,
              isKit: isKit || false,
              branchId: branchId,
            }
          });
          console.log(`✅ Producto actualizado: ${name} (Código: ${code || 'N/A'}, ID: ${existingProduct.id}, Sucursal: ${branchId}) - Emoji: ${finalIcon}`);
        } else {
          // Si NO existe producto con mismo código y sucursal → REGISTRAR (crear nuevo)
          // Crear nuevo producto
          try {
            product = await tx.product.create({
              data: {
                code: code ? code.trim() : null,
                name,
                status,
                saleType,
                price,
                cost,
                description,
                icon: finalIcon,
                categoryId: finalCategoryId,
                trackInventory: trackInventory || false,
                isKit: isKit || false,
                branchId: branchId,
                createdAt: createdAt ? new Date(createdAt) : new Date()
              }
            });
            console.log(`✅ Producto creado: ${name} (Código: ${code || 'N/A'}, ID: ${product.id}, Sucursal: ${branchId}) - Emoji: ${finalIcon}`);
          } catch (createError) {
            // Si falla por restricción única, verificar si es dentro de la misma sucursal
            if (createError.code === 'P2002' && createError.meta?.target?.includes('code')) {
              // Buscar el producto que tiene ese código en la misma sucursal
              const conflictingProduct = await tx.product.findFirst({
                where: { 
                  code: code,
                  branchId: branchId
                },
                include: { branch: true }
              });
              
              if (conflictingProduct) {
                // Conflicto dentro de la misma sucursal (esto no debería pasar si la lógica anterior está bien)
                const conflictInfo = `El código "${code}" ya está en uso por el producto "${conflictingProduct.name}" (ID: ${conflictingProduct.id}) en esta sucursal`;
                console.error(`❌ Error al crear producto: ${name} (Código: ${code}, Sucursal: ${branchId})`);
                console.error(`   ${conflictInfo}`);
                throw new Error(`No se pudo crear el producto "${name}" con código "${code}". ${conflictInfo}`);
              } else {
                // Puede haber una restricción única a nivel de base de datos que no permite códigos duplicados
                // incluso entre diferentes sucursales. Esto necesita una migración.
                console.error(`❌ Error: Restricción única en código "${code}" detectada a nivel de base de datos.`);
                console.error(`   Esto puede indicar que hay una restricción única en la columna 'code' que necesita ser eliminada.`);
                console.error(`   El código debería poder repetirse entre diferentes sucursales.`);
                throw new Error(`No se pudo crear el producto "${name}" con código "${code}". Hay una restricción única a nivel de base de datos que impide códigos duplicados. Se necesita una restricción única compuesta (code, branchId) en lugar de una única en 'code'.`);
              }
            }
            // Re-lanzar el error si no es de restricción única
            throw createError;
          }
        }

        // 4. Manejar presentaciones
        if (!isKit && presentations.length > 0) {
          // Eliminar presentaciones existentes que no vienen en el request
          const existingPresentationIds = presentations
            .filter(p => p.id)
            .map(p => p.id);
          
          await tx.productPresentation.deleteMany({
            where: {
              productId: product.id,
              id: { notIn: existingPresentationIds }
            }
          });

          // Crear o actualizar presentaciones
          for (const pres of presentations) {
            // Obtener sucursal de la presentación o usar la del producto
            const presBranchName = pres.branch || branch || "Sucursal Default";
            const presBranchObj = await getOrCreateBranch(presBranchName);
            
            if (pres.id) {
              // Actualizar presentación existente
              await tx.productPresentation.upsert({
                where: { id: pres.id },
                update: {
                  name: pres.name,
                  quantity: pres.quantity,
                  unitPrice: pres.unitPrice,
                  isDefault: pres.isDefault || false,
                  branchId: presBranchObj.id
                },
                create: {
                  id: pres.id,
                  name: pres.name,
                  quantity: pres.quantity,
                  unitPrice: pres.unitPrice,
                  isDefault: pres.isDefault || false,
                  productId: product.id,
                  branchId: presBranchObj.id
                }
              });
            } else {
              // Crear nueva presentación
              await tx.productPresentation.create({
                data: {
                  name: pres.name,
                  quantity: pres.quantity,
                  unitPrice: pres.unitPrice,
                  isDefault: pres.isDefault || false,
                  productId: product.id,
                  branchId: presBranchObj.id
                }
              });
            }
          }
        }

        // 5. Manejar inventario
        if (inventory) {
          // Obtener sucursal del inventario o usar la del producto
          const invBranchName = inventory.branch || branch || "Sucursal Default";
          const invBranchObj = await getOrCreateBranch(invBranchName);
          
          await tx.inventory.upsert({
            where: { productId: product.id },
            update: {
              currentStock: inventory.currentStock || 0,
              minStock: inventory.minStock || 0,
              maxStock: inventory.maxStock,
              trackInventory: inventory.trackInventory || false,
              branchId: invBranchObj.id
            },
            create: {
              productId: product.id,
              currentStock: inventory.currentStock || 0,
              minStock: inventory.minStock || 0,
              maxStock: inventory.maxStock,
              trackInventory: inventory.trackInventory || false,
              branchId: invBranchObj.id
            }
          });
        }

        // 5. Manejar kitItems si es un kit
        if (isKit && kitItems.length > 0) {
          // Eliminar kitItems existentes
          await tx.kitItem.deleteMany({
            where: { kitId: product.id }
          });

          // Crear nuevos kitItems
          if (kitItems.length > 0) {
            await tx.kitItem.createMany({
              data: kitItems.map((item, index) => ({
                kitId: product.id,
                productId: item.productId,
                presentationId: item.presentationId || null,
                quantity: item.quantity || 1,
                displayOrder: item.displayOrder || index
              }))
            });
          }
        }

        // Obtener el producto completo con relaciones
        const fullProduct = await tx.product.findUnique({
          where: { id: product.id },
          include: {
            category: true,
            branch: true,
            presentations: {
              include: {
                branch: true
              }
            },
            inventory: {
              include: {
                branch: true
              }
            },
            kitItems: {
              include: {
                product: true,
                presentation: true
              }
            }
          }
        });

        // Mapear para incluir branch.name como branch para compatibilidad
        const productWithBranch = {
          ...fullProduct,
          branch: fullProduct.branch?.name || null,
          presentations: fullProduct.presentations?.map(p => ({
            ...p,
            branch: p.branch?.name || null
          })) || [],
          inventory: fullProduct.inventory ? {
            ...fullProduct.inventory,
            branch: fullProduct.inventory.branch?.name || null
          } : null
        };

        createdProducts.push(productWithBranch);
      }

      return createdProducts;
    });

    console.log(`✅ ${result.length} producto(s) procesado(s) correctamente`);
    res.status(200).json({ 
      message: `✅ ${result.length} producto(s) procesado(s) correctamente`, 
      products: result 
    });
  } catch (error) {
    console.error('❌ Error en transacción de productos:', error);
    
    // Proporcionar información más detallada sobre el error
    let errorMessage = 'Error al procesar los productos';
    let errorDetails = error.message;
    
    if (error.code === 'P2002') {
      // Error de restricción única
      const target = error.meta?.target || [];
      if (target.includes('code')) {
        errorMessage = 'Error: Código de producto duplicado';
        errorDetails = `El código del producto ya existe en la base de datos. ${error.message}`;
      } else {
        errorMessage = 'Error: Restricción única violada';
        errorDetails = `Campo(s) duplicado(s): ${target.join(', ')}. ${error.message}`;
      }
    }
    
    res.status(500).json({ 
      error: errorMessage, 
      details: errorDetails,
      code: error.code,
      meta: error.meta
    });
  }
};

// Crear categorías en bulk
export const createCategoriesBulk = async (req, res) => {
  try {
    const categories = req.body;

    if (!Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({ error: 'Debes enviar un arreglo de categorías válido' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const createdCategories = [];

      for (const categoryData of categories) {
        const {
          id,
          name,
          description,
          showInPOS,
          branch
        } = categoryData;

        // Obtener o crear sucursal
        const branchObj = await getOrCreateBranch(branch || "Sucursal Default");

        const category = await tx.category.upsert({
          where: { id: id },
          update: {
            name,
            description,
            showInPOS: showInPOS || false,
            branchId: branchObj.id,
          },
          create: {
            id: id,
            name,
            description,
            showInPOS: showInPOS || false,
            branchId: branchObj.id,
          }
        });

        createdCategories.push(category);
      }

      return createdCategories;
    });

    console.log(`✅ ${result.length} categoría(s) procesada(s) correctamente`);
    res.status(200).json({ 
      message: `✅ ${result.length} categoría(s) procesada(s) correctamente`, 
      categories: result 
    });
  } catch (error) {
    console.error('❌ Error en transacción de categorías:', error);
    res.status(500).json({ error: 'Error al procesar las categorías', details: error.message });
  }
};

// Obtener productos por sucursal
export const getProductsByBranch = async (req, res) => {
  try {
    const { branch } = req.params;
    const { includeInventory, includePresentations } = req.query;

    // Buscar sucursal por nombre
    const branchObj = await prisma.branch.findUnique({
      where: { name: branch }
    });

    if (!branchObj) {
      return res.status(404).json({ error: 'Sucursal no encontrada' });
    }

    const include = {
      category: true,
      ...(includePresentations === 'true' && { presentations: true }),
      ...(includeInventory === 'true' && { inventory: true }),
      ...(includePresentations === 'true' && {
        kitItems: {
          include: {
            product: true,
            presentation: true
          }
        }
      })
    };

    const products = await prisma.product.findMany({
      where: { branchId: branchObj.id },
      include,
      orderBy: { createdAt: 'desc' }
    });

    // Mapear productos para incluir branch.name como branch para compatibilidad con frontend
    const productsWithBranch = products.map(product => ({
      ...product,
      branch: product.branch?.name || null
    }));

    res.json(productsWithBranch);
  } catch (error) {
    console.error('Error obteniendo productos por sucursal:', error);
    res.status(500).json({ error: 'Error obteniendo productos por sucursal' });
  }
};

// Obtener todas las categorías por sucursal
export const getCategoriesByBranch = async (req, res) => {
  try {
    const { branch } = req.params;

    // Buscar sucursal por nombre
    const branchObj = await prisma.branch.findUnique({
      where: { name: branch }
    });

    if (!branchObj) {
      return res.status(404).json({ error: 'Sucursal no encontrada' });
    }

    const categories = await prisma.category.findMany({
      where: { branchId: branchObj.id },
      include: {
        branch: true,
        products: {
          select: {
            id: true,
            name: true,
            code: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Mapear categorías para incluir branch.name como branch para compatibilidad con frontend
    const categoriesWithBranch = categories.map(category => ({
      ...category,
      branch: category.branch?.name || null
    }));

    res.json(categoriesWithBranch);
  } catch (error) {
    console.error('Error obteniendo categorías por sucursal:', error);
    res.status(500).json({ error: 'Error obteniendo categorías por sucursal' });
  }
};

// Obtener todos los productos de todas las sucursales (para tienda en línea)
export const getAllProducts = async (req, res) => {
  try {
    const { 
      includeInventory, 
      includePresentations, 
      search, 
      categoryId, 
      branch,
      limit = 30,
      offset = 0
    } = req.query;

    const where = {};
    
    // Filtro por búsqueda (nombre o descripción)
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } }
      ];
    }
    
    // Filtro por categoría
    if (categoryId) {
      where.categoryId = categoryId;
    }
    
    // Filtro por sucursal
    if (branch) {
      const branchObj = await prisma.branch.findUnique({
        where: { name: branch }
      });
      if (branchObj) {
        where.branchId = branchObj.id;
      } else {
        // Si no existe la sucursal, retornar respuesta vacía con paginación
        return res.json({
          products: [],
          total: 0,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: false
        });
      }
    }

    const include = {
      category: true,
      branch: true,
      ...(includePresentations === 'true' && { presentations: true }),
      ...(includeInventory === 'true' && { inventory: true })
    };

    // Obtener total de productos (para paginación)
    const total = await prisma.product.count({ where });

    // Obtener productos con paginación
    const products = await prisma.product.findMany({
      where,
      include,
      orderBy: { name: 'asc' },
      take: parseInt(limit),
      skip: parseInt(offset)
    });

    // Mapear productos para incluir branch.name como branch para compatibilidad con frontend
    const productsWithBranch = products.map(product => ({
      ...product,
      branch: product.branch?.name || null
    }));

    const currentOffset = parseInt(offset);
    const currentLimit = parseInt(limit);
    const hasMore = (currentOffset + currentLimit) < total;

    res.json({
      products: productsWithBranch,
      total,
      limit: currentLimit,
      offset: currentOffset,
      hasMore,
      nextOffset: hasMore ? currentOffset + currentLimit : null
    });
  } catch (error) {
    console.error('Error obteniendo todos los productos:', error);
    res.status(500).json({ error: 'Error obteniendo productos' });
  }
};

// Obtener todas las categorías de todas las sucursales
export const getAllCategories = async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      include: {
        branch: true
      },
      distinct: ['name'],
      orderBy: { name: 'asc' }
    });

    // Mapear categorías para incluir branch.name como branch para compatibilidad con frontend
    const categoriesWithBranch = categories.map(category => ({
      ...category,
      branch: category.branch?.name || null
    }));

    res.json(categoriesWithBranch);
  } catch (error) {
    console.error('Error obteniendo todas las categorías:', error);
    res.status(500).json({ error: 'Error obteniendo categorías' });
  }
};

// Obtener todas las sucursales únicas desde la tabla Branch
export const getAllBranches = async (req, res) => {
  try {
    const { getAllBranches: getAllBranchesService } = await import('../services/branchService.js');
    const branches = await getAllBranchesService();

    // Retornar solo los nombres para compatibilidad con el frontend
    const branchList = branches.map(b => b.name).sort();

    res.json(branchList);
  } catch (error) {
    console.error('Error obteniendo sucursales:', error);
    res.status(500).json({ error: 'Error obteniendo sucursales' });
  }
};

