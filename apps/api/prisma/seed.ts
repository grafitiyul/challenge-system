import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const typeCount = await prisma.challengeType.count();

  if (typeCount === 0) {
    await prisma.challengeType.createMany({
      data: [
        { name: 'ירידה במשקל', sortOrder: 1, isActive: true },
        { name: 'כסף',         sortOrder: 2, isActive: true },
        { name: 'אנגלית',      sortOrder: 3, isActive: true },
        { name: 'כושר',        sortOrder: 4, isActive: true },
      ],
    });
    console.log('Seeded 4 challenge types');
  } else {
    console.log(`Skipping challenge types — ${typeCount} already exist`);
  }

  const genderCount = await prisma.gender.count();

  if (genderCount === 0) {
    await prisma.gender.createMany({
      data: [
        { name: 'אישה', sortOrder: 1, isActive: true },
        { name: 'גבר',  sortOrder: 2, isActive: true },
        { name: 'אחר',  sortOrder: 3, isActive: true },
      ],
    });
    console.log('Seeded 3 genders');
  } else {
    console.log(`Skipping genders — ${genderCount} already exist`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
