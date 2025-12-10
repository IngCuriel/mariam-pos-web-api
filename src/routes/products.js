import express from "express";
import { 
  createProductsBulk,
  createCategoriesBulk,
  getProductsByBranch,
  getCategoriesByBranch
} from "../controllers/productsController.js";

const router = express.Router();

// Rutas de productos
router.post("/bulk", createProductsBulk);
router.get("/branch/:branch", getProductsByBranch);

// Rutas de categorías
router.post("/categories/bulk", createCategoriesBulk);
router.get("/categories/branch/:branch", getCategoriesByBranch);

export default router;

