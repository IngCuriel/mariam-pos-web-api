# Configuración de Cloudinary

## ⚠️ IMPORTANTE: Configuración Requerida

Para que Cloudinary funcione, **DEBES** configurar las variables de entorno.

## Credenciales necesarias

Para usar Cloudinary, necesitas agregar las siguientes variables de entorno en tu archivo `.env`:

```env
CLOUDINARY_CLOUD_NAME=tu_cloud_name
CLOUDINARY_API_KEY=tu_api_key
CLOUDINARY_API_SECRET=tu_api_secret
```

## Cómo obtener tus credenciales

1. Inicia sesión en tu cuenta de Cloudinary: https://cloudinary.com/users/login
2. Ve al Dashboard: https://cloudinary.com/console
3. En la sección "Account Details" encontrarás:
   - **Cloud Name**: Tu nombre de nube (ej: `dabc123`)
   - **API Key**: Tu clave de API
   - **API Secret**: Tu secreto de API (haz clic en "Reveal" para verlo)

## Configuración del archivo .env

1. **Crea o edita** el archivo `.env` en la raíz del proyecto `mariam-pos-web-api/`
2. Agrega las siguientes líneas con tus credenciales **reales**:

```env
CLOUDINARY_CLOUD_NAME=tu_cloud_name_aqui
CLOUDINARY_API_KEY=tu_api_key_aqui
CLOUDINARY_API_SECRET=tu_api_secret_aqui
```

**Ejemplo:**
```env
CLOUDINARY_CLOUD_NAME=dabc123
CLOUDINARY_API_KEY=123456789012345
CLOUDINARY_API_SECRET=abcdefghijklmnopqrstuvwxyz123456
```

## Verificación

1. **Reinicia el servidor** después de agregar las variables
2. Verifica que no haya warnings al iniciar sobre Cloudinary
3. Prueba el endpoint: `POST /api/cloudinary/signature` (debe retornar un objeto con signature, timestamp, etc.)

## Solución de problemas

### Error: "cloud_name is disabled"
- **Causa**: Las variables de entorno no están configuradas o están vacías
- **Solución**: 
  1. Verifica que el archivo `.env` existe en `mariam-pos-web-api/`
  2. Verifica que las variables tienen valores (no están vacías)
  3. Reinicia el servidor después de agregar/modificar el `.env`

### Error: "Cloudinary no está configurado"
- **Causa**: Faltan variables de entorno
- **Solución**: Agrega todas las variables requeridas al `.env`

## Notas de seguridad

- **NUNCA** commitees el archivo `.env` al repositorio
- El archivo `.env` ya está en `.gitignore` por defecto
- El API Secret solo se usa en el backend para generar signatures seguras
- El frontend nunca tiene acceso directo al API Secret

