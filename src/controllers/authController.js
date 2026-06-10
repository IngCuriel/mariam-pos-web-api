import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { sendPasswordResetEmail } from '../services/emailService.js';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const PASSWORD_RESET_EXPIRY_MS = 60 * 60 * 1000;
const GENERIC_FORGOT_PASSWORD_MESSAGE =
  'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña en los próximos minutos.';

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getStoreClientBaseUrl() {
  const url = process.env.STORE_CLIENT_URL?.trim();
  if (url) return url.replace(/\/$/, '');
  return 'http://localhost:5173';
}

function isValidEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

// Generar token JWT
const generateToken = (userId, role) => {
  return jwt.sign(
    { userId, role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// Registrar nuevo usuario
export const register = async (req, res) => {
  try {
    const { email, password, name, phone, registrationSource } = req.body;

    // Validaciones
    if (!email || !password || !name) {
      return res.status(400).json({
        error: 'Email, contraseña y nombre son requeridos'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: 'La contraseña debe tener al menos 6 caracteres'
      });
    }

    // Validar registrationSource si se proporciona
    if (registrationSource && !['WEB', 'APP'].includes(registrationSource)) {
      return res.status(400).json({
        error: 'registrationSource debe ser WEB o APP'
      });
    }

    // Verificar si el usuario ya existe
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (existingUser) {
      return res.status(400).json({
        error: 'El email ya está registrado'
      });
    }

    // Hash de la contraseña
    const hashedPassword = await bcrypt.hash(password, 10);

    // Crear usuario (por defecto es CLIENTE)
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        name,
        phone: phone || null,
        password: hashedPassword,
        role: 'CLIENTE',
        registrationSource: registrationSource || null // WEB o APP, o null si no se especifica
      },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        registrationSource: true,
        createdAt: true
      }
    });

    // Generar token
    const token = generateToken(user.id, user.role);

    res.status(201).json({
      message: 'Usuario registrado exitosamente',
      user,
      token
    });
  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({
      error: 'Error al registrar usuario'
    });
  }
};

// Iniciar sesión
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email y contraseña son requeridos'
      });
    }

    // Buscar usuario
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() }
    });

    if (!user) {
      return res.status(401).json({
        error: 'Credenciales inválidas'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        error: 'Tu cuenta está desactivada'
      });
    }

    // Verificar contraseña
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({
        error: 'Credenciales inválidas'
      });
    }

    // Generar token
    const token = generateToken(user.id, user.role);

    res.json({
      message: 'Inicio de sesión exitoso',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        registrationSource: user.registrationSource
      },
      token
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({
      error: 'Error al iniciar sesión'
    });
  }
};

// Verificar token y obtener usuario actual
export const verifyToken = async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        error: 'Token no proporcionado'
      });
    }

    // Verificar token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Obtener usuario actualizado
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        registrationSource: true,
        isActive: true,
        createdAt: true
      }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        error: 'Usuario no válido'
      });
    }

    res.json({
      user,
      valid: true
    });
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token inválido o expirado'
      });
    }

    console.error('Error verificando token:', error);
    res.status(500).json({
      error: 'Error al verificar token'
    });
  }
};

// Obtener perfil del usuario actual
export const getProfile = async (req, res) => {
  try {
    const userId = req.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        registrationSource: true,
        createdAt: true
      }
    });

    if (!user) {
      return res.status(404).json({
        error: 'Usuario no encontrado'
      });
    }

    res.json(user);
  } catch (error) {
    console.error('Error obteniendo perfil:', error);
    res.status(500).json({
      error: 'Error al obtener perfil'
    });
  }
};

const MAX_NAME_LENGTH = 120;

/** Actualizar perfil del cliente (solo nombre permitido desde la tienda web). */
export const updateProfile = async (req, res) => {
  try {
    const userId = req.userId;
    const { name } = req.body;

    if (name == null || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        error: 'El nombre es requerido',
      });
    }

    const trimmed = name.trim();
    if (trimmed.length > MAX_NAME_LENGTH) {
      return res.status(400).json({
        error: `El nombre no puede superar ${MAX_NAME_LENGTH} caracteres`,
      });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { name: trimmed },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        registrationSource: true,
        createdAt: true,
      },
    });

    res.json(user);
  } catch (error) {
    console.error('Error actualizando perfil:', error);
    res.status(500).json({
      error: 'Error al actualizar perfil',
    });
  }
};

/** Solicitar enlace de recuperación de contraseña (respuesta genérica por seguridad). */
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'Ingresa un correo electrónico válido' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true, name: true, isActive: true },
    });

    if (user?.isActive) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashResetToken(rawToken);
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordResetToken: tokenHash,
          passwordResetExpires: expiresAt,
        },
      });

      const resetUrl = `${getStoreClientBaseUrl()}/reset-password?token=${rawToken}`;
      try {
        await sendPasswordResetEmail({
          to: user.email,
          name: user.name,
          resetUrl,
        });
      } catch (emailError) {
        console.error('Error enviando correo de recuperación:', emailError);
      }
    }

    res.json({ message: GENERIC_FORGOT_PASSWORD_MESSAGE });
  } catch (error) {
    console.error('Error en forgotPassword:', error);
    res.status(500).json({ error: 'No se pudo procesar la solicitud. Intenta más tarde.' });
  }
};

/** Validar token de recuperación antes de mostrar el formulario. */
export const validateResetToken = async (req, res) => {
  try {
    const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    if (!token) {
      return res.status(400).json({ valid: false, error: 'Token requerido' });
    }

    const user = await findUserByResetToken(token);
    if (!user) {
      return res.status(400).json({ valid: false, error: 'El enlace no es válido o ya expiró' });
    }

    res.json({ valid: true });
  } catch (error) {
    console.error('Error validando token de recuperación:', error);
    res.status(500).json({ valid: false, error: 'Error al validar el enlace' });
  }
};

async function findUserByResetToken(rawToken) {
  const tokenHash = hashResetToken(rawToken);
  const now = new Date();
  return prisma.user.findFirst({
    where: {
      passwordResetToken: tokenHash,
      passwordResetExpires: { gt: now },
      isActive: true,
    },
    select: { id: true },
  });
}

/** Restablecer contraseña con token del correo. */
export const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    const rawToken = typeof token === 'string' ? token.trim() : '';

    if (!rawToken) {
      return res.status(400).json({ error: 'Token inválido' });
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const user = await findUserByResetToken(rawToken);
    if (!user) {
      return res.status(400).json({ error: 'El enlace no es válido o ya expiró. Solicita uno nuevo.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });

    res.json({ message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
  } catch (error) {
    console.error('Error en resetPassword:', error);
    res.status(500).json({ error: 'No se pudo restablecer la contraseña' });
  }
};

