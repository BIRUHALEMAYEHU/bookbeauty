import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

const isProd = () => process.env.NODE_ENV === 'production';
const resendKey = () => (process.env.RESEND_API_KEY || '').trim();
const fromAddr = () => process.env.EMAIL_FROM || '"Book" <noreply@localhost>';

export const generateOtpCode = () => String(crypto.randomInt(100000, 999999));

export const packOtpToken = async (code: string, ttlMs = 15 * 60 * 1000) => {
  const hash = await bcrypt.hash(code, 8);
  return `${hash}:${Date.now() + ttlMs}`;
};

export const verifyPackedOtp = async (packed: string | null | undefined, code: string) => {
  if (!packed || !code) return false;
  const [hash, exp] = packed.split(':');
  if (!hash || !exp || Date.now() > Number(exp)) return false;
  return bcrypt.compare(code.trim(), hash);
};

async function sendViaResend(to: string, subject: string, text: string, html: string) {
  const key = resendKey();
  if (!key) {
    if (isProd()) throw new Error('RESEND_API_KEY missing');
    console.log(`[EMAIL:dev] to=${to} subject=${subject}\n${text}`);
    return { mock: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: fromAddr(), to: [to], subject, text, html })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend failed: ${body}`);
  }
  return { mock: false };
}

export async function sendSignupOtpEmail(email: string, code: string) {
  const text = `Your Book verification code is ${code}. It expires in 15 minutes.`;
  const html = `<p>Your Book verification code is <strong style="letter-spacing:4px">${code}</strong>.</p><p>Expires in 15 minutes.</p>`;
  if (!isProd() && !resendKey()) {
    console.log(`[EMAIL:dev] OTP for ${email}: ${code}`);
  }
  return sendViaResend(email, 'Verify your Book account', text, html);
}

export async function sendBookingNotifyOwner(opts: {
  to: string;
  businessName: string;
  customerName: string;
  customerPhone: string;
  serviceName: string;
  startsAt: Date;
  notes?: string | null;
}) {
  const when = opts.startsAt.toLocaleString('en-ET', { timeZone: 'Africa/Addis_Ababa' });
  const text = `New booking at ${opts.businessName}\n${opts.customerName} (${opts.customerPhone})\n${opts.serviceName}\n${when}\n${opts.notes || ''}`;
  const html = `
    <div style="font-family:Georgia,serif;padding:20px;color:#1c1917">
      <p style="letter-spacing:0.08em;text-transform:uppercase;color:#0f766e;font-size:12px">Book</p>
      <h2 style="margin:0 0 12px">New booking — ${opts.businessName}</h2>
      <p><strong>${opts.customerName}</strong> · ${opts.customerPhone}</p>
      <p>${opts.serviceName}</p>
      <p>${when} (Africa/Addis_Ababa)</p>
      ${opts.notes ? `<p>Notes: ${opts.notes}</p>` : ''}
    </div>`;
  return sendViaResend(opts.to, `New booking — ${opts.businessName}`, text, html);
}

export async function sendBookingConfirmCustomer(opts: {
  to: string;
  businessName: string;
  serviceName: string;
  startsAt: Date;
}) {
  const when = opts.startsAt.toLocaleString('en-ET', { timeZone: 'Africa/Addis_Ababa' });
  const text = `Your booking at ${opts.businessName} is confirmed.\n${opts.serviceName}\n${when}`;
  const html = `
    <div style="font-family:Georgia,serif;padding:20px;color:#1c1917">
      <h2>You're booked</h2>
      <p>${opts.businessName}</p>
      <p>${opts.serviceName}</p>
      <p>${when} (Africa/Addis_Ababa)</p>
    </div>`;
  return sendViaResend(opts.to, `Booking confirmed — ${opts.businessName}`, text, html);
}
