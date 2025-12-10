import express from "express";
import { 
  createProductsBulk,
  createCategoriesBulk,
  getProductsByBranch,
  getCategoriesByBranch,
  getAllProducts,
  getAllCategories,
  getAllBranches
} from "../controllers/productsController.js";

const router = express.Router();

// Rutas de productos
router.post("/bulk", createProductsBulk);
router.get("/all", getAllProducts); // Obtener todos los productos (con filtros opcionales)
router.get("/branch/:branch", getProductsByBranch);

// Rutas de categorías
router.post("/categories/bulk", createCategoriesBulk);
router.get("/categories/all", getAllCategories); // Obtener todas las categorías
router.get("/categories/branch/:branch", getCategoriesByBranch);

// Rutas de sucursales
router.get("/branches", getAllBranches); // Obtener todas las sucursales únicas

export default router;

