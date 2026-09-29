import { Router } from 'express';
import { prisma } from '../index';
import { rateLimit } from '../rateLimit';
import { formatEtb } from '../money';
import { sendBookingConfirmCustomer, sendBookingNotifyOwner } from '../email';
import { PLAN_DEFINITIONS, normalizePlan } from '../entitlements';

const router = Router();
const publicLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, name: 'public' });
const bookLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, name: 'book' });

const PHONE_RE = /^[0-9+\s()-]{8,20}$/;

router.get('/businesses/:slug', publicLimiter, async (req, res) => {
  try {
    const slug = String(req.params.slug || '')
      .trim()
      .toLowerCase();
    const business = await prisma.business.findUnique({
      where: { slug },
      include: {
        services: {
          where: { active: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
        },
        staffProfiles: {
          where: { bookable: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            staffServices: {
              include: { service: { select: { id: true, name: true } } }
            }
          }
        },
        owner: { select: { email: true } },
        subscription: true
      }
    });
    if (!business || business.status === 'SUSPENDED') {
      return res.status(404).json({ error: 'Business not found' });
    }

    let hours: unknown = null;
    if (business.hoursJson) {
      try {
        hours = JSON.parse(business.hoursJson);
      } catch {
        hours = null;
      }
    }

    res.json({
      business: {
        name: business.name,
        slug: business.slug,
        category: business.category,
        plan: business.plan,
        about: business.about,
        phone: business.phone,
        address: business.address,
        hours
      },
      services: business.services.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        durationMinutes: s.durationMinutes,
        priceEtb: s.priceSantim / 100,
        priceLabel: formatEtb(s.priceSantim)
      })),
      staff: business.staffProfiles.map(sp => ({
        id: sp.id,
        displayName: sp.displayName,
        bio: sp.bio,
        services: sp.staffServices.map(ss => ({
          id: ss.service.id,
          name: ss.service.name
        }))
      }))
    });
  } catch (error) {
    console.error('Public business error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/businesses/:slug/bookings', bookLimiter, async (req, res) => {
  try {
    const slug = String(req.params.slug || '')
      .trim()
      .toLowerCase();
    const business = await prisma.business.findUnique({
      where: { slug },
      include: {
        owner: { select: { email: true } },
        subscription: true,
        _count: { select: { appointments: true } }
      }
    });
    if (!business || business.status === 'SUSPENDED') {
      return res.status(404).json({ error: 'Business not found' });
    }

    const plan = normalizePlan(business.subscription?.plan || business.plan);
    const limits = PLAN_DEFINITIONS[plan].limits;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const bookingsThisMonth = await prisma.appointment.count({
      where: {
        businessId: business.id,
        createdAt: { gte: monthStart },
        status: { not: 'CANCELLED' }
      }
    });
    if (bookingsThisMonth >= limits.maxBookingsPerMonth) {
      return res.status(403).json({
        error: 'This business has reached its monthly booking limit on the Free plan.'
      });
    }

    const customerName = String(req.body?.name || '').trim();
    const phone = String(req.body?.phone || '').trim();
    const email = req.body?.email ? String(req.body.email).trim().toLowerCase() : null;
    const serviceId = String(req.body?.serviceId || '').trim();
    const staffProfileId = req.body?.staffProfileId ? String(req.body.staffProfileId).trim() : null;
    const notes = req.body?.notes ? String(req.body.notes).trim() : null;
    const startsRaw = String(req.body?.startsAt || '').trim();

    if (!customerName || !phone || !serviceId || !startsRaw) {
      return res.status(400).json({ error: 'name, phone, serviceId, and startsAt are required' });
    }
    if (!PHONE_RE.test(phone)) {
      return res.status(400).json({ error: 'Enter a valid phone number' });
    }

    const startsAt = new Date(startsRaw);
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() < Date.now() - 60_000) {
      return res.status(400).json({ error: 'Pick a valid future date and time' });
    }

    const service = await prisma.service.findFirst({
      where: { id: serviceId, businessId: business.id, active: true }
    });
    if (!service) return res.status(400).json({ error: 'Service not found' });

    const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);

    // Validate optional staff selection
    if (staffProfileId) {
      const sp = await prisma.staffProfile.findFirst({
        where: { id: staffProfileId, businessId: business.id, bookable: true }
      });
      if (!sp) return res.status(400).json({ error: 'Selected staff member is not available' });
    }

    const normalizedPhone = phone.replace(/\s+/g, '');

    const result = await prisma.$transaction(async tx => {
      let customer = await tx.customer.findUnique({
        where: {
          businessId_phone: { businessId: business.id, phone: normalizedPhone }
        }
      });
      if (!customer) {
        customer = await tx.customer.create({
          data: {
            businessId: business.id,
            name: customerName,
            phone: normalizedPhone,
            email,
            bookingCount: 0,
            totalSpentSantim: 0
          }
        });
      } else {
        customer = await tx.customer.update({
          where: { id: customer.id },
          data: {
            name: customerName,
            email: email || customer.email
          }
        });
      }

      const appointment = await tx.appointment.create({
        data: {
          businessId: business.id,
          customerId: customer.id,
          serviceId: service.id,
          staffProfileId: staffProfileId || undefined,
          serviceName: service.name,
          priceSantim: service.priceSantim,
          durationMinutes: service.durationMinutes,
          startsAt,
          endsAt,
          status: 'CONFIRMED',
          notes
        }
      });

      await tx.customer.update({
        where: { id: customer.id },
        data: {
          bookingCount: { increment: 1 },
          totalSpentSantim: { increment: service.priceSantim },
          lastVisitAt: startsAt
        }
      });

      return { appointment, customer };
    });

    // Notify owner (and customer if email provided) — best effort
    try {
      await sendBookingNotifyOwner({
        to: business.owner.email,
        businessName: business.name,
        customerName,
        customerPhone: normalizedPhone,
        serviceName: service.name,
        startsAt,
        notes
      });
    } catch (e) {
      console.error('Owner notify failed:', e);
    }
    if (email) {
      try {
        await sendBookingConfirmCustomer({
          to: email,
          businessName: business.name,
          serviceName: service.name,
          startsAt
        });
      } catch (e) {
        console.error('Customer confirm failed:', e);
      }
    }

    res.status(201).json({
      ok: true,
      appointment: {
        id: result.appointment.id,
        serviceName: result.appointment.serviceName,
        startsAt: result.appointment.startsAt,
        endsAt: result.appointment.endsAt,
        priceLabel: formatEtb(result.appointment.priceSantim)
      }
    });
  } catch (error) {
    console.error('Public booking error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
