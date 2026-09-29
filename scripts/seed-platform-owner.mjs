import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env'), override: true });

const prisma = new PrismaClient();

const email = String(process.env.PLATFORM_OWNER_EMAIL || '')
  .trim()
  .toLowerCase();
const password = String(process.env.PLATFORM_OWNER_PASSWORD || '');
const name = process.env.PLATFORM_OWNER_NAME || 'Platform Owner';

if (!email || password.length < 12) {
  console.error('Set PLATFORM_OWNER_EMAIL and PLATFORM_OWNER_PASSWORD (min 12 chars).');
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
const existing = await prisma.platformUser.findUnique({ where: { email } });

if (existing) {
  await prisma.platformUser.update({
    where: { email },
    data: {
      passwordHash: hash,
      name,
      role: 'OWNER',
      status: 'ACTIVE',
      mfaEnabled: false,
      mfaSecret: null
    }
  });
  console.log(`Updated platform OWNER ${email}. Re-enroll MFA on next login.`);
} else {
  const created = await prisma.platformUser.create({
    data: {
      email,
      name,
      passwordHash: hash,
      role: 'OWNER',
      status: 'ACTIVE'
    }
  });
  console.log(`Created platform OWNER ${email} (id=${created.id}). Enroll MFA on first login.`);
}

await prisma.$disconnect();
