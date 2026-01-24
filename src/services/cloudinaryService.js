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

  // Parámetros que se incluyen en la firma
  // IMPORTANTE: Para uploads directos a Cloudinary, TODOS los parámetros que se envíen
  // en el FormData (excepto 'file') DEBEN estar en la firma
  // Sin embargo, cuando usamos el endpoint /image/upload, Cloudinary ignora resource_type=image
  // Por lo tanto, NO lo incluimos en la firma ni en el FormData si es 'image'
  
  // CRÍTICO: api_key DEBE estar en la firma porque se envía en el FormData
  const paramsToSign = {
    api_key: apiKey,  // SIEMPRE incluir api_key porque se envía en el FormData
    folder: defaultParams.folder,
    timestamp: timestamp,
  };
  
  // Solo agregar resource_type si NO es 'image' (el valor por defecto)
  // Esto evita problemas de firma cuando Cloudinary ignora el parámetro
  if (defaultParams.resource_type && defaultParams.resource_type !== 'image') {
    paramsToSign.resource_type = defaultParams.resource_type;
  }

  // Verificar que api_key esté presente (crítico para la firma)
  if (!paramsToSign.api_key) {
    throw new Error('api_key es requerido para generar la firma de Cloudinary');
  }

  // Ordenar parámetros alfabéticamente (requerido por Cloudinary)
  const sortedKeys = Object.keys(paramsToSign).sort();
  const sortedParams = sortedKeys
    .map(key => `${key}=${String(paramsToSign[key])}`)
    .join('&');

  // LOGS DETALLADOS PARA DEBUGGING
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔐 GENERANDO FIRMA DE CLOUDINARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📋 Variables de entorno:');
  console.log('   - CLOUDINARY_CLOUD_NAME:', cloudName ? `${cloudName.substring(0, 5)}...` : '❌ NO CONFIGURADO');
  console.log('   - CLOUDINARY_API_KEY:', apiKey ? `${apiKey.substring(0, 5)}...${apiKey.substring(apiKey.length - 5)}` : '❌ NO CONFIGURADO');
  console.log('   - CLOUDINARY_API_SECRET:', apiSecret ? `${apiSecret.substring(0, 5)}...${apiSecret.substring(apiSecret.length - 5)}` : '❌ NO CONFIGURADO');
  console.log('');
  console.log('📋 Parámetros por defecto:');
  console.log(JSON.stringify(defaultParams, null, 2));
  console.log('');
  console.log('📋 Parámetros que se incluirán en la firma (paramsToSign):');
  console.log(JSON.stringify(paramsToSign, null, 2));
  console.log('');
  console.log('📋 Parámetros ordenados alfabéticamente:');
  console.log('   Orden:', sortedKeys.join(', '));
  console.log('');
  console.log('🔐 STRING QUE SE FIRMA (sortedParams):');
  console.log('   "' + sortedParams + '"');
  console.log('');
  console.log('🔐 Verificación api_key en firma:', sortedParams.includes('api_key=') ? '✅ SÍ' : '❌ NO');
  console.log('');
  console.log('🔐 String completo a firmar (con secret):');
  console.log('   "' + sortedParams + apiSecret + '"');
  console.log('   (Longitud del secret: ' + apiSecret.length + ' caracteres)');
  console.log('');

  // Generar signature usando SHA1
  // IMPORTANTE: El string debe ser: sortedParams + apiSecret (sin & entre ellos)
  const signature = crypto
    .createHash('sha1')
    .update(sortedParams + apiSecret)
    .digest('hex');

  console.log('🔐 FIRMA GENERADA (SHA1):');
  console.log('   ' + signature);
  console.log('   (Longitud: ' + signature.length + ' caracteres)');
  console.log('');

  // Retornar datos de firma
  // Nota: resource_type se incluye en la respuesta para el frontend,
  // pero NO se incluye en la firma si es 'image' (valor por defecto)
  const response = {
    signature,
    timestamp,
    cloud_name: cloudName,
    api_key: apiKey,
    folder: defaultParams.folder,
    resource_type: defaultParams.resource_type,
  };
  
  console.log('📤 RESPUESTA QUE SE ENVIARÁ AL FRONTEND:');
  console.log(JSON.stringify({
    signature: signature.substring(0, 20) + '...' + signature.substring(signature.length - 10),
    timestamp: response.timestamp,
    cloud_name: response.cloud_name,
    api_key: response.api_key,
    folder: response.folder,
    resource_type: response.resource_type,
  }, null, 2));
  console.log('');
  console.log('📋 PARÁMETROS QUE EL FRONTEND DEBE ENVIAR A CLOUDINARY:');
  console.log('   1. api_key: ' + apiKey);
  console.log('   2. folder: ' + defaultParams.folder);
  console.log('   3. signature: ' + signature.substring(0, 20) + '...');
  console.log('   4. timestamp: ' + timestamp);
  if (defaultParams.resource_type && defaultParams.resource_type !== 'image') {
    console.log('   5. resource_type: ' + defaultParams.resource_type);
  }
  console.log('   6. file: [archivo de imagen]');
  console.log('');
  console.log('🔍 STRING QUE CLOUDINARY ESPERA EN LA FIRMA:');
  console.log('   "' + sortedParams + '"');
  console.log('   (Debe coincidir EXACTAMENTE con los parámetros enviados en el FormData)');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  return response;
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

