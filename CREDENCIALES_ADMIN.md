# Credenciales de Administrador

## Usuario Admin por Defecto

**Email:** `admin@mariamstore.com`  
**Contraseña:** `admin123`  
**Rol:** ADMIN

## Creación Automática

El usuario admin se crea automáticamente cuando el servidor inicia, siempre y cuando:
1. La migración de Prisma haya sido ejecutada
2. La tabla `User` exista en la base de datos

## Creación Manual

Si el usuario admin no se creó automáticamente, puedes crearlo manualmente:

### Opción 1: Endpoint API
```bash
POST https://mariam-pos-web-api.onrender.com/api/auth/setup-admin
```

### Opción 2: Script de Seed
```bash
cd mariam-pos-web-api
npm run seed
```

### Opción 3: Migración + Seed
```bash
cd mariam-pos-web-api
npx prisma migrate dev
npm run seed
```

## Nota de Seguridad

⚠️ **IMPORTANTE:** Estas credenciales son solo para desarrollo. En producción:
- Cambia la contraseña del admin
- Remueve o protege el endpoint `/api/auth/setup-admin`
- Usa variables de entorno para credenciales sensibles

