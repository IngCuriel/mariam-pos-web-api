import express from 'express';
import { generateUploadSignature } from '../services/cloudinaryService.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Todas las rutas requieren autenticación
router.use(authenticate);

// Generar signature para upload seguro desde el frontend
router.post('/signature', (req, res) => {
  try {
    const signature = generateUploadSignature();
    res.json(signature);
  } catch (error) {
    console.error('Error generando signature:', error);
    res.status(500).json({
      error: error.message || 'Error al generar signature para upload. Verifica que Cloudinary esté configurado correctamente.'
    });
  }
});

export default router;

