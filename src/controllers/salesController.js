import { PrismaClient } from '@prisma/client';
import { getOrCreateBranch } from '../services/branchService.js';
import {
  paddedUtcWindowForBusinessRange,
  filterRowsByBusinessDateRange,
  sqlUtcTimestampToBusinessDate,
} from '../utils/businessTimezone.js';
import { resolveAllowedBranches } from '../utils/userBranches.js';

/**
 * Calcula el filtro final de branchId combinando:
 *  - la sucursal pedida por el usuario (requestedBranchId, puede ser null)
 *  - las sucursales que el usuario tiene permitido ver (según su rol)
 *
 * @returns {{ deny: boolean, branchIdFilter: number | { in: number[] } | undefined }}
 *   deny=true → el usuario no puede ver nada (responder []).
 *   branchIdFilter → valor listo para asignar a where.branchId (o undefined = sin filtro).
 */
function computeBranchFilter(allowed, requestedBranchId) {
  // Super admin: sin restricción; respeta solo lo que pidió (si pidió algo).
  if (allowed.unrestricted) {
    return { deny: false, branchIdFilter: requestedBranchId || undefined };
  }

  // Admin sin sucursales asignadas (o rol sin acceso): no ve nada.
  if (allowed.branchIds.length === 0) {
    return { deny: true, branchIdFilter: undefined };
  }

  // Pidió una sucursal específica: solo se permite si está entre las asignadas.
  if (requestedBranchId) {
    if (allowed.branchIds.includes(requestedBranchId)) {
      return { deny: false, branchIdFilter: requestedBranchId };
    }
    // Pidió una sucursal que no le corresponde → no ve nada.
    return { deny: true, branchIdFilter: undefined };
  }

  // No pidió sucursal: se restringe al conjunto de las asignadas.
  return { deny: false, branchIdFilter: { in: allowed.branchIds } };
}

const prisma = new PrismaClient();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidYyyyMmDd(value) {
  return typeof value === 'string' && DATE_RE.test(value.trim());
}

function mapSaleRowWithBranch(sale) {
  return {
    id: sale.id,
    folio: sale.folio,
    total: sale.total,
    status: sale.status,
    branch: sale.branch?.name ?? 'Sin sucursal',
    cashRegister: sale.cashRegister,
    paymentMethod: sale.paymentMethod,
    createdAt: sale.createdAt,
    clientName: sale.clientName,
    syncStatus: sale.syncStatus,
    details: sale.details ?? [],
  };
}

async function resolveBranchIdByName(branchName) {
  if (!branchName) return null;
  const branchObj = await prisma.branch.findUnique({
    where: { name: branchName },
  });
  return branchObj ? branchObj.id : null;
}

