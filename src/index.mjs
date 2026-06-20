import express from "express";
import cors from "cors"
import {config} from "dotenv";
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

config();

// Crear usuarios admin por defecto si no existen (arranque / deploy)
const prisma = new PrismaClient();

const DEFAULT_ADMIN_PASSWORD = 'admin123';
const DEFAULT_ADMIN_USERS = [
  { email: 'admin@mariamstore.com', name: 'Administrador' },
  { email: 'superadmin@mariamstore.com', name: 'Super Administrador' },
];

async function ensureDefaultAdminUser({ email, name, passwordHash }) {
  const existing = await prisma.user.findUnique({
    where: { email },
  });

  if (existing) {
    console.log(`ℹ️  Usuario admin ya existe: ${email}`);
    return;
  }

  await prisma.user.create({
    data: {
      email,
      name,
      password: passwordHash,
      role: 'ADMIN',
      isActive: true,
    },
  });

  console.log(`✅ Usuario admin creado: ${email}`);
}

async function ensureAdminUsers() {
  try {
    const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);

    for (const adminUser of DEFAULT_ADMIN_USERS) {
      await ensureDefaultAdminUser({
        email: adminUser.email,
        name: adminUser.name,
        passwordHash,
      });
    }
  } catch (error) {
    // Si la tabla no existe aún, solo mostrar advertencia
    if (error.code === 'P2021' || error.code === 'P2001') {
      console.log('⚠️  Tabla User no existe aún. Ejecuta la migración primero: npx prisma migrate dev');
    } else {
      console.error('⚠️  Error creando usuarios admin:', error.message);
      console.log('💡 Puedes crear el admin manualmente con: POST /api/auth/setup-admin');
    }
  }
}
ensureAdminUsers();

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
