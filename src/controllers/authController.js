import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

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
    const { email, password, name, phone } = req.body;

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
        role: 'CLIENTE'
      },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
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
        role: user.role
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

