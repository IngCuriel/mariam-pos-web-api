# Configuración de Cloudinary

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

1. Crea un archivo `.env` en la raíz del proyecto `mariam-pos-web-api/`
2. Agrega las siguientes líneas con tus credenciales:

```env
CLOUDINARY_CLOUD_NAME=tu_cloud_name_aqui
CLOUDINARY_API_KEY=tu_api_key_aqui
CLOUDINARY_API_SECRET=tu_api_secret_aqui
```

## Verificación

Una vez configurado, reinicia el servidor y verifica que no haya errores al iniciar.

El endpoint `/api/cloudinary/signature` debería funcionar correctamente.

## Notas de seguridad

- **NUNCA** commitees el archivo `.env` al repositorio
- El archivo `.env` ya está en `.gitignore` por defecto
- El API Secret solo se usa en el backend para generar signatures seguras
- El frontend nunca tiene acceso directo al API Secret

