import express from "express";
import { 
  createSale, 
  getSales, 
  getSalesById, 
  createSalesWithDetails,
  getSalesStats,
  getBranchStats
} from "../controllers/salesController.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
const router = express.Router();

// 🔒 Lecturas del panel admin: requieren sesión admin. El filtrado por
// sucursal se aplica en el controlador según las sucursales del usuario.
// (Los POST quedan sin auth para no romper la creación de ventas del POS/app.)

// 🟢 Rutas de estadísticas (antes de las rutas con parámetros)
router.get("/stats", authenticate, requireAdmin, getSalesStats);
router.get("/stats/branch/:branch", authenticate, requireAdmin, getBranchStats);

// 🟢 Rutas generales
router.post("/bulk", createSalesWithDetails);
router.get("/", authenticate, requireAdmin, getSales);
router.get("/:id", authenticate, requireAdmin, getSalesById);
router.post("/", createSale);

export default router;