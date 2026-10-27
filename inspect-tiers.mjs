import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PRODUCT_ID = 5562;

const main = async () => {
  const product = await prisma.product.findUnique({
    where: { id: PRODUCT_ID },
    select: { id: true, code: true, name: true, pricingMode: true },
  });

  const tiers = await prisma.productPriceTier.findMany({
    where: { productId: PRODUCT_ID },
    orderBy: { minQty: 'asc' },
  });

  const totalTiers = await prisma.productPriceTier.count();

  console.log('=== PRODUCTO 5562 ===');
  console.log(JSON.stringify(product, null, 2));
  console.log('\n=== TRAMOS DE ESTE PRODUCTO ===');
  console.log(JSON.stringify(tiers, null, 2));
  console.log(`\n=== TOTAL DE TRAMOS EN LA TABLA (todos los productos): ${totalTiers} ===`);
};

main()
  .catch((e) => {
    console.error('ERROR:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