// Obtener todas las ventas con filtros opcionales
export const getSales = async (req, res) => {
  try {
    const { startDate, endDate, branch, paymentMethod } = req.query;

    // Seguridad: restringir a las sucursales que el usuario tiene permitido ver.
    const allowed = await resolveAllowedBranches(req.userId, req.userRole);

    let sales;
    if (startDate || endDate) {
      const fromOk = isValidYyyyMmDd(startDate) ? startDate.trim() : null;
      const toOk = isValidYyyyMmDd(endDate) ? endDate.trim() : null;
      if ((startDate && !fromOk) || (endDate && !toOk)) {
        return res.status(400).json({
          error: 'Formato de fecha inválido. Use YYYY-MM-DD.',
        });
      }
      if (!fromOk && !toOk) {
        return res.status(400).json({
          error: 'Indica al menos una fecha válida (YYYY-MM-DD).',
        });
      }

      const rangeFrom = fromOk || toOk;
      const rangeTo = toOk || fromOk;

      const requestedBranchId = await resolveBranchIdByName(branch);
      const { deny, branchIdFilter } = computeBranchFilter(allowed, requestedBranchId);
      if (deny) return res.json([]);

      let padded;
      try {
        padded = paddedUtcWindowForBusinessRange(rangeFrom, rangeTo, 48);
      } catch (e) {
        return res.status(400).json({
          error: e.message || 'Fechas inválidas',
        });
      }

      const where = {
        createdAt: {
          gte: padded.gte,
          lte: padded.lte,
        },
      };
      if (branchIdFilter !== undefined) where.branchId = branchIdFilter;
      if (paymentMethod) where.paymentMethod = paymentMethod;

      const maxFetch = 15000;
      const candidates = await prisma.sale.findMany({
        where,
        include: { details: true, branch: true },
        orderBy: { createdAt: 'desc' },
        take: maxFetch,
      });

      const filtered = filterRowsByBusinessDateRange(candidates, rangeFrom, rangeTo);
      sales = filtered.map(mapSaleRowWithBranch);

      if (candidates.length === maxFetch) {
        res.setHeader('X-Query-Truncated', '1');
      }
    } else {
      // Sin filtros de fecha, usar Prisma normal
      const where = {};
      let requestedBranchId = null;
      if (branch) {
        requestedBranchId = await resolveBranchIdByName(branch);
        if (!requestedBranchId) {
          // Si no existe la sucursal, no retornar ventas
          return res.json([]);
        }
      }
      const { deny, branchIdFilter } = computeBranchFilter(allowed, requestedBranchId);
      if (deny) return res.json([]);
      if (branchIdFilter !== undefined) where.branchId = branchIdFilter;
      if (paymentMethod) where.paymentMethod = paymentMethod;
      
      const rows = await prisma.sale.findMany({
        where: Object.keys(where).length > 0 ? where : undefined,
        orderBy: { id: 'desc' },
        include: { details: true, branch: true },
      });
      sales = rows.map(mapSaleRowWithBranch);
    }

    res.json(sales);
  } catch (error) {
    console.error('Error obteniendo ventas:', error);
    res.status(500).json({ error: 'Error obteniendo ventas' });
  }
};

// Crear una venta
export const createSale = async (req, res) => {
  try {
    const { folio, total, branch, cashRegister, status, paymentMethod, details } = req.body;
    
    // Obtener o crear sucursal
    const branchObj = await getOrCreateBranch(branch || "Sucursal Default");
    
    const sale = await prisma.sale.create({
      data: {
        folio,
        total,
        branchId: branchObj.id,
        cashRegister,
        status,
        paymentMethod,
        details: { create: details },
      },
      include: { details: true, branch: true },
    });
    
    // Mapear para incluir branch.name como branch para compatibilidad con frontend
    const saleWithBranch = {
      ...sale,
      branch: sale.branch?.name || null
    };
    
    res.json(saleWithBranch);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error creando venta' });
  }
};

export const getSalesById = async (req, res) => {
  const { id } = req.params;
  const sale = await prisma.sale.findUnique({
    where: { id: parseInt(id) },
    include: {
       details: true,
       branch: true
    },
  });
  
  // Mapear para incluir branch.name como branch para compatibilidad con frontend
  const saleWithBranch = {
    ...sale,
    branch: sale?.branch?.name || null
  };
  
  res.json(saleWithBranch);
};


export const createSalesWithDetails = async (req, res) => {
  try {
    const sales  = req.body;

    console.log('sales bulk' , sales);
    //console.log('req', req);
 
    if (!Array.isArray(sales) || sales.length === 0) {
      return res.status(400).json({ error: 'Debes enviar un arreglo de ventas válido' });
    }

    // Usamos una transacción global
    const result = await prisma.$transaction(async (tx) => {
      const createdSales = [];

      for (const sale of sales) {
        const {id, folio, branch, cashRegister, total, status , paymentMethod,createdAt,clientName, syncStatus, details } = sale;
 
        // Obtener o crear sucursal
        const branchObj = await getOrCreateBranch(branch || "Sucursal Default");

        const createdSale = await tx.sale.create({
          data: {
            folio :'TK '+id,
            branchId: branchObj.id,
            cashRegister,
            total,
            status,
            paymentMethod,
            createdAt,
            clientName,
            syncStatus: 'enviado',
            details: {
              create: details?.map((d) => ({
                quantity: d.quantity,
                price: d.price,
                subTotal: d.subTotal,
                productName: d.productName,
                createdAt: d.createdAt
              })),
            },
          },
          include: { details: true, branch: true },
        });

        // Mapear para incluir branch.name como branch para compatibilidad
        const saleWithBranch = {
          ...createdSale,
          branch: createdSale.branch?.name || null
        };

        createdSales.push(saleWithBranch);
      }

      return createdSales;
    });
    console.log('✅ Ventas creadas correctamente');
    res.status(200).json({ message: '✅ Ventas creadas correctamente', sales: result });
  } catch (error) {
    console.error('❌ Error en transacción de ventas:', error);
    res.status(500).json({ error: 'Error al crear las ventas' });
  }
};

