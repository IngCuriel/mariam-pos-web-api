import { PrismaClient } from '@prisma/client';
import { getOrCreateBranch, getAllBranchesForAdmin, updateBranch as updateBranchService } from '../services/branchService.js';
import { assignEmojiToProduct } from '../services/emojiService.js';
const prisma = new PrismaClient();

/** Valores permitidos para tipoEnvio (validaciones tienda online) */
const TIPO_ENVIO_VALUES = ['SOBRE_PEDIDO', 'SOLO_TIENDA', 'ENVIO_INMEDIATO'];

function normalizeTipoEnvio(value) {
  if (value === '' || value === null || value === undefined) return null;
  return TIPO_ENVIO_VALUES.includes(value) ? value : null;
}

/** Normaliza features a array de strings para guardar en Json, o null si está vacío */
function normalizeFeatures(features) {
  if (features == null) return null;
  const arr = Array.isArray(features)
    ? features
    : (typeof features === 'string' ? features.split('\n').map((s) => s.trim()).filter(Boolean) : []);
  const strings = arr.map((item) => (typeof item === 'string' ? item.trim() : String(item))).filter(Boolean);
  return strings.length === 0 ? null : strings;
}

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
          tipoEnvio,
          price,
          cost,
          description,
          features,
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
        // tipoEnvio y saleType son independientes: tipoEnvio = forma de entrega; saleType = tipo de venta comercial
        const finalTipoEnvio = normalizeTipoEnvio(tipoEnvio);

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
              tipoEnvio: finalTipoEnvio,
              price,
              cost,
              description,
              features: normalizeFeatures(features),
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
                tipoEnvio: finalTipoEnvio,
                price,
                cost,
                description,
                features: normalizeFeatures(features),
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

