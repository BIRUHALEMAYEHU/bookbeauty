import type { Request, Response, NextFunction } from 'express';

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(opts: { windowMs: number; max: number; name: string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
    const key = `${opts.name}:${ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now > b.resetAt) {
      b = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    if (b.count > opts.max) {
      return res.status(429).json({ error: 'Too many requests. Try again later.' });
    }
    next();
  };
}
