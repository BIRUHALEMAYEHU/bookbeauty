import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../index';

const secret = () =>
  process.env.PLATFORM_JWT_SECRET ||
  (process.env.JWT_SECRET ? `${process.env.JWT_SECRET}:platform` : 'platform-dev-secret');

const ACCESS_TTL = process.env.PLATFORM_JWT_ACCESS_TTL || '7d';

export type PlatformStaff = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  mfaEnabled: boolean;
};

export function signPlatformAccessToken(staff: { id: string; role: string }) {
  return jwt.sign({ typ: 'platform_access', staffId: staff.id, role: staff.role }, secret(), {
    expiresIn: ACCESS_TTL as any
  });
}

export function signPlatformMfaToken(staffId: string) {
  return jwt.sign({ typ: 'platform_mfa', staffId }, secret(), { expiresIn: '10m' });
}

export async function writePlatformAudit(opts: {
  staffId?: string | null;
  action: string;
  businessId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}) {
  await prisma.platformAuditLog.create({
    data: {
      staffId: opts.staffId || null,
      action: opts.action,
      businessId: opts.businessId || null,
      targetType: opts.targetType || null,
      targetId: opts.targetId || null,
      beforeJson: opts.before != null ? JSON.stringify(opts.before) : null,
      afterJson: opts.after != null ? JSON.stringify(opts.after) : null,
      ip: opts.ip || null
    }
  });
}

export const clientIp = (req: any) =>
  (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null;

export async function authenticatePlatform(req: any, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const decoded: any = jwt.verify(token, secret());
    if (decoded.typ !== 'platform_access') return res.status(401).json({ error: 'Unauthorized' });
    const staff = await prisma.platformUser.findUnique({ where: { id: decoded.staffId } });
    if (!staff || staff.status !== 'ACTIVE') return res.status(401).json({ error: 'Unauthorized' });
    req.platformStaff = {
      id: staff.id,
      email: staff.email,
      name: staff.name,
      role: staff.role,
      mfaEnabled: staff.mfaEnabled
    } as PlatformStaff;
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

export function requirePlatformRole(...roles: string[]) {
  return (req: any, res: Response, next: NextFunction) => {
    const role = req.platformStaff?.role;
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ error: 'Insufficient platform permissions' });
    }
    next();
  };
}