// Obtener un producto por ID
export const getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    const { includeInventory, includePresentations } = req.query;

    if (!id) {
      return res.status(400).json({ error: 'ID de producto requerido' });
    }

    const productId = Number.parseInt(id, 10);
    if (Number.isNaN(productId)) {
      return res.status(400).json({ error: 'ID de producto inválido' });
    }

    const include = {
      category: true,
      branch: true,
      images: {
        orderBy: { displayOrder: 'asc' }
      },
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

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include
    });

    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    // branch = nombre (string) para compatibilidad; branchInfo = { name, description, logo } para detalle
    const productWithBranch = {
      ...product,
      branch: product.branch?.name || null,
      branchInfo: product.branch
        ? {
            name: product.branch.name,
            description: product.branch.description || null,
            logo: product.branch.logo || null
          }
        : null
    };

    res.json(productWithBranch);
  } catch (error) {
    console.error('Error obteniendo producto por ID:', error);
    res.status(500).json({ error: 'Error obteniendo producto' });
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
      branchId,
      showInStoreOnly = 'false',
      limit = 30,
      offset = 0,
      sortBy
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
    // Si se solicita solo categorías visibles (showInStoreOnly), siempre filtrar por showInStore: true
    if (showInStoreOnly === 'true') {
      if (categoryId) {
        // Si hay categoryId específico, verificar que esa categoría tenga showInStore: true
        const category = await prisma.category.findUnique({
          where: { id: categoryId },
          select: { id: true, showInStore: true }
        });
        
        if (!category || !category.showInStore) {
          // Si la categoría no existe o no está visible, retornar respuesta vacía
          return res.json({
            products: [],
            total: 0,
            limit: parseInt(limit),
            offset: parseInt(offset),
            hasMore: false
          });
        }
        
        // Si la categoría es visible, usar el categoryId normalmente
        where.categoryId = categoryId;
      } else {
        // Si no hay categoryId específico, obtener IDs de todas las categorías visibles
        const visibleCategories = await prisma.category.findMany({
          where: { showInStore: true },
          select: { id: true }
        });
        
        const visibleCategoryIds = visibleCategories.map(cat => cat.id);
        
        if (visibleCategoryIds.length > 0) {
          where.categoryId = { in: visibleCategoryIds };
        } else {
          // Si no hay categorías visibles, retornar respuesta vacía
          return res.json({
            products: [],
            total: 0,
            limit: parseInt(limit),
            offset: parseInt(offset),
            hasMore: false
          });
        }
      }
      
      // También filtrar por productos con showInStore: true
      where.showInStore = true;
    } else if (categoryId) {
      // Si no se solicita showInStoreOnly pero hay categoryId, usar normalmente (para admin u otros casos)
      where.categoryId = categoryId;
    }
    
    // Filtro por sucursal (branchId tiene prioridad sobre branch por nombre)
    if (branchId) {
      where.branchId = parseInt(branchId, 10);
    } else if (branch) {
      const branchObj = await prisma.branch.findUnique({
        where: { name: branch }
      });
      if (branchObj) {
        where.branchId = branchObj.id;
      } else {
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
      images: {
        orderBy: { displayOrder: 'asc' }
      },
      ...(includePresentations === 'true' && { presentations: true }),
      ...(includeInventory === 'true' && { inventory: true })
    };

    // Obtener total de productos (para paginación)
    const total = await prisma.product.count({ where });

    // Orden: por defecto nombre; si sortBy=createdAt, los más recientes primero
    const orderBy = sortBy === 'createdAt'
      ? { createdAt: 'desc' }
      : { name: 'asc' };

    const products = await prisma.product.findMany({
      where,
      include,
      orderBy,
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
    // Si se solicita solo para la tienda, filtrar por showInStore
    const showInStoreOnly = req.query.showInStore === 'true';
    
    const whereClause = showInStoreOnly ? { showInStore: true } : {};
    
    // Obtener TODAS las categorías que cumplan el filtro (sin distinct)
    // Esto permite mostrar todas las categorías, incluso si tienen el mismo nombre pero diferente sucursal
    const categories = await prisma.category.findMany({
      where: whereClause,
      include: {
        branch: true
      },
      orderBy: [
        { name: 'asc' },
        { branchId: 'asc' } // Ordenar también por sucursal para consistencia
      ]
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

// Obtener todas las sucursales para configuración admin (incluye inactivas)
export const getBranchesForConfig = async (req, res) => {
  try {
    const branches = await getAllBranchesForAdmin();
    res.json(branches);
  } catch (error) {
    console.error('Error obteniendo sucursales para config:', error);
    res.status(500).json({ error: 'Error obteniendo sucursales' });
  }
};

// Actualizar sucursal (isActive, description, logo) - solo admin
export const updateBranch = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive, description, logo } = req.body;

    const data = {};
    if (typeof isActive === 'boolean') data.isActive = isActive;
    if (description !== undefined) data.description = description === '' ? null : description;
    if (logo !== undefined) data.logo = logo === '' ? null : logo;

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Envía al menos un campo: isActive, description o logo' });
    }

    const branch = await updateBranchService(id, data);
    res.json(branch);
  } catch (error) {
    console.error('Error actualizando sucursal:', error);
    res.status(500).json({ error: 'Error actualizando sucursal' });
  }
};

// Actualizar una categoría (solo admin)
export const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { showInStore, image } = req.body;

    console.log(`🔄 [updateCategory] Actualizando categoría ${id}:`, { showInStore, image });

    // Validar que al menos un campo se esté actualizando
    if (showInStore === undefined && image === undefined) {
      return res.status(400).json({ 
        error: 'Debes proporcionar al menos un campo para actualizar (showInStore o image)' 
      });
    }

    // Construir objeto de actualización
    const updateData = {};
    if (showInStore !== undefined) {
      updateData.showInStore = Boolean(showInStore);
      console.log(`   ✅ showInStore será: ${updateData.showInStore}`);
    }
    if (image !== undefined) {
      updateData.image = image || null;
      console.log(`   ✅ image será: ${updateData.image ? 'actualizada' : 'eliminada'}`);
    }

    // Actualizar la categoría
    const updatedCategory = await prisma.category.update({
      where: { id },
      data: updateData,
      include: {
        branch: true
      }
    });

    console.log(`✅ [updateCategory] Categoría actualizada exitosamente:`, {
      id: updatedCategory.id,
      name: updatedCategory.name,
      showInStore: updatedCategory.showInStore,
      image: updatedCategory.image ? 'presente' : 'sin imagen'
    });

    // Mapear para incluir branch.name como branch
    const categoryWithBranch = {
      ...updatedCategory,
      branch: updatedCategory.branch?.name || null
    };

    res.json({ 
      message: 'Categoría actualizada exitosamente',
      category: categoryWithBranch
    });
  } catch (error) {
    if (error.code === 'P2025') {
      console.error(`❌ [updateCategory] Categoría no encontrada: ${req.params.id}`);
      return res.status(404).json({ error: 'Categoría no encontrada' });
    }
    console.error('❌ [updateCategory] Error actualizando categoría:', error);
    res.status(500).json({ 
      error: 'Error actualizando categoría',
      details: error.message 
    });
  }
};

