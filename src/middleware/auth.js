import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware de autenticación
export const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        error: 'Token de autenticación requerido'
      });
    }

    // Verificar token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Verificar que el usuario existe y está activo
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true
      }
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        error: 'Usuario no válido o inactivo'
      });
    }

    // Agregar información del usuario al request
    req.userId = user.id;
    req.userRole = user.role;
    req.user = user;

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Token inválido'
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expirado'
      });
    }

    console.error('Error en autenticación:', error);
    res.status(500).json({
      error: 'Error al autenticar'
    });
  }
};

// Roles con privilegios administrativos. SUPER_ADMIN tiene los mismos permisos
// que ADMIN (y más). Usar este helper en vez de comparar contra 'ADMIN' directo.
export const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'];

/** true si el rol tiene privilegios de administrador (ADMIN o SUPER_ADMIN). */
export const isAdminRole = (role) => ADMIN_ROLES.includes(role);

// Middleware de autorización (admin y super admin)
export const requireAdmin = (req, res, next) => {
  if (!isAdminRole(req.userRole)) {
    return res.status(403).json({
      error: 'Acceso denegado. Se requiere rol de administrador'
    });
  }
  next();
};

// Middleware de autorización (solo super admin)
export const requireSuperAdmin = (req, res, next) => {
  if (req.userRole !== 'SUPER_ADMIN') {
    return res.status(403).json({
      error: 'Acceso denegado. Se requiere rol de super administrador'
    });
  }
  next();
};

// Middleware opcional (no falla si no hay token, pero agrega user si existe)
export const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (token) {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true
        }
      });

      if (user && user.isActive) {
        req.userId = user.id;
        req.userRole = user.role;
        req.user = user;
      }
    }

    next();
  } catch (error) {
    // Si hay error, simplemente continuar sin autenticación
    next();
  }
};

