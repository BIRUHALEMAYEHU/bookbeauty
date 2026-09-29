import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../index';

const secret = () => process.env.JWT_SECRET || 'dev-product-secret-change-me';

export type Actor = {
  userId: string;
  email: string;
  name: string | null;
  businessId: string | null;
  role: string | null;
};

declare global {
  namespace Express {
    interface Request {
      actor?: Actor;
    }
  }
}

export function signProductToken(payload: { userId: string; businessId: string | null }) {
  return jwt.sign({ typ: 'product', ...payload }, secret(), { expiresIn: '7d' });
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const decoded: any = jwt.verify(token, secret());
    if (decoded.typ !== 'product') return res.status(401).json({ error: 'Unauthorized' });

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        memberships: {
          where: { status: 'ACTIVE' },
          take: 20
        }
      }
    });
    if (!user || !user.isVerified) return res.status(401).json({ error: 'Unauthorized' });

    let businessId: string | null = decoded.businessId || user.activeBusinessId;
    let role: string | null = null;
    if (businessId) {
      const m = user.memberships.find(x => x.businessId === businessId);
      if (!m) {
        businessId = user.memberships[0]?.businessId || null;
      }
      role = user.memberships.find(x => x.businessId === businessId)?.role || null;
    }

    req.actor = {
      userId: user.id,
      email: user.email,
      name: user.name,
      businessId,
      role
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}
