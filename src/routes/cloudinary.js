import express from 'express';
import { generateUploadSignature } from '../services/cloudinaryService.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Todas las rutas requieren autenticación
router.use(authenticate);

// Generar signature para upload seguro desde el frontend
router.post('/signature', (req, res) => {
  try {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📥 PETICIÓN RECIBIDA: Generar firma de Cloudinary');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📋 Headers recibidos:', JSON.stringify(req.headers, null, 2));
    console.log('📋 Body recibido:', JSON.stringify(req.body, null, 2));
    console.log('📋 Query params:', JSON.stringify(req.query, null, 2));
    
    const signature = generateUploadSignature();
    
    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ FIRMA GENERADA EXITOSAMENTE');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📤 DATOS QUE SE ENVIARÁN AL FRONTEND:');
    console.log(JSON.stringify({
      signature: signature.signature.substring(0, 20) + '...' + signature.signature.substring(signature.signature.length - 10),
      timestamp: signature.timestamp,
      cloud_name: signature.cloud_name,
      api_key: signature.api_key,
      folder: signature.folder,
      resource_type: signature.resource_type,
    }, null, 2));
    console.log('═══════════════════════════════════════════════════════════\n');
    
    res.json(signature);
  } catch (error) {
    console.error('═══════════════════════════════════════════════════════════');
    console.error('❌ ERROR GENERANDO SIGNATURE:');
    console.error('═══════════════════════════════════════════════════════════');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('═══════════════════════════════════════════════════════════\n');
    res.status(500).json({
      error: error.message || 'Error al generar signature para upload. Verifica que Cloudinary esté configurado correctamente.'
    });
  }
});

export default router;

