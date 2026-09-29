import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../index';
import { rateLimit } from '../rateLimit';
import { generateOtpCode, packOtpToken, sendSignupOtpEmail, verifyPackedOtp } from '../email';
import { authenticate, signProductToken } from '../middleware/auth';
import { ensureFreeSubscription, resolveEntitlements } from '../entitlements';

const router = Router();
const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, name: 'otp' });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, name: 'login' });

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

router.post('/signup', otpLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const name = String(req.body?.name || '').trim();
    const password = String(req.body?.password || '');
    const businessName = String(req.body?.businessName || '').trim();
    const category = String(req.body?.category || 'salon').trim() || 'salon';
    let slug = slugify(String(req.body?.slug || businessName));

    if (!email || !password || !businessName || !slug) {
      return res.status(400).json({ error: 'email, password, businessName, and slug are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    if (!SLUG_RE.test(slug)) {
      return res.status(400).json({ error: 'Slug must be lowercase letters, numbers, and hyphens' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser?.isVerified) {
      return res.status(409).json({ error: 'Email already registered. Please sign in.' });
    }

    const slugTaken = await prisma.business.findUnique({ where: { slug } });
    if (slugTaken) {
      return res.status(409).json({ error: 'That public URL is already taken. Choose another slug.' });
    }

    const code = generateOtpCode();
    const verificationToken = await packOtpToken(code);
    const passwordHash = await bcrypt.hash(password, 10);

    const meta = Buffer.from(
      JSON.stringify({ name, businessName, category, slug }),
      'utf8'
    ).toString('base64url');
    const packed = `${verificationToken}:${meta}`;

    if (existingUser) {
      await prisma.user.update({
        where: { id: existingUser.id },
        data: { passwordHash, name, verificationToken: packed, isVerified: false }
      });
    } else {
      await prisma.user.create({
        data: {
          email,
          name,
          passwordHash,
          verificationToken: packed,
          isVerified: false
        }
      });
    }

    await sendSignupOtpEmail(email, code);
    res.json({
      requiresVerification: true,
      email,
      message: 'We sent a verification code to your email.'
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/verify-signup', otpLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const code = String(req.body?.code || '').trim();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.verificationToken) {
      return res.status(400).json({ error: 'No pending verification' });
    }

    const parts = user.verificationToken.split(':');
    const packedOtp = parts.slice(0, 2).join(':');
    const metaB64 = parts.slice(2).join(':');
    const ok = await verifyPackedOtp(packedOtp, code);
    if (!ok) return res.status(400).json({ error: 'Invalid or expired code' });

    let meta: { name?: string; businessName?: string; category?: string; slug?: string } = {};
    try {
      meta = JSON.parse(Buffer.from(metaB64, 'base64url').toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Invalid signup state. Start again.' });
    }

    const slug = slugify(meta.slug || meta.businessName || '');
    if (!slug || !meta.businessName) {
      return res.status(400).json({ error: 'Invalid signup state. Start again.' });
    }

    const slugTaken = await prisma.business.findUnique({ where: { slug } });
    if (slugTaken) {
      return res.status(409).json({ error: 'Slug was taken. Sign up again with another URL.' });
    }

    const result = await prisma.$transaction(async tx => {
      const verified = await tx.user.update({
        where: { id: user.id },
        data: {
          isVerified: true,
          verificationToken: null,
          name: meta.name || user.name
        }
      });

      const business = await tx.business.create({
        data: {
          name: meta.businessName!,
          slug,
          category: meta.category || 'salon',
          ownerId: verified.id,
          plan: 'FREE',
          members: {
            create: {
              userId: verified.id,
              role: 'OWNER',
              status: 'ACTIVE'
            }
          }
        }
      });

      await tx.user.update({
        where: { id: verified.id },
        data: { activeBusinessId: business.id }
      });

      return business;
    });

    await ensureFreeSubscription(result.id);

    const token = signProductToken({ userId: user.id, businessId: result.id });
    const entitlements = await resolveEntitlements(result.id);

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
      business: {
        id: result.id,
        name: result.name,
        slug: result.slug,
        category: result.category,
        plan: result.plan
      },
      entitlements,
      publicPath: `/${result.slug}`
    });
  } catch (error) {
    console.error('Verify signup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || '');
    const user = await prisma.user.findUnique({
      where: { email },
      include: { memberships: { where: { status: 'ACTIVE' }, include: { business: true } } }
    });
    if (!user || !user.isVerified) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const businessId = user.activeBusinessId || user.memberships[0]?.businessId || null;
    const business = user.memberships.find(m => m.businessId === businessId)?.business || null;
    const token = signProductToken({ userId: user.id, businessId });

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
      business: business
        ? {
            id: business.id,
            name: business.name,
            slug: business.slug,
            category: business.category,
            plan: business.plan
          }
        : null,
      entitlements: businessId ? await resolveEntitlements(businessId) : null
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', authenticate, async (req, res) => {
  try {
    const businessId = req.actor!.businessId;
    if (!businessId) {
      return res.json({ user: req.actor, business: null, entitlements: null });
    }
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    res.json({
      user: {
        id: req.actor!.userId,
        email: req.actor!.email,
        name: req.actor!.name,
        role: req.actor!.role
      },
      business,
      entitlements: await resolveEntitlements(businessId)
    });
  } catch (error) {
    console.error('Me error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/slug-available', async (req, res) => {
  const slug = slugify(String(req.query.slug || ''));
  if (!slug || !SLUG_RE.test(slug)) {
    return res.json({ slug, available: false });
  }
  const taken = await prisma.business.findUnique({ where: { slug } });
  res.json({ slug, available: !taken });
});

export default router;
