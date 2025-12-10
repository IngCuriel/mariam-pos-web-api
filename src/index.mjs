import express from "express";
import cors from "cors"
import {config} from "dotenv";

config();

// Configuración del servidor
// -------------------
const app = express();
app.use(cors({
  origin: "*", // o mejor especificar tu dominio si quieres más seguridad
}));

app.use(express.json());

// Rutas 
import salesRouter from "./routes/sales.js";
import productsRouter from "./routes/products.js";
 
app.use("/api/sales", salesRouter);
app.use("/api/products", productsRouter); 
// -------------------
// Iniciar servidor
// -------------------
const PORT = 4000; // puerto fijo
app.listen(PORT,() => {
  console.log(`Servidor corriendo en :${PORT}`);
});
