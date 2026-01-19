import { v2 as cloudinary } from 'cloudinary';
import crypto from 'crypto';

// Configurar Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Genera una signature para upload seguro desde el frontend
 * Esto permite que el frontend suba directamente a Cloudinary sin exponer el API secret
 */
export const generateUploadSignature = (params = {}) => {
  const timestamp = Math.round(new Date().getTime() / 1000);
  
  // Parámetros por defecto
  const defaultParams = {
    folder: 'cash-express-receipts',
    resource_type: 'image',
    allowed_formats: ['jpg', 'jpeg', 'png', 'pdf'],
    max_file_size: 5242880, // 5MB en bytes
    ...params,
  };

  // Crear string para firmar
  const paramsToSign = {
    ...defaultParams,
    timestamp,
  };

  // Ordenar parámetros alfabéticamente
  const sortedParams = Object.keys(paramsToSign)
    .sort()
    .map(key => `${key}=${paramsToSign[key]}`)
    .join('&');

  // Generar signature
  const signature = crypto
    .createHash('sha1')
    .update(sortedParams + process.env.CLOUDINARY_API_SECRET)
    .digest('hex');

  return {
    signature,
    timestamp,
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    folder: defaultParams.folder,
    resource_type: defaultParams.resource_type,
    allowed_formats: defaultParams.allowed_formats,
    max_file_size: defaultParams.max_file_size,
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

