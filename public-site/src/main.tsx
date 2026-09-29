import React, { useEffect, useMemo, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes, useParams, Link } from 'react-router-dom';
import './styles.css';

const API_BASE = '/api/public';

// Pre-defined time slots for seamless booking
const TIME_SLOTS = {
  morning: ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'],
  afternoon: ['12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'],
  evening: ['17:00', '17:30', '18:00', '18:30', '19:00']
};

function formatDateIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function PublicBusiness() {
  const { slug } = useParams();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bookingResult, setBookingResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  // Wizard state: 1: Service, 2: Specialist, 3: Date & Time, 4: Client Info
  const [currentStep, setCurrentStep] = useState(1);

  // Form selections
  const [serviceId, setServiceId] = useState('');
  const [staffId, setStaffId] = useState(''); // '' means 'any'
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    return formatDateIso(today);
  });
  const [selectedTime, setSelectedTime] = useState('11:00');

  // Client info
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');

  // Fetch business data
  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    fetch(`${API_BASE}/businesses/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Business not found');
        setData(body);
        if (body.services?.length > 0) {
          setServiceId(body.services[0].id);
        }
      })
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, [slug]);

  // Generate next 14 days
  const calendarDays = useMemo(() => {
    const days = [];
    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date();
      d.setDate(today.getDate() + i);
      const iso = formatDateIso(d);
      const dayName = i === 0 ? 'Today' : i === 1 ? 'Tmrw' : d.toLocaleDateString('en-US', { weekday: 'short' });
      const dayNum = d.getDate();
      const monthName = d.toLocaleDateString('en-US', { month: 'short' });
      days.push({ iso, dayName, dayNum, monthName, isToday: i === 0 });
    }
    return days;
  }, []);

  // Filter staff who provide the selected service
  const availableStaff = useMemo(() => {
    if (!data?.staff?.length || !serviceId) return [];
    return data.staff.filter(
      (s: any) =>
        s.services.length === 0 || s.services.some((svc: any) => svc.id === serviceId)
    );
  }, [data, serviceId]);

  // Find currently selected service
  const selectedService = useMemo(() => {
    return data?.services?.find((s: any) => s.id === serviceId);
  }, [data, serviceId]);

  // Find currently selected staff
  const selectedStaffMember = useMemo(() => {
    if (!staffId) return null;
    return data?.staff?.find((s: any) => s.id === staffId);
  }, [data, staffId]);

  // Submission handler
  const handleBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug || !selectedService) return;

    if (!name.trim()) {
      setError('Please enter your full name');
      setCurrentStep(4);
      return;
    }
    if (!phone.trim()) {
      setError('Please enter your phone number');
      setCurrentStep(4);
      return;
    }

    setBusy(true);
    setError('');

    // Format phone: if starts with 09 or 07, format to +251 or keep clean
    let formattedPhone = phone.trim();
    if (/^0[97]\d{8}$/.test(formattedPhone)) {
      formattedPhone = '+251' + formattedPhone.slice(1);
    }

    const startsAtIso = `${selectedDate}T${selectedTime}:00`;

    try {
      const res = await fetch(`${API_BASE}/businesses/${encodeURIComponent(slug)}/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          phone: formattedPhone,
          email: email.trim() || undefined,
          serviceId: selectedService.id,
          staffProfileId: staffId || undefined,
          startsAt: startsAtIso,
          notes: notes.trim() || undefined
        })
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to complete appointment');
      setBookingResult(body);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  // Skeleton / Loading state
  if (loading) {
    return (
      <div className="booking-shell">
        <main className="main-content" style={{ textAlign: 'center', paddingTop: '5rem' }}>
          <div className="salon-avatar" style={{ margin: '0 auto 1.5rem', animation: 'pulse 1.5s infinite' }}>
            ✨
          </div>
          <h2 style={{ fontFamily: 'var(--font-heading)', color: 'var(--text-muted)' }}>Loading salon…</h2>
        </main>
      </div>
    );
  }

  // Not found / Error state
  if (!data?.business) {
    return (
      <div className="booking-shell">
        <main className="main-content" style={{ textAlign: 'center', paddingTop: '4rem' }}>
          <div className="booking-card">
            <h2 style={{ fontFamily: 'var(--font-heading)', color: 'var(--danger)', marginBottom: '0.5rem' }}>
              Salon Not Found
            </h2>
            <p className="muted" style={{ marginBottom: '1.5rem' }}>
              {error || "The salon you're looking for doesn't exist or is currently inactive."}
            </p>
            <Link to="/" className="btn-secondary">
              Back to Home
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const { business, services = [] } = data;
  const initial = business.name ? business.name.charAt(0).toUpperCase() : 'B';

  // Format formatted appointment date for receipt
  const formatFriendlyDate = () => {
    try {
      const d = new Date(`${selectedDate}T${selectedTime}:00`);
      return d.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return selectedDate;
    }
  };

  // SUCCESS CONFIRMATION SCREEN
  if (bookingResult) {
    const appt = bookingResult.appointment || {};
    return (
      <div className="booking-shell">
        <header className="booking-nav">
          <div className="booking-nav-inner">
            <div className="nav-brand">
              <span>✦</span> {business.name}
            </div>
            <span className="nav-brand-badge">CONFIRMED</span>
          </div>
        </header>

        <main className="main-content">
          <div className="confirmation-screen">
            <div className="celebrate-circle">✓</div>
            <h1 className="confirmation-title">Booking Confirmed!</h1>
            <p className="confirmation-subtitle">
              We look forward to seeing you, <strong>{name}</strong>! Your appointment has been scheduled at {business.name}.
            </p>

            <div className="booking-ticket">
              <div className="ticket-header">
                <div>
                  <div className="ticket-label">Salon</div>
                  <strong style={{ fontSize: '1.1rem' }}>{business.name}</strong>
                </div>
                <div className="ticket-ref">REF: #{appt.id ? appt.id.slice(0, 8).toUpperCase() : 'BOK-SUCCESS'}</div>
              </div>

              <div className="ticket-grid">
                <div>
                  <div className="ticket-label">Service</div>
                  <div className="ticket-value">{selectedService?.name || 'Salon Service'}</div>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    ⏱ {selectedService?.durationMinutes} min
                  </span>
                </div>
                <div>
                  <div className="ticket-label">Artist / Specialist</div>
                  <div className="ticket-value">
                    {selectedStaffMember ? selectedStaffMember.displayName : 'Any Available Artist'}
                  </div>
                </div>
                <div>
                  <div className="ticket-label">Date & Time</div>
                  <div className="ticket-value" style={{ color: 'var(--primary)' }}>
                    {formatFriendlyDate()}
                  </div>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>at {selectedTime}</span>
                </div>
                <div>
                  <div className="ticket-label">Total to Pay</div>
                  <div className="ticket-value" style={{ color: 'var(--primary)', fontSize: '1.15rem' }}>
                    {selectedService?.priceLabel || `${selectedService?.priceEtb} ETB`}
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Pay at the salon</span>
                </div>
              </div>

              <div className="ticket-footer">
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  📍 {business.address || 'Addis Ababa'}
                </span>
                {business.phone && (
                  <a href={`tel:${business.phone}`} style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--primary)' }}>
                    📞 {business.phone}
                  </a>
                )}
              </div>
            </div>

            <div className="ticket-actions">
              <button
                className="btn-secondary"
                onClick={() => {
                  setBookingResult(null);
                  setCurrentStep(1);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              >
                🔄 Book Another Appointment
              </button>
              {business.phone && (
                <a
                  className="btn-cta"
                  style={{ width: 'auto', textDecoration: 'none' }}
                  href={`https://wa.me/${business.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(
                    `Hello ${business.name}, I booked an appointment for ${selectedService?.name} on ${formatFriendlyDate()} at ${selectedTime}.`
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  💬 Message Salon
                </a>
              )}
            </div>
          </div>
        </main>
      </div>
    );
  }

  // INTERACTIVE BOOKING WIZARD
  return (
    <div className="booking-shell">
      {/* Top sticky nav */}
      <header className="booking-nav">
        <div className="booking-nav-inner">
          <div className="nav-brand">
            <span>✦</span> {business.name}
          </div>
          <span className="nav-brand-badge">Direct Booking</span>
        </div>
      </header>

      <main className="main-content">
        {/* Salon Hero Showcase */}
        <section className="salon-hero">
          <div className="hero-top">
            <div className="salon-avatar">{initial}</div>
            <div className="salon-info">
              <div className="salon-name-wrap">
                <h1 className="salon-title">{business.name}</h1>
                <span className="verified-badge">
                  <span>✓</span> Verified Salon
                </span>
              </div>
              <p className="salon-category">
                {business.category === 'salon' ? '💇‍♀️ Hair Salon & Beauty Studio' : '✨ Beauty & Wellness'}
              </p>
            </div>
          </div>

          <div className="salon-meta-pills">
            <span className="meta-pill rating">⭐ 4.9 (120+ client reviews)</span>
            {business.address && (
              <span className="meta-pill">📍 {business.address}</span>
            )}
            {business.phone && (
              <a href={`tel:${business.phone}`} className="meta-pill">
                📞 Call {business.phone}
              </a>
            )}
            <span className="meta-pill">🕒 Open Today</span>
          </div>
        </section>

        {/* Wizard Step Breadcrumb Navigation */}
        <div className="step-tracker">
          <button
            className={`step-item ${currentStep === 1 ? 'active' : ''} ${currentStep > 1 ? 'completed' : ''}`}
            onClick={() => setCurrentStep(1)}
          >
            <span className="step-number">{currentStep > 1 ? '✓' : '1'}</span>
            <span>1. Service</span>
          </button>
          <span className="step-divider">›</span>

          <button
            className={`step-item ${currentStep === 2 ? 'active' : ''} ${currentStep > 2 ? 'completed' : ''}`}
            onClick={() => setCurrentStep(2)}
          >
            <span className="step-number">{currentStep > 2 ? '✓' : '2'}</span>
            <span>2. Specialist</span>
          </button>
          <span className="step-divider">›</span>

          <button
            className={`step-item ${currentStep === 3 ? 'active' : ''} ${currentStep > 3 ? 'completed' : ''}`}
            onClick={() => setCurrentStep(3)}
          >
            <span className="step-number">{currentStep > 3 ? '✓' : '3'}</span>
            <span>3. Date & Time</span>
          </button>
          <span className="step-divider">›</span>

          <button
            className={`step-item ${currentStep === 4 ? 'active' : ''}`}
            onClick={() => setCurrentStep(4)}
          >
            <span className="step-number">4</span>
            <span>4. Details</span>
          </button>
        </div>

        {error && (
          <div className="error-banner">
            <span>⚠️</span> {error}
          </div>
        )}

        <form onSubmit={handleBooking}>
          {/* STEP 1: SELECT SERVICE */}
          {currentStep === 1 && (
            <div className="booking-card">
              <div className="card-header">
                <div className="card-subtitle">Step 1 of 4</div>
                <h2 className="card-title">Choose your service</h2>
              </div>

              {services.length === 0 ? (
                <p className="muted">No services listed yet.</p>
              ) : (
                <div className="service-options">
                  {services.map((svc: any) => {
                    const isSelected = serviceId === svc.id;
                    return (
                      <div
                        key={svc.id}
                        className={`service-card ${isSelected ? 'selected' : ''}`}
                        onClick={() => {
                          setServiceId(svc.id);
                          // Auto advance smoothly or keep user in control
                        }}
                      >
                        <div className="service-card-left">
                          <div className="radio-circle">
                            {isSelected && <div className="radio-dot" />}
                          </div>
                          <div className="service-meta">
                            <h4>{svc.name}</h4>
                            <div className="service-duration-pill">
                              <span>⏱</span> {svc.durationMinutes} min
                              {svc.description && <span>· {svc.description}</span>}
                            </div>
                          </div>
                        </div>
                        <div className="service-price-tag">
                          {svc.priceLabel || `${svc.priceEtb} ETB`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn-cta"
                  style={{ width: 'auto', minWidth: '160px' }}
                  onClick={() => setCurrentStep(2)}
                  disabled={!serviceId}
                >
                  Next: Specialist ›
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: CHOOSE SPECIALIST */}
          {currentStep === 2 && (
            <div className="booking-card">
              <div className="card-header">
                <div className="card-subtitle">Step 2 of 4</div>
                <h2 className="card-title">Select your stylist / artist</h2>
              </div>

              <div className="specialist-options">
                {/* Any available option */}
                <div
                  className={`specialist-card ${staffId === '' ? 'selected' : ''}`}
                  onClick={() => setStaffId('')}
                >
                  <div className="specialist-avatar any">✨</div>
                  <div className="specialist-name">Any Specialist</div>
                  <div className="specialist-role">First available opening</div>
                </div>

                {/* Team members */}
                {availableStaff.map((s: any) => {
                  const isSelected = staffId === s.id;
                  const initials = s.displayName
                    .split(' ')
                    .map((n: string) => n[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2);
                  return (
                    <div
                      key={s.id}
                      className={`specialist-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => setStaffId(s.id)}
                    >
                      <div className="specialist-avatar">{initials}</div>
                      <div className="specialist-name">{s.displayName}</div>
                      <div className="specialist-role">{s.bio || 'Beauty Artist'}</div>
                    </div>
                  );
                })}
              </div>

              <div
                style={{
                  marginTop: '1.75rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setCurrentStep(1)}
                >
                  ‹ Back
                </button>
                <button
                  type="button"
                  className="btn-cta"
                  style={{ width: 'auto', minWidth: '160px' }}
                  onClick={() => setCurrentStep(3)}
                >
                  Next: Date & Time ›
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: DATE & TIME */}
          {currentStep === 3 && (
            <div className="booking-card">
              <div className="card-header">
                <div className="card-subtitle">Step 3 of 4</div>
                <h2 className="card-title">Pick appointment date & time</h2>
              </div>

              {/* Horizontal Date Picker */}
              <div className="date-selector-row">
                {calendarDays.map((d) => {
                  const isSelected = selectedDate === d.iso;
                  return (
                    <div
                      key={d.iso}
                      className={`date-chip ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedDate(d.iso)}
                    >
                      <span className="date-day-name">{d.dayName}</span>
                      <span className="date-day-num">{d.dayNum}</span>
                      <span className="date-month-name">{d.monthName}</span>
                    </div>
                  );
                })}
              </div>

              {/* Time Slots Categorized */}
              <div className="time-slots-group">
                <div className="time-group-label">
                  <span>🌅</span> Morning Slots
                </div>
                <div className="time-slots-grid">
                  {TIME_SLOTS.morning.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`time-slot-btn ${selectedTime === t ? 'selected' : ''}`}
                      onClick={() => setSelectedTime(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                <div className="time-group-label">
                  <span>☀️</span> Afternoon Slots
                </div>
                <div className="time-slots-grid">
                  {TIME_SLOTS.afternoon.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`time-slot-btn ${selectedTime === t ? 'selected' : ''}`}
                      onClick={() => setSelectedTime(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                <div className="time-group-label">
                  <span>🌙</span> Evening Slots
                </div>
                <div className="time-slots-grid">
                  {TIME_SLOTS.evening.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`time-slot-btn ${selectedTime === t ? 'selected' : ''}`}
                      onClick={() => setSelectedTime(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div
                style={{
                  marginTop: '1.75rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setCurrentStep(2)}
                >
                  ‹ Back
                </button>
                <button
                  type="button"
                  className="btn-cta"
                  style={{ width: 'auto', minWidth: '160px' }}
                  onClick={() => setCurrentStep(4)}
                  disabled={!selectedDate || !selectedTime}
                >
                  Next: Your Details ›
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: CUSTOMER DETAILS & FINAL CONFIRM */}
          {currentStep === 4 && (
            <div className="booking-card">
              <div className="card-header">
                <div className="card-subtitle">Step 4 of 4</div>
                <h2 className="card-title">Confirm & your contact info</h2>
              </div>

              {/* Dynamic Live Booking Receipt */}
              <div className="summary-receipt">
                <div className="summary-receipt-title">Appointment Summary</div>
                <div className="summary-item">
                  <span className="muted">Service:</span>
                  <strong>{selectedService?.name} ({selectedService?.durationMinutes} min)</strong>
                </div>
                <div className="summary-item">
                  <span className="muted">Specialist:</span>
                  <span>{selectedStaffMember ? selectedStaffMember.displayName : 'Any Available Artist'}</span>
                </div>
                <div className="summary-item">
                  <span className="muted">Date & Time:</span>
                  <span style={{ fontWeight: 700, color: 'var(--primary)' }}>
                    {formatFriendlyDate()} at {selectedTime}
                  </span>
                </div>
                <div className="summary-item total">
                  <span>Total Payable:</span>
                  <span>{selectedService?.priceLabel || `${selectedService?.priceEtb} ETB`}</span>
                </div>
              </div>

              {/* Client Info Fields */}
              <div className="form-group">
                <label className="form-label">Full Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Sara Haile"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Phone Number (Ethiopia) *</label>
                <div className="input-with-prefix">
                  <div className="phone-prefix">
                    <span>🇪🇹</span> +251
                  </div>
                  <input
                    type="tel"
                    placeholder="911 234 567 or 09..."
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                  />
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginTop: '0.25rem', display: 'block' }}>
                  Used for booking confirmation and appointment reminders.
                </span>
              </div>

              <div className="form-group">
                <label className="form-label">Email Address (Optional)</label>
                <input
                  type="email"
                  placeholder="sara@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Special Requests / Notes</label>
                <textarea
                  rows={2}
                  placeholder="Any styling preferences or questions for the artist..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div
                style={{
                  marginTop: '1.75rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '1rem'
                }}
              >
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setCurrentStep(3)}
                >
                  ‹ Back
                </button>
                <button
                  type="submit"
                  className="btn-cta"
                  disabled={busy}
                  style={{ flex: 1 }}
                >
                  {busy ? 'Securing your appointment…' : `✓ Confirm Booking (${selectedService?.priceLabel || ''})`}
                </button>
              </div>
            </div>
          )}
        </form>
      </main>
    </div>
  );
}

function Home() {
  return (
    <div className="booking-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="booking-card" style={{ maxWidth: '440px', textAlign: 'center', margin: '2rem' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>✦</div>
        <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.75rem', marginBottom: '0.5rem' }}>
          Book Appointments
        </h1>
        <p className="muted" style={{ marginBottom: '1.5rem', fontSize: '0.92rem' }}>
          Open your salon's direct booking link (for example: <code>/biruhsalon</code>) to schedule your beauty services.
        </p>
        <Link to="/biruhsalon" className="btn-cta" style={{ textDecoration: 'none' }}>
          Visit Demo Salon (biruh salon)
        </Link>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/:slug" element={<PublicBusiness />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