// Obtener estadísticas generales
export const getSalesStats = async (req, res) => {
  try {
    const { startDate, endDate, branch } = req.query;

    const dateExpr = sqlUtcTimestampToBusinessDate('s');

    const emptyStats = {
      totalSales: 0,
      totalAmount: 0,
      averageSale: 0,
      byBranch: [],
      byPaymentMethod: [],
      byDay: [],
    };

    // Seguridad: restringir a las sucursales que el usuario tiene permitido ver.
    const allowed = await resolveAllowedBranches(req.userId, req.userRole);

    let whereConditions = [];

    if (startDate) {
      if (!isValidYyyyMmDd(startDate)) {
        return res.status(400).json({ error: 'Formato de fecha inválido (startDate). Use YYYY-MM-DD.' });
      }
      whereConditions.push(`${dateExpr} >= '${startDate.trim()}'::date`);
    }

    if (endDate) {
      if (!isValidYyyyMmDd(endDate)) {
        return res.status(400).json({ error: 'Formato de fecha inválido (endDate). Use YYYY-MM-DD.' });
      }
      whereConditions.push(`${dateExpr} <= '${endDate.trim()}'::date`);
    }

    let requestedBranchId = null;
    if (branch) {
      const branchObj = await prisma.branch.findUnique({
        where: { name: branch }
      });
      if (!branchObj) {
        // Si no existe la sucursal, retornar estadísticas vacías
        return res.json(emptyStats);
      }
      requestedBranchId = branchObj.id;
    }

    // Combinar la sucursal pedida con las sucursales permitidas del usuario.
    const { deny, branchIdFilter } = computeBranchFilter(allowed, requestedBranchId);
    if (deny) return res.json(emptyStats);

    if (branchIdFilter !== undefined) {
      if (typeof branchIdFilter === 'object' && Array.isArray(branchIdFilter.in)) {
        const ids = branchIdFilter.in.map((n) => parseInt(n, 10)).filter((n) => !Number.isNaN(n));
        // No debería quedar vacío (deny lo cubre), pero por seguridad:
        if (ids.length === 0) return res.json(emptyStats);
        whereConditions.push(`s."branchId" IN (${ids.join(', ')})`);
      } else {
        whereConditions.push(`s."branchId" = ${parseInt(branchIdFilter, 10)}`);
      }
    }
    
    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';
    
    // Usar consultas raw para aplicar filtros de zona horaria
    const [totalSalesResult, totalAmountResult, salesByBranchResult, salesByPaymentMethodResult, salesByDayResult] = await Promise.all([
      // Total de ventas
      prisma.$queryRawUnsafe(
        `SELECT COUNT(*) as count FROM "Sale" s ${whereClause}`
      ),
      
      // Monto total
      prisma.$queryRawUnsafe(
        `SELECT COALESCE(SUM(s.total), 0) as sum FROM "Sale" s ${whereClause}`
      ),
      
      // Ventas por sucursal
      prisma.$queryRawUnsafe(
        `SELECT 
          COALESCE(b.name, 'Sin sucursal') as branch,
          COUNT(*) as count,
          COALESCE(SUM(s.total), 0) as total
        FROM "Sale" s
        LEFT JOIN "Branch" b ON s."branchId" = b.id
        ${whereClause}
        GROUP BY COALESCE(b.name, 'Sin sucursal')`
      ),
      
      // Ventas por método de pago
      prisma.$queryRawUnsafe(
        `SELECT 
          s."paymentMethod",
          COUNT(*) as count,
          COALESCE(SUM(s.total), 0) as total
        FROM "Sale" s
        ${whereClause}
        GROUP BY s."paymentMethod"`
      ),
      
      // Ventas por día (día civil en zona de negocio)
      prisma.$queryRawUnsafe(
        `SELECT 
          ${dateExpr} as date,
          COUNT(*) as count,
          COALESCE(SUM(s.total), 0) as total
        FROM "Sale" s
        ${whereClause}
        GROUP BY ${dateExpr}
        ORDER BY date DESC
        LIMIT 30`
      ),
    ]);
    
    const totalSales = parseInt(totalSalesResult[0]?.count || 0);
    const totalAmount = parseFloat(totalAmountResult[0]?.sum || 0);
    
    const salesByBranch = salesByBranchResult.map((item) => ({
      branch: item.branch || 'Sin sucursal',
      count: parseInt(item.count),
      total: parseFloat(item.total),
    }));
    
    const salesByPaymentMethod = salesByPaymentMethodResult.map((item) => ({
      paymentMethod: item.paymentMethod || 'Sin método',
      count: parseInt(item.count),
      total: parseFloat(item.total),
    }));
    
    const salesByDay = salesByDayResult.map((item) => ({
      date: item.date.toISOString().split('T')[0],
      count: parseInt(item.count),
      total: parseFloat(item.total),
    }));
    
    res.json({
      totalSales,
      totalAmount,
      averageSale: totalSales > 0 ? totalAmount / totalSales : 0,
      byBranch: salesByBranch,
      byPaymentMethod: salesByPaymentMethod,
      byDay: salesByDay,
    });
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas' });
  }
};

