import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../index';
import { rateLimit } from '../rateLimit';
import {
  authenticatePlatform,
  clientIp,
  signPlatformAccessToken,
  signPlatformMfaToken,
  writePlatformAudit
} from './auth';
import { buildOtpauthUri, generateBase32Secret, verifyTotp } from './totp';
import jwt from 'jsonwebtoken';

const router = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, name: 'platform-login' });

const platformSecret = () =>
  process.env.PLATFORM_JWT_SECRET ||
  (process.env.JWT_SECRET ? `${process.env.JWT_SECRET}:platform` : 'platform-dev-secret');

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', surface: 'platform', product: 'book' });
});

router.post('/auth/login', loginLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || '');
    const staff = await prisma.platformUser.findUnique({ where: { email } });
    if (!staff || staff.status !== 'ACTIVE') {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const ok = await bcrypt.compare(password, staff.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    await writePlatformAudit({
      staffId: staff.id,
      action: 'STAFF_LOGIN_PASSWORD_OK',
      ip: clientIp(req)
    });

    if (!staff.mfaEnabled || !staff.mfaSecret) {
      const setupToken = signPlatformMfaToken(staff.id);
      const secret = generateBase32Secret();
      await prisma.platformUser.update({
        where: { id: staff.id },
        data: { mfaSecret: secret }
      });
      return res.json({
        requiresMfaSetup: true,
        setupToken,
        secret,
        otpauthUrl: buildOtpauthUri(staff.email, secret)
      });
    }

    return res.json({
      requiresMfa: true,
      mfaToken: signPlatformMfaToken(staff.id)
    });
  } catch (error) {
    console.error('Platform login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/auth/mfa/setup/verify', loginLimiter, async (req, res) => {
  try {
    const setupToken = String(req.body?.setupToken || '');
    const code = String(req.body?.code || '');
    const decoded: any = jwt.verify(setupToken, platformSecret());
    if (decoded.typ !== 'platform_mfa') return res.status(401).json({ error: 'Invalid token' });
    const staff = await prisma.platformUser.findUnique({ where: { id: decoded.staffId } });
    if (!staff?.mfaSecret) return res.status(400).json({ error: 'No MFA secret' });
    if (!verifyTotp(staff.mfaSecret, code)) {
      return res.status(400).json({ error: 'Invalid MFA code' });
    }
    const updated = await prisma.platformUser.update({
      where: { id: staff.id },
      data: { mfaEnabled: true, lastLoginAt: new Date() }
    });
    const token = signPlatformAccessToken(updated);
    await writePlatformAudit({
      staffId: staff.id,
      action: 'STAFF_MFA_ENROLLED',
      ip: clientIp(req)
    });
    res.json({
      token,
      staff: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        mfaEnabled: true
      }
    });
  } catch (error) {
    console.error('MFA setup verify error:', error);
    res.status(401).json({ error: 'Invalid or expired setup token' });
  }
});

router.post('/auth/mfa/verify', loginLimiter, async (req, res) => {
  try {
    const mfaToken = String(req.body?.mfaToken || '');
    const code = String(req.body?.code || '');
    const decoded: any = jwt.verify(mfaToken, platformSecret());
    if (decoded.typ !== 'platform_mfa') return res.status(401).json({ error: 'Invalid token' });
    const staff = await prisma.platformUser.findUnique({ where: { id: decoded.staffId } });
    if (!staff?.mfaEnabled || !staff.mfaSecret) {
      return res.status(400).json({ error: 'MFA not enabled' });
    }
    if (!verifyTotp(staff.mfaSecret, code)) {
      return res.status(400).json({ error: 'Invalid MFA code' });
    }
    await prisma.platformUser.update({
      where: { id: staff.id },
      data: { lastLoginAt: new Date() }
    });
    const token = signPlatformAccessToken(staff);
    await writePlatformAudit({
      staffId: staff.id,
      action: 'STAFF_LOGIN_MFA_OK',
      ip: clientIp(req)
    });
    res.json({
      token,
      staff: {
        id: staff.id,
        email: staff.email,
        name: staff.name,
        role: staff.role,
        mfaEnabled: true
      }
    });
  } catch (error) {
    console.error('MFA verify error:', error);
    res.status(401).json({ error: 'Invalid or expired MFA token' });
  }
});

router.get('/auth/me', authenticatePlatform, async (req: any, res) => {
  res.json({ staff: req.platformStaff });
});

router.get('/businesses', authenticatePlatform, async (req, res) => {
  try {
    const q = String(req.query.query || '').trim();
    const businesses = await prisma.business.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { slug: { contains: q, mode: 'insensitive' } }
            ]
          }
        : undefined,
      take: 50,
      orderBy: { createdAt: 'desc' },
      include: {
        owner: { select: { email: true, name: true } },
        _count: { select: { members: true } }
      }
    });
    res.json({
      businesses: businesses.map(b => ({
        id: b.id,
        name: b.name,
        slug: b.slug,
        status: b.status,
        plan: b.plan,
        memberCount: b._count.members,
        owner: b.owner
      }))
    });
  } catch (error) {
    console.error('List businesses error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
