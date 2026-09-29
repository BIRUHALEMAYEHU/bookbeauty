import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import authRoutes from './routes/auth.routes';
import publicRoutes from './routes/public.routes';
import businessRoutes from './routes/business.routes';
import staffRoutes from './routes/staff.routes';
import platformRoutes from './platform/routes';

const __serverDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__serverDir, '../.env'), override: true });

export const prisma = new PrismaClient();

const app = express();
const port = Number(process.env.PORT) || 3001;

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const allowed = new Set<string>();
      const add = (v?: string) => {
        const x = (v || '').trim().replace(/\/$/, '');
        if (x) allowed.add(x);
      };
      add(process.env.FRONTEND_URL);
      add(process.env.PUBLIC_SITE_URL);
      add(process.env.PLATFORM_ADMIN_URL);
      for (const part of String(process.env.CORS_ORIGINS || '').split(',')) add(part);
      if (process.env.NODE_ENV !== 'production') {
        add('http://127.0.0.1:3000');
        add('http://localhost:3000');
        add('http://127.0.0.1:3010');
        add('http://localhost:3010');
        add('http://127.0.0.1:3020');
        add('http://localhost:3020');
      }
      if (allowed.size === 0 || allowed.has(origin)) return callback(null, true);
      return callback(null, false);
    }
  })
);

app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', product: 'book' });
});

app.use('/api/auth', authRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/business', businessRoutes);
app.use('/api/business/staff', staffRoutes);
app.use('/platform/api', platformRoutes);

app.listen(port, () => {
  console.log(`Book API listening on http://127.0.0.1:${port}`);
});
