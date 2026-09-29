import { Router } from 'express';
import { prisma } from '../index';
import { authenticate } from '../middleware/auth';
import { etbToSantim, formatEtb } from '../money';
import { resolveEntitlements } from '../entitlements';

const router = Router();

function requireBusiness(req: any, res: any): string | null {
  const id = req.actor?.businessId;
  if (!id) {
    res.status(400).json({ error: 'No active business' });
    return null;
  }
  return id;
}

router.get('/services', authenticate, async (req, res) => {
  try {
    const businessId = requireBusiness(req, res);
    if (!businessId) return;
    const services = await prisma.service.findMany({
      where: { businessId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
    });
    res.json({
      services: services.map(s => ({
        ...s,
        priceEtb: s.priceSantim / 100,
        priceLabel: formatEtb(s.priceSantim)
      }))
    });
  } catch (error) {
    console.error('List services error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/services', authenticate, async (req, res) => {
  try {
    const businessId = requireBusiness(req, res);
    if (!businessId) return;
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });
    const durationMinutes = Math.max(15, Number(req.body?.durationMinutes) || 60);
    const priceEtb = Number(req.body?.priceEtb);
    if (!Number.isFinite(priceEtb) || priceEtb < 0) {
      return res.status(400).json({ error: 'priceEtb must be a non-negative number' });
    }
    const service = await prisma.service.create({
      data: {
        businessId,
        name,
        description: req.body?.description ? String(req.body.description) : null,
        durationMinutes,
        priceSantim: etbToSantim(priceEtb),
        active: req.body?.active !== false
      }
    });
    res.status(201).json({ service: { ...service, priceEtb: service.priceSantim / 100 } });
  } catch (error) {
    console.error('Create service error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/services/:id', authenticate, async (req, res) => {
  try {
    const businessId = requireBusiness(req, res);
    if (!businessId) return;
    const id = String(req.params.id);
    const existing = await prisma.service.findFirst({ where: { id, businessId } });
    if (!existing) return res.status(404).json({ error: 'Service not found' });

    const data: any = {};
    if (req.body?.name != null) data.name = String(req.body.name).trim();
    if (req.body?.description !== undefined) {
      data.description = req.body.description ? String(req.body.description) : null;
    }
    if (req.body?.durationMinutes != null) {
      data.durationMinutes = Math.max(15, Number(req.body.durationMinutes) || 60);
    }
    if (req.body?.priceEtb != null) {
      const priceEtb = Number(req.body.priceEtb);
      if (!Number.isFinite(priceEtb) || priceEtb < 0) {
        return res.status(400).json({ error: 'priceEtb must be a non-negative number' });
      }
      data.priceSantim = etbToSantim(priceEtb);
    }
    if (typeof req.body?.active === 'boolean') data.active = req.body.active;

    const service = await prisma.service.update({ where: { id }, data });
    res.json({ service: { ...service, priceEtb: service.priceSantim / 100 } });
  } catch (error) {
    console.error('Patch service error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/profile', authenticate, async (req, res) => {
  try {
    const businessId = requireBusiness(req, res);
    if (!businessId) return;
    const data: any = {};
    if (req.body?.about !== undefined) data.about = req.body.about ? String(req.body.about) : null;
    if (req.body?.phone !== undefined) data.phone = req.body.phone ? String(req.body.phone) : null;
    if (req.body?.address !== undefined) data.address = req.body.address ? String(req.body.address) : null;
    if (req.body?.hoursJson !== undefined) {
      data.hoursJson =
        typeof req.body.hoursJson === 'string'
          ? req.body.hoursJson
          : JSON.stringify(req.body.hoursJson);
    }
    const business = await prisma.business.update({ where: { id: businessId }, data });
    res.json({ business });
  } catch (error) {
    console.error('Patch profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/appointments', authenticate, async (req, res) => {
  try {
    const businessId = requireBusiness(req, res);
    if (!businessId) return;
    const take = Math.min(Number(req.query.limit) || 50, 100);
    const appointments = await prisma.appointment.findMany({
      where: { businessId },
      orderBy: { startsAt: 'asc' },
      take,
      include: {
        customer: { select: { id: true, name: true, phone: true, email: true } },
        staffProfile: { select: { id: true, displayName: true } }
      }
    });
    res.json({
      appointments: appointments.map(a => ({
        ...a,
        priceEtb: a.priceSantim / 100,
        priceLabel: formatEtb(a.priceSantim)
      }))
    });
  } catch (error) {
    console.error('List appointments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/appointments/:id', authenticate, async (req, res) => {
  try {
    const businessId = requireBusiness(req, res);
    if (!businessId) return;
    const id = String(req.params.id);
    const appointment = await prisma.appointment.findFirst({ where: { id, businessId } });
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });

    const validStatuses = ['CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];
    const status = String(req.body?.status || '').toUpperCase();
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    const updated = await prisma.appointment.update({
      where: { id },
      data: { status },
      include: {
        customer: { select: { id: true, name: true, phone: true, email: true } },
        staffProfile: { select: { id: true, displayName: true } }
      }
    });
    res.json({
      appointment: {
        ...updated,
        priceEtb: updated.priceSantim / 100,
        priceLabel: formatEtb(updated.priceSantim)
      }
    });
  } catch (error) {
    console.error('Update appointment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/metrics', authenticate, async (req, res) => {
  try {
    const businessId = requireBusiness(req, res);
    if (!businessId) return;

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [bookingsThisMonth, revenueResult, totalCustomers, newCustomersThisMonth, topServices] =
      await Promise.all([
        prisma.appointment.count({
          where: { businessId, createdAt: { gte: monthStart }, status: { not: 'CANCELLED' } }
        }),
        prisma.appointment.aggregate({
          where: { businessId, createdAt: { gte: monthStart }, status: { not: 'CANCELLED' } },
          _sum: { priceSantim: true }
        }),
        prisma.customer.count({ where: { businessId } }),
        prisma.customer.count({ where: { businessId, createdAt: { gte: monthStart } } }),
        prisma.appointment.groupBy({
          by: ['serviceName'],
          where: { businessId, createdAt: { gte: monthStart }, status: { not: 'CANCELLED' } },
          _count: true,
          orderBy: { _count: { serviceName: 'desc' } },
          take: 5
        })
      ]);

    res.json({
      bookingsThisMonth,
      revenueThisMonthSantim: revenueResult._sum.priceSantim || 0,
      revenueThisMonthEtb: (revenueResult._sum.priceSantim || 0) / 100,
      revenueLabel: formatEtb(revenueResult._sum.priceSantim || 0),
      totalCustomers,
      newCustomersThisMonth,
      topServices: topServices.map(s => ({ name: s.serviceName, count: s._count }))
    });
  } catch (error) {
    console.error('Metrics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/customers', authenticate, async (req, res) => {
  try {
    const businessId = requireBusiness(req, res);
    if (!businessId) return;
    const entitlements = await resolveEntitlements(businessId);
    if (!entitlements?.features.customers_basic) {
      return res.status(403).json({ error: 'Customers not available on this plan' });
    }
    const customers = await prisma.customer.findMany({
      where: { businessId },
      orderBy: { lastVisitAt: 'desc' },
      take: 100
    });
    res.json({
      customers: customers.map(c => ({
        ...c,
        totalSpentEtb: c.totalSpentSantim / 100,
        totalSpentLabel: formatEtb(c.totalSpentSantim)
      }))
    });
  } catch (error) {
    console.error('List customers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