// Obtener estadísticas por sucursal
export const getBranchStats = async (req, res) => {
  try {
    const { branch } = req.params;
    const { startDate, endDate } = req.query;
    
    // Buscar sucursal por nombre
    const branchObj = await prisma.branch.findUnique({
      where: { name: branch }
    });

    if (!branchObj) {
      return res.status(404).json({ error: 'Sucursal no encontrada' });
    }

    // Seguridad: el usuario solo puede consultar sucursales que tiene permitido ver.
    const allowed = await resolveAllowedBranches(req.userId, req.userRole);
    if (!allowed.unrestricted && !allowed.branchIds.includes(branchObj.id)) {
      return res.status(403).json({ error: 'No tienes acceso a esta sucursal' });
    }

    const dateExpr = sqlUtcTimestampToBusinessDate('s');

    let whereConditions = [`s."branchId" = ${parseInt(branchObj.id, 10)}`];

    if (startDate) {
      if (!isValidYyyyMmDd(startDate)) {
        return res.status(400).json({ error: 'Formato de fecha inválido (startDate). Use YYYY-MM-DD.' });
      }
      whereConditions.push(`${dateExpr} >= '${startDate.trim()}'::date`);
    }

    if (endDate) {
      if (!isValidYyyyMmDd(endDate)) {
        return res.status(400).json({ error: 'Formato de fecha inválido (endDate). Use YYYY-MM-DD.' });
      }
      whereConditions.push(`${dateExpr} <= '${endDate.trim()}'::date`);
    }
    
    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
    
    // Usar consultas raw para aplicar filtros de zona horaria
    const [totalSalesResult, totalAmountResult, salesByPaymentMethodResult] = await Promise.all([
      // Total de ventas
      prisma.$queryRawUnsafe(
        `SELECT COUNT(*) as count FROM "Sale" s ${whereClause}`
      ),
      
      // Monto total
      prisma.$queryRawUnsafe(
        `SELECT COALESCE(SUM(s.total), 0) as sum FROM "Sale" s ${whereClause}`
      ),
      
      // Ventas por método de pago
      prisma.$queryRawUnsafe(
        `SELECT 
          s."paymentMethod",
          COUNT(*) as count,
          COALESCE(SUM(s.total), 0) as total
        FROM "Sale" s
        ${whereClause}
        GROUP BY s."paymentMethod"`
      ),
    ]);
    
    const totalSales = parseInt(totalSalesResult[0]?.count || 0);
    const totalAmount = parseFloat(totalAmountResult[0]?.sum || 0);
    
    const salesByPaymentMethod = salesByPaymentMethodResult.map((item) => ({
      paymentMethod: item.paymentMethod || 'Sin método',
      count: parseInt(item.count),
      total: parseFloat(item.total),
    }));
    
    res.json({
      branch,
      totalSales,
      totalAmount,
      averageSale: totalSales > 0 ? totalAmount / totalSales : 0,
      byPaymentMethod: salesByPaymentMethod,
    });
  } catch (error) {
    console.error('Error obteniendo estadísticas de sucursal:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas de sucursal' });
  }
};