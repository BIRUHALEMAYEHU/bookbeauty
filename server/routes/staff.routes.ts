import { Router } from 'express';
import { prisma } from '../index';
import { authenticate } from '../middleware/auth';
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

async function requireStaffFeature(businessId: string, res: any) {
  const ent = await resolveEntitlements(businessId);
  if (!ent?.features.staff_management) {
    res.status(403).json({ error: 'Staff management requires a Business or Pro plan' });
    return null;
  }
  return ent;
}

/* ── List ─────────────────────────────────────────── */
router.get('/', authenticate, async (req, res) => {
  try {
    const businessId = requireBusiness(req, res);
    if (!businessId) return;
    if (!(await requireStaffFeature(businessId, res))) return;

    const staff = await prisma.staffProfile.findMany({
      where: { businessId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        member: { include: { user: { select: { email: true, name: true } } } },
        staffServices: {
          include: { service: { select: { id: true, name: true, priceSantim: true, durationMinutes: true } } }
        },
        schedules: { orderBy: { dayOfWeek: 'asc' } },
        _count: { select: { appointments: true } }
      }
    });
    res.json({ staff });
  } catch (error) {
    console.error('List staff error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ── Create ───────────────────────────────────────── */
router.post('/', authenticate, async (req, res) => {
  try {
    const businessId = requireBusiness(req, res);
    if (!businessId) return;
    const ent = await requireStaffFeature(businessId, res);
    if (!ent) return;

    const count = await prisma.staffProfile.count({ where: { businessId } });
    if (count >= ent.limits.maxStaff) {
      return res
        .status(403)
        .json({ error: `Staff limit reached (${ent.limits.maxStaff}). Upgrade for more.` });
    }

    const displayName = String(req.body?.displayName || '').trim();
    if (!displayName) return res.status(400).json({ error: 'displayName is required' });

    const bio = req.body?.bio ? String(req.body.bio).trim() : null;
    const bookable = req.body?.bookable !== false;

    const profile = await prisma.staffProfile.create({
      data: { businessId, displayName, bio, bookable },
      include: {
        staffServices: { include: { service: { select: { id: true, name: true } } } },
        schedules: true,
        _count: { select: { appointments: true } }
      }
    });
    res.status(201).json({ staff: profile });
  } catch (error) {
    console.error('Create staff error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ── Update ───────────────────────────────────────── */
router.patch('/:id', authenticate, async (req, res) => {
  try {
    const businessId = requireBusiness(req, res);
    if (!businessId) return;
    if (!(await requireStaffFeature(businessId, res))) return;

    const id = String(req.params.id);
    const existing = await prisma.staffProfile.findFirst({ where: { id, businessId } });
    if (!existing) return res.status(404).json({ error: 'Staff not found' });

    const data: any = {};
    if (req.body?.displayName != null) data.displayName = String(req.body.displayName).trim();
    if (req.body?.bio !== undefined) data.bio = req.body.bio ? String(req.body.bio).trim() : null;
    if (typeof req.body?.bookable === 'boolean') data.bookable = req.body.bookable;
    if (req.body?.sortOrder != null) data.sortOrder = Number(req.body.sortOrder) || 0;

    const updated = await prisma.staffProfile.update({
      where: { id },
      data,
      include: {
        staffServices: { include: { service: { select: { id: true, name: true } } } },
        schedules: true,
        _count: { select: { appointments: true } }
      }
    });
    res.json({ staff: updated });
  } catch (error) {
    console.error('Patch staff error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ── Delete ───────────────────────────────────────── */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const businessId = requireBusiness(req, res);
    if (!businessId) return;
    if (!(await requireStaffFeature(businessId, res))) return;

    const id = String(req.params.id);
    const existing = await prisma.staffProfile.findFirst({ where: { id, businessId } });
    if (!existing) return res.status(404).json({ error: 'Staff not found' });

    await prisma.staffProfile.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) {
    console.error('Delete staff error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ── Set services for a staff member (replace) ──── */
router.put('/:id/services', authenticate, async (req, res) => {
  try {
    const businessId = requireBusiness(req, res);
    if (!businessId) return;
    if (!(await requireStaffFeature(businessId, res))) return;

    const id = String(req.params.id);
    const existing = await prisma.staffProfile.findFirst({ where: { id, businessId } });
    if (!existing) return res.status(404).json({ error: 'Staff not found' });

    const serviceIds: string[] = Array.isArray(req.body?.serviceIds) ? req.body.serviceIds : [];

    if (serviceIds.length > 0) {
      const validCount = await prisma.service.count({
        where: { id: { in: serviceIds }, businessId }
      });
      if (validCount !== serviceIds.length) {
        return res.status(400).json({ error: 'One or more service IDs are invalid' });
      }
    }

    await prisma.$transaction([
      prisma.staffService.deleteMany({ where: { staffProfileId: id } }),
      ...serviceIds.map(serviceId =>
        prisma.staffService.create({ data: { staffProfileId: id, serviceId } })
      )
    ]);

    const updated = await prisma.staffProfile.findUnique({
      where: { id },
      include: {
        staffServices: { include: { service: { select: { id: true, name: true } } } },
        schedules: true,
        _count: { select: { appointments: true } }
      }
    });
    res.json({ staff: updated });
  } catch (error) {
    console.error('Set staff services error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ── Set weekly schedule for a staff member ──────── */
router.put('/:id/schedule', authenticate, async (req, res) => {
  try {
    const businessId = requireBusiness(req, res);
    if (!businessId) return;
    if (!(await requireStaffFeature(businessId, res))) return;

    const id = String(req.params.id);
    const existing = await prisma.staffProfile.findFirst({ where: { id, businessId } });
    if (!existing) return res.status(404).json({ error: 'Staff not found' });

    const schedule: { dayOfWeek: number; openTime: string; closeTime: string; isOff?: boolean }[] =
      Array.isArray(req.body?.schedule) ? req.body.schedule : [];

    for (const s of schedule) {
      if (s.dayOfWeek < 0 || s.dayOfWeek > 6) {
        return res.status(400).json({ error: 'dayOfWeek must be 0–6' });
      }
    }

    await prisma.$transaction([
      prisma.staffSchedule.deleteMany({ where: { staffProfileId: id } }),
      ...schedule.map(s =>
        prisma.staffSchedule.create({
          data: {
            staffProfileId: id,
            dayOfWeek: s.dayOfWeek,
            openTime: s.openTime || '09:00',
            closeTime: s.closeTime || '18:00',
            isOff: s.isOff || false
          }
        })
      )
    ]);

    const updated = await prisma.staffProfile.findUnique({
      where: { id },
      include: { schedules: { orderBy: { dayOfWeek: 'asc' } } }
    });
    res.json({ staff: updated });
  } catch (error) {
    console.error('Set staff schedule error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
