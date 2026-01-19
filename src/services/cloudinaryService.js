import { v2 as cloudinary } from 'cloudinary';
import crypto from 'crypto';

// Validar que las variables de entorno estén configuradas
const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

if (!cloudName || !apiKey || !apiSecret) {
  console.warn('⚠️  Cloudinary no está configurado. Variables de entorno faltantes:');
  if (!cloudName) console.warn('   - CLOUDINARY_CLOUD_NAME');
  if (!apiKey) console.warn('   - CLOUDINARY_API_KEY');
  if (!apiSecret) console.warn('   - CLOUDINARY_API_SECRET');
  console.warn('   Agrega estas variables a tu archivo .env');
}

// Configurar Cloudinary
if (cloudName && apiKey && apiSecret) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
  });
}

/**
 * Genera una signature para upload seguro desde el frontend
 * Esto permite que el frontend suba directamente a Cloudinary sin exponer el API secret
 */
export const generateUploadSignature = (params = {}) => {
  // Validar que las variables estén configuradas
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary no está configurado. Por favor, configura las variables de entorno CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET en tu archivo .env');
  }

  const timestamp = Math.round(new Date().getTime() / 1000);
  
  // Parámetros por defecto que se enviarán en el FormData
  const defaultParams = {
    folder: 'cash-express-receipts',
    resource_type: 'image',
    ...params,
  };

  // Parámetros que se incluyen en la firma (todos excepto api_key, file, signature)
  // IMPORTANTE: Solo incluir parámetros que NO sean arrays y que se envíen en el FormData
  const paramsToSign = {};
  
  // Solo agregar parámetros que tienen valores definidos
  if (defaultParams.folder) {
    paramsToSign.folder = defaultParams.folder;
  }
  if (defaultParams.resource_type) {
    paramsToSign.resource_type = defaultParams.resource_type;
  }
  paramsToSign.timestamp = timestamp;

  // Ordenar parámetros alfabéticamente y crear string para firmar
  const sortedKeys = Object.keys(paramsToSign).sort();
  const sortedParams = sortedKeys
    .map(key => `${key}=${String(paramsToSign[key])}`)
    .join('&');

  // Debug: mostrar string que se está firmando (solo en desarrollo)
  if (process.env.NODE_ENV !== 'production') {
    console.log('🔐 Cloudinary signature string:', sortedParams);
  }

  // Generar signature usando SHA1
  const signature = crypto
    .createHash('sha1')
    .update(sortedParams + apiSecret)
    .digest('hex');

  return {
    signature,
    timestamp,
    cloud_name: cloudName,
    api_key: apiKey,
    folder: defaultParams.folder,
    resource_type: defaultParams.resource_type,
  };
};

/**
 * Sube una imagen directamente a Cloudinary (para uso en backend)
 */
export const uploadImage = async (filePath, options = {}) => {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: 'cash-express-receipts',
      resource_type: 'image',
      ...options,
    });
    return result;
  } catch (error) {
    console.error('Error subiendo imagen a Cloudinary:', error);
    throw error;
  }
};

/**
 * Elimina una imagen de Cloudinary
 */
export const deleteImage = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  } catch (error) {
    console.error('Error eliminando imagen de Cloudinary:', error);
    throw error;
  }
};