// Obtener solo categorías visibles para configuración (solo admin)
export const getCategoriesForConfig = async (req, res) => {
  try {
    // Obtener todas las categorías visibles con su imagen
    const visibleCategories = await prisma.category.findMany({
      where: { showInStore: true },
      select: {
        id: true,
        name: true,
        image: true,
        description: true
      },
      orderBy: { name: 'asc' }
    });
    
    res.json({
      categories: visibleCategories
    });
  } catch (error) {
    console.error('Error obteniendo categorías para configuración:', error);
    res.status(500).json({ error: 'Error obteniendo categorías' });
  }
};

// Obtener productos de una categoría específica para configuración (solo admin)
export const getProductsByCategoryForConfig = async (req, res) => {
  try {
    const { categoryId } = req.params;
    
    if (!categoryId) {
      return res.status(400).json({ error: 'ID de categoría requerido' });
    }
    
    // Verificar que la categoría existe y está visible
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
      select: {
        id: true,
        name: true,
        showInStore: true
      }
    });
    
    if (!category || !category.showInStore) {
      return res.status(404).json({ error: 'Categoría no encontrada o no visible' });
    }
    
    // Obtener productos de la categoría con sus imágenes
    const products = await prisma.product.findMany({
      where: {
        categoryId: categoryId
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            showInStore: true
          }
        },
        branch: {
          select: {
            id: true,
            name: true
          }
        },
        images: {
          orderBy: { displayOrder: 'asc' }
        }
      },
      orderBy: { name: 'asc' }
    });
    
    res.json({
      category,
      products
    });
  } catch (error) {
    console.error('Error obteniendo productos por categoría:', error);
    res.status(500).json({ error: 'Error obteniendo productos' });
  }
};

// Actualizar visibilidad de un producto (solo admin)
export const updateProductVisibility = async (req, res) => {
  try {
    const { id } = req.params;
    const { showInStore } = req.body;
    
    if (showInStore === undefined) {
      return res.status(400).json({ 
        error: 'Debes proporcionar el campo showInStore' 
      });
    }
    
    const updatedProduct = await prisma.product.update({
      where: { id: parseInt(id) },
      data: { showInStore: Boolean(showInStore) },
      include: {
        category: {
          select: {
            id: true,
            name: true
          }
        },
        images: {
          orderBy: { displayOrder: 'asc' }
        }
      }
    });
    
    res.json({ 
      message: 'Producto actualizado exitosamente',
      product: updatedProduct
    });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    console.error('Error actualizando visibilidad del producto:', error);
    res.status(500).json({ error: 'Error actualizando producto' });
  }
};

// Actualizar características (lista) de un producto (solo admin)
export const updateProductFeatures = async (req, res) => {
  try {
    const { id } = req.params;
    const { features } = req.body;

    const value = normalizeFeatures(features);

    const updatedProduct = await prisma.product.update({
      where: { id: Number.parseInt(id, 10) },
      data: { features: value },
      include: {
        category: { select: { id: true, name: true } },
        images: { orderBy: { displayOrder: 'asc' } },
      },
    });

    res.json({
      message: 'Características actualizadas',
      product: updatedProduct,
    });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    console.error('Error actualizando características:', error);
    res.status(500).json({ error: 'Error actualizando producto' });
  }
};

