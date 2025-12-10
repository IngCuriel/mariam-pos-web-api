import { PrismaClient } from '@prisma/client';
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

        // 1. Crear o actualizar categoría si viene en el producto
        let finalCategoryId = categoryId;
        if (category && category.id) {
          const existingCategory = await tx.category.findUnique({
            where: { id: category.id }
          });

          if (!existingCategory) {
            const newCategory = await tx.category.create({
              data: {
                id: category.id,
                name: category.name,
                description: category.description,
                showInPOS: category.showInPOS || false,
                branch: branch || "Sucursal Default"
              }
            });
            finalCategoryId = newCategory.id;
          } else {
            // Actualizar categoría si existe
            await tx.category.update({
              where: { id: category.id },
              data: {
                name: category.name,
                description: category.description,
                showInPOS: category.showInPOS || false,
                branch: branch || existingCategory.branch || "Sucursal Default"
              }
            });
            finalCategoryId = existingCategory.id;
          }
        }

        // 2. Crear o actualizar producto
        // Buscar si ya existe un producto con el mismo código y sucursal
        let product;
        const existingProduct = code 
          ? await tx.product.findFirst({
              where: {
                code: code,
                branch: branch || "Sucursal Default"
              }
            })
          : null;

        if (existingProduct) {
          // Actualizar producto existente
          product = await tx.product.update({
            where: { id: existingProduct.id },
            data: {
              code,
              name,
              status,
              saleType,
              price,
              cost,
              description,
              icon,
              categoryId: finalCategoryId,
              trackInventory: trackInventory || false,
              isKit: isKit || false,
              branch: branch || "Sucursal Default"
            }
          });
        } else {
          // Crear nuevo producto
          product = await tx.product.create({
            data: {
              code,
              name,
              status,
              saleType,
              price,
              cost,
              description,
              icon,
              categoryId: finalCategoryId,
              trackInventory: trackInventory || false,
              isKit: isKit || false,
              branch: branch || "Sucursal Default",
              createdAt: createdAt ? new Date(createdAt) : new Date()
            }
          });
        }

        // 3. Manejar presentaciones
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
            if (pres.id) {
              // Actualizar presentación existente
              await tx.productPresentation.upsert({
                where: { id: pres.id },
                update: {
                  name: pres.name,
                  quantity: pres.quantity,
                  unitPrice: pres.unitPrice,
                  isDefault: pres.isDefault || false,
                  branch: pres.branch || branch || "Sucursal Default"
                },
                create: {
                  id: pres.id,
                  name: pres.name,
                  quantity: pres.quantity,
                  unitPrice: pres.unitPrice,
                  isDefault: pres.isDefault || false,
                  productId: product.id,
                  branch: pres.branch || branch || "Sucursal Default"
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
                  branch: pres.branch || branch || "Sucursal Default"
                }
              });
            }
          }
        }

        // 4. Manejar inventario
        if (inventory) {
          await tx.inventory.upsert({
            where: { productId: product.id },
            update: {
              currentStock: inventory.currentStock || 0,
              minStock: inventory.minStock || 0,
              maxStock: inventory.maxStock,
              trackInventory: inventory.trackInventory || false,
              branch: inventory.branch || branch || "Sucursal Default"
            },
            create: {
              productId: product.id,
              currentStock: inventory.currentStock || 0,
              minStock: inventory.minStock || 0,
              maxStock: inventory.maxStock,
              trackInventory: inventory.trackInventory || false,
              branch: inventory.branch || branch || "Sucursal Default"
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
            presentations: true,
            inventory: true,
            kitItems: {
              include: {
                product: true,
                presentation: true
              }
            }
          }
        });

        createdProducts.push(fullProduct);
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
    res.status(500).json({ error: 'Error al procesar los productos', details: error.message });
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

        const category = await tx.category.upsert({
          where: { id: id },
          update: {
            name,
            description,
            showInPOS: showInPOS || false,
            branch: branch || "Sucursal Default"
          },
          create: {
            id: id,
            name,
            description,
            showInPOS: showInPOS || false,
            branch: branch || "Sucursal Default"
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
      where: { branch: branch },
      include,
      orderBy: { createdAt: 'desc' }
    });

    res.json(products);
  } catch (error) {
    console.error('Error obteniendo productos por sucursal:', error);
    res.status(500).json({ error: 'Error obteniendo productos por sucursal' });
  }
};

// Obtener todas las categorías por sucursal
export const getCategoriesByBranch = async (req, res) => {
  try {
    const { branch } = req.params;

    const categories = await prisma.category.findMany({
      where: { branch: branch },
      include: {
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

    res.json(categories);
  } catch (error) {
    console.error('Error obteniendo categorías por sucursal:', error);
    res.status(500).json({ error: 'Error obteniendo categorías por sucursal' });
  }
};

