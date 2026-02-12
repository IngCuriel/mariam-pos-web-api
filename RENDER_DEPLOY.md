# Deploy en Render

## Comando de inicio correcto

**No uses** `prisma db push` en producción: con cambios en enums (como `OrderStatus`) puede provocar pérdida de datos.

En **Render** configura el **Start Command** así:

```bash
npx prisma migrate deploy && npm run start
```

O, si prefieres usar el script:

```bash
npm run migrate:deploy && npm run start
```

Así se aplican las migraciones (incluida la que mapea los estados antiguos de pedidos a los nuevos) y luego arranca la API.

## Build Command

Puedes dejar el build por defecto o usar:

```bash
npm install
```

`postinstall` ya ejecuta `prisma generate` para generar el cliente de Prisma.