// Actualizar solo tipoEnvio (forma de entrega: SOBRE_PEDIDO | SOLO_TIENDA | ENVIO_INMEDIATO). No modifica saleType.
export const updateProductTipoEnvio = async (req, res) => {
  try {
    const { id } = req.params;
    const { tipoEnvio } = req.body;

    const value = normalizeTipoEnvio(tipoEnvio);

    const updatedProduct = await prisma.product.update({
      where: { id: Number.parseInt(id, 10) },
      data: { tipoEnvio: value },
      include: {
        category: { select: { id: true, name: true } },
        images: { orderBy: { displayOrder: 'asc' } },
      },
    });

    res.json({
      message: 'Tipo de envío actualizado',
      product: updatedProduct,
    });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    console.error('Error actualizando tipo de envío:', error);
    res.status(500).json({ error: 'Error actualizando producto' });
  }
};

// Agregar imagen a un producto (solo admin)
export const addProductImage = async (req, res) => {
  try {
    const { id } = req.params;
    const { url, displayOrder } = req.body;
    
    if (!url) {
      return res.status(400).json({ 
        error: 'Debes proporcionar la URL de la imagen' 
      });
    }
    
    // Verificar que el producto existe
    const product = await prisma.product.findUnique({
      where: { id: parseInt(id) },
      include: {
        images: true
      }
    });
    
    if (!product) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    
    // Verificar que no se excedan 5 imágenes
    if (product.images.length >= 5) {
      return res.status(400).json({ 
        error: 'Un producto puede tener máximo 5 imágenes' 
      });
    }
    
    // Crear la imagen
    const newImage = await prisma.productImage.create({
      data: {
        url,
        displayOrder: displayOrder || product.images.length,
        productId: parseInt(id)
      }
    });
    
    res.json({ 
      message: 'Imagen agregada exitosamente',
      image: newImage
    });
  } catch (error) {
    console.error('Error agregando imagen al producto:', error);
    res.status(500).json({ error: 'Error agregando imagen' });
  }
};

// Eliminar imagen de un producto (solo admin)
export const deleteProductImage = async (req, res) => {
  try {
    const { id, imageId } = req.params;
    
    // Verificar que la imagen pertenece al producto
    const image = await prisma.productImage.findFirst({
      where: {
        id: parseInt(imageId),
        productId: parseInt(id)
      }
    });
    
    if (!image) {
      return res.status(404).json({ error: 'Imagen no encontrada' });
    }
    
    // Eliminar la imagen
    await prisma.productImage.delete({
      where: { id: parseInt(imageId) }
    });
    
    res.json({ 
      message: 'Imagen eliminada exitosamente'
    });
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Imagen no encontrada' });
    }
    console.error('Error eliminando imagen del producto:', error);
    res.status(500).json({ error: 'Error eliminando imagen' });
  }
};

// Reordenar imágenes de un producto (solo admin)
export const reorderProductImages = async (req, res) => {
  try {
    const { id } = req.params;
    const { imageOrders } = req.body; // Array de { imageId, displayOrder }
    
    if (!Array.isArray(imageOrders)) {
      return res.status(400).json({ 
        error: 'Debes proporcionar un arreglo de imageOrders' 
      });
    }
    
    // Actualizar el orden de cada imagen
    await prisma.$transaction(
      imageOrders.map(({ imageId, displayOrder }) =>
        prisma.productImage.update({
          where: { id: imageId },
          data: { displayOrder }
        })
      )
    );
    
    res.json({ 
      message: 'Orden de imágenes actualizado exitosamente'
    });
  } catch (error) {
    console.error('Error reordenando imágenes:', error);
    res.status(500).json({ error: 'Error reordenando imágenes' });
  }
};

