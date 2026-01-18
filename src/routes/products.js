import express from "express";
import { 
  createProductsBulk,
  createCategoriesBulk,
  getProductsByBranch,
  getCategoriesByBranch,
  getAllProducts,
  getAllCategories,
  getAllBranches,
  getProductById
} from "../controllers/productsController.js";

const router = express.Router();

// Rutas de productos
router.post("/bulk", createProductsBulk);
router.get("/all", getAllProducts); // Obtener todos los productos (con filtros opcionales)
router.get("/branches", getAllBranches); // Obtener todas las sucursales únicas (DEBE ir antes de /:id)
router.get("/branch/:branch", getProductsByBranch); // Debe ir antes de /:id para evitar conflictos
router.get("/:id", getProductById); // Obtener un producto por ID

// Rutas de categorías
router.post("/categories/bulk", createCategoriesBulk);
router.get("/categories/all", getAllCategories); // Obtener todas las categorías
router.get("/categories/branch/:branch", getCategoriesByBranch);

export default router;

