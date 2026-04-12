/**
 * First-run admin bootstrap script.
 *
 * Usage (from the apps/api directory):
 *
 *   npx ts-node scripts/create-admin.ts <email> <password>
 *
 * Example:
 *   npx ts-node scripts/create-admin.ts admin@example.com MySecurePassword123
 *
 * Rules:
 *   - Password must be at least 8 characters.
 *   - If an admin with that email already exists, the script exits without changes.
 *   - Script exits with code 1 on any error so CI/bootstrap pipelines can detect failure.
 *
 * Railway / production setup:
 *   Run this once after first deploy via Railway's "Run command" or the deploy hook.
 *   After the first admin exists, subsequent admins can be created through the admin UI.
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 12;

async function main() {
  const [email, password] = process.argv.slice(2);

  if (!email || !password) {
    console.error('Usage: npx ts-node scripts/create-admin.ts <email> <password>');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('Error: Password must be at least 8 characters.');
    process.exit(1);
  }

  const prisma = new PrismaClient();

  try {
    const existing = await prisma.adminUser.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (existing) {
      console.log(`Admin with email ${email} already exists — no changes made.`);
      return;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const admin = await prisma.adminUser.create({
      data: {
        email: email.toLowerCase().trim(),
        fullName: 'Admin',
        passwordHash,
        isActive: true,
      },
    });

    console.log(`Admin created successfully.`);
    console.log(`  ID:    ${admin.id}`);
    console.log(`  Email: ${admin.email}`);
    console.log(`\nYou can now log in at /login with email + password.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Failed to create admin:', err);
  process.exit(1);
});
