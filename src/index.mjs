import express from "express";
import cors from "cors"
import {config} from "dotenv";
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

config();

// Crear usuario admin por defecto si no existe (solo en desarrollo)
const prisma = new PrismaClient();
async function ensureAdminUser() {
  try {
    const adminEmail = 'admin@mariamstore.com';
    const existingAdmin = await prisma.user.findUnique({
      where: { email: adminEmail }
    });

    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await prisma.user.create({
        data: {
          email: adminEmail,
          name: 'Administrador',
          password: hashedPassword,
          role: 'ADMIN',
          isActive: true
        }
      });
      console.log('✅ Usuario admin creado automáticamente:');
      console.log('   Email: admin@mariamstore.com');
      console.log('   Contraseña: admin123');
    } else {
      console.log('ℹ️  Usuario admin ya existe');
    }
  } catch (error) {
    // Si la tabla no existe aún, solo mostrar advertencia
    if (error.code === 'P2021' || error.code === 'P2001') {
      console.log('⚠️  Tabla User no existe aún. Ejecuta la migración primero: npx prisma migrate dev');
    } else {
      console.error('⚠️  Error creando usuario admin:', error.message);
      console.log('💡 Puedes crear el admin manualmente con: POST /api/auth/setup-admin');
    }
  }
}
ensureAdminUser();

// Configuración del servidor
// -------------------
const app = express();
app.use(cors({
  origin: "*", // o mejor especificar tu dominio si quieres más seguridad
}));

// Aumentar límite de tamaño para imágenes en base64 (10MB)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rutas 
import salesRouter from "./routes/sales.js";
import productsRouter from "./routes/products.js";
import authRouter from "./routes/auth.js";
import cashExpressRouter from "./routes/cashExpress.js";
import ordersRouter from "./routes/orders.js";
import cloudinaryRouter from "./routes/cloudinary.js";
import notificationsRouter from "./routes/notifications.js";
import addressesRouter from "./routes/addresses.js";

app.use("/api/sales", salesRouter);
app.use("/api/products", productsRouter);
app.use("/api/auth", authRouter);
app.use("/api/cash-express", cashExpressRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/cloudinary", cloudinaryRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/addresses", addressesRouter);

// -------------------
// Iniciar servidor
// -------------------
const PORT = 4000; // puerto fijo
app.listen(PORT,() => {
  console.log(`Servidor corriendo en :${PORT}`);
});
