import React, { useEffect, useState, useMemo } from 'react';
import { Navigate, Route, Routes, Link } from 'react-router-dom';

const TOKEN_KEY = 'book_token';

async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`/api${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function slugify(v: string) {
  return v
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

const STATUS_CONFIG: Record<string, { label: string; class: string }> = {
  CONFIRMED: { label: 'Confirmed', class: 'confirmed' },
  COMPLETED: { label: 'Completed', class: 'completed' },
  CANCELLED: { label: 'Cancelled', class: 'cancelled' },
  NO_SHOW: { label: 'No Show', class: 'no_show' }
};

export const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<HomeGate />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

const HomeGate: React.FC = () => {
  const token = localStorage.getItem(TOKEN_KEY);
  return <Navigate to={token ? '/dashboard' : '/login'} replace />;
};

/* ═══════════════ Signup Page ═══════════════ */

const SignupPage: React.FC = () => {
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [category, setCategory] = useState('salon');
  const [slug, setSlug] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');

  useEffect(() => {
    if (!slug && businessName) setSlug(slugify(businessName));
  }, [businessName]);

  const submitSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setHint('');
    try {
      const res = await api('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          name,
          email,
          password,
          businessName,
          category,
          slug: slug ? slugify(slug) : undefined
        })
      });
      if (res.devOtpHint) {
        setHint(`Demo verification code: ${res.devOtpHint}`);
        setCode(res.devOtpHint);
      }
      setStep('otp');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api('/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ email, code: code.trim() })
      });
      if (res.token) {
        localStorage.setItem(TOKEN_KEY, res.token);
        window.location.href = '/dashboard';
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo-badge">✦</div>
          <h1 className="auth-title">
            {step === 'form' ? 'Create your Salon' : 'Verify Email'}
          </h1>
          <p className="auth-subtitle">
            {step === 'form'
              ? 'Start managing appointments, staff, and bookings in minutes.'
              : `Enter the 6-digit verification code sent to ${email}`}
          </p>
        </div>

        {error && <div className="toast-bar danger">{error}</div>}
        {hint && <div className="toast-bar success">{hint}</div>}

        {step === 'form' ? (
          <form onSubmit={submitSignup}>
            <div className="form-group">
              <label>Your Full Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Biruk Solomon"
                required
              />
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label>Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="salon@example.com"
                  required
                />
              </div>
              <div className="form-group">
                <label>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label>Salon / Business Name</label>
              <input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="e.g. Biruh Luxury Salon"
                required
              />
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label>Category</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="salon">Hair Salon & Spa</option>
                  <option value="barber">Barbershop</option>
                  <option value="nails">Nail Studio</option>
                  <option value="beauty">Beauty & Makeup</option>
                </select>
              </div>

              <div className="form-group">
                <label>Public Booking URL Slug</label>
                <input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="my-salon"
                  required
                />
              </div>
            </div>

            <button className="btn" type="submit" disabled={busy} style={{ marginTop: '1rem' }}>
              {busy ? 'Creating Salon Account…' : 'Continue to Verification ›'}
            </button>

            <p style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
              Already have an account? <Link to="/login" style={{ fontWeight: 700 }}>Sign In</Link>
            </p>
          </form>
        ) : (
          <form onSubmit={submitOtp}>
            <div className="form-group">
              <label>Verification Code</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                maxLength={8}
                style={{ textAlign: 'center', fontSize: '1.4rem', letterSpacing: '0.3em' }}
                required
              />
            </div>

            <button className="btn" type="submit" disabled={busy} style={{ marginTop: '1rem' }}>
              {busy ? 'Verifying…' : 'Verify & Enter Dashboard ›'}
            </button>

            <button
              type="button"
              className="btn-secondary"
              onClick={() => setStep('form')}
              style={{ width: '100%', marginTop: '0.75rem' }}
            >
              ‹ Back to Signup Form
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

/* ═══════════════ Login Page ═══════════════ */

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      if (res.token) {
        localStorage.setItem(TOKEN_KEY, res.token);
        window.location.href = '/dashboard';
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo-badge">✦</div>
          <h1 className="auth-title">Welcome Back</h1>
          <p className="auth-subtitle">Sign in to manage your salon appointments and team</p>
        </div>

        {error && <div className="toast-bar danger">{error}</div>}

        <form onSubmit={submitLogin}>
          <div className="form-group">
            <label>Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="salon@example.com"
              required
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <button className="btn" type="submit" disabled={busy} style={{ marginTop: '1rem' }}>
            {busy ? 'Signing in…' : 'Sign In to Dashboard ›'}
          </button>

          <p style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
            Don't have a salon account yet?{' '}
            <Link to="/signup" style={{ fontWeight: 700 }}>
              Create Account
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
};

/* ═══════════════ Business Dashboard Page ═══════════════ */

type Tab = 'overview' | 'appointments' | 'services' | 'staff' | 'customers' | 'profile';

const DashboardPage: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [services, setServices] = useState<any[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'danger' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Filter states
  const [apptFilter, setApptFilter] = useState<string>('ALL');

  // Form states: New Service
  const [svcName, setSvcName] = useState('');
  const [svcPrice, setSvcPrice] = useState('300');
  const [svcDuration, setSvcDuration] = useState('60');

  // Form states: New Staff
  const [staffName, setStaffName] = useState('');
  const [staffBio, setStaffBio] = useState('');

  // Staff service modal
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [editSvcIds, setEditSvcIds] = useState<string[]>([]);

  // Profile fields
  const [profileAbout, setProfileAbout] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileAddress, setProfileAddress] = useState('');

  const flash = (text: string, type: 'success' | 'danger' = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 4000);
  };

  const loadAll = async () => {
    try {
      const me = await api('/auth/me');
      setData(me);
      if (me.business) {
        setProfileAbout(me.business.about || '');
        setProfilePhone(me.business.phone || '');
        setProfileAddress(me.business.address || '');
      }

      const [sRes, aRes, mRes] = await Promise.all([
        api('/business/services'),
        api('/business/appointments'),
        api('/business/metrics')
      ]);

      setServices(sRes.services || []);
      setAppointments(aRes.appointments || []);
      setMetrics(mRes);

      if (me.entitlements?.features?.staff_management) {
        const stRes = await api('/business/staff');
        setStaff(stRes.staff || []);
      }
      if (me.entitlements?.features?.customers_basic) {
        const cRes = await api('/business/customers');
        setCustomers(cRes.customers || []);
      }
    } catch (err: any) {
      flash(err.message, 'danger');
      if (err.message.includes('401') || err.message.includes('Invalid token')) {
        localStorage.removeItem(TOKEN_KEY);
        window.location.href = '/login';
      }
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = '/login';
  };

  const publicBase = (import.meta as any).env?.VITE_PUBLIC_SITE_URL || 'http://127.0.0.1:3020';
  const slug = data?.business?.slug;
  const customerLink = slug ? `${publicBase.replace(/\/$/, '')}/${slug}` : '';

  const copyBookingLink = () => {
    if (!customerLink) return;
    navigator.clipboard.writeText(customerLink);
    setCopiedLink(true);
    flash('Booking link copied to clipboard! Share it in your Instagram bio.');
    setTimeout(() => setCopiedLink(false), 3000);
  };

  // Appointment Status Updater
  const updateAppointmentStatus = async (id: string, status: string) => {
    setBusy(true);
    try {
      await api(`/business/appointments/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      await loadAll();
      flash(`Appointment marked as ${status.toLowerCase()} ✓`);
    } catch (err: any) {
      flash(err.message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  // Add Service
  const addService = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/business/services', {
        method: 'POST',
        body: JSON.stringify({
          name: svcName.trim(),
          priceEtb: Number(svcPrice),
          durationMinutes: Number(svcDuration)
        })
      });
      setSvcName('');
      await loadAll();
      flash('New service added successfully ✓');
    } catch (err: any) {
      flash(err.message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  // Toggle Service Active
  const toggleServiceActive = async (id: string, currentActive: boolean) => {
    setBusy(true);
    try {
      await api(`/business/services/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !currentActive })
      });
      await loadAll();
      flash(`Service ${!currentActive ? 'activated' : 'hidden'} ✓`);
    } catch (err: any) {
      flash(err.message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  // Add Staff
  const addStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/business/staff', {
        method: 'POST',
        body: JSON.stringify({ displayName: staffName.trim(), bio: staffBio.trim() })
      });
      setStaffName('');
      setStaffBio('');
      await loadAll();
      flash('Staff artist added ✓');
    } catch (err: any) {
      flash(err.message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  // Toggle Staff Bookable
  const toggleStaffBookable = async (id: string, currentBookable: boolean) => {
    setBusy(true);
    try {
      await api(`/business/staff/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ bookable: !currentBookable })
      });
      await loadAll();
      flash('Artist availability updated ✓');
    } catch (err: any) {
      flash(err.message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  // Save Staff Assigned Services
  const saveStaffServices = async () => {
    if (!editingStaffId) return;
    setBusy(true);
    try {
      await api(`/business/staff/${editingStaffId}/services`, {
        method: 'PUT',
        body: JSON.stringify({ serviceIds: editSvcIds })
      });
      setEditingStaffId(null);
      await loadAll();
      flash('Assigned services saved ✓');
    } catch (err: any) {
      flash(err.message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  // Save Profile Details
  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/business/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          about: profileAbout,
          phone: profilePhone,
          address: profileAddress
        })
      });
      await loadAll();
      flash('Salon profile updated successfully ✓');
    } catch (err: any) {
      flash(err.message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  // Filtered Appointments
  const filteredAppointments = useMemo(() => {
    if (apptFilter === 'ALL') return appointments;
    return appointments.filter((a) => a.status === apptFilter);
  }, [appointments, apptFilter]);

  if (!data) {
    return (
      <div className="auth-shell">
        <div style={{ textAlign: 'center' }}>
          <div className="biz-avatar" style={{ margin: '0 auto 1.5rem', animation: 'pulse 1.5s infinite' }}>
            ✦
          </div>
          <h2 style={{ fontFamily: 'var(--font-heading)', color: 'var(--text-muted)' }}>
            Loading Salon Dashboard…
          </h2>
        </div>
      </div>
    );
  }

  const { business } = data;
  const initial = business?.name ? business.name.charAt(0).toUpperCase() : 'B';

  return (
    <div className="app-container">
      {/* Top Navbar */}
      <header className="topbar-wrapper">
        <div className="topbar">
          <div className="topbar-left">
            <div className="biz-avatar">{initial}</div>
            <div className="biz-meta">
              <h2>{business?.name}</h2>
              <span className="biz-plan-badge">✦ {business?.plan || 'FREE'} PLAN</span>
            </div>
          </div>

          <div className="topbar-right">
            {customerLink && (
              <a
                href={customerLink}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary"
                title="Preview what your customers see"
              >
                <span>↗</span> Live Booking Page
              </a>
            )}
            <button className="btn-sm" onClick={logout}>
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="nav-tabs-wrapper">
        <div className="nav-tabs">
          <button
            className={`nav-tab ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            <span>📊</span> Overview
          </button>
          <button
            className={`nav-tab ${activeTab === 'appointments' ? 'active' : ''}`}
            onClick={() => setActiveTab('appointments')}
          >
            <span>🗓️</span> Appointments
            <span className="tab-badge">{appointments.length}</span>
          </button>
          <button
            className={`nav-tab ${activeTab === 'services' ? 'active' : ''}`}
            onClick={() => setActiveTab('services')}
          >
            <span>✂️</span> Services
            <span className="tab-badge">{services.length}</span>
          </button>
          <button
            className={`nav-tab ${activeTab === 'staff' ? 'active' : ''}`}
            onClick={() => setActiveTab('staff')}
          >
            <span>👥</span> Team / Artists
            <span className="tab-badge">{staff.length}</span>
          </button>
          <button
            className={`nav-tab ${activeTab === 'customers' ? 'active' : ''}`}
            onClick={() => setActiveTab('customers')}
          >
            <span>👤</span> Clients
            <span className="tab-badge">{customers.length}</span>
          </button>
          <button
            className={`nav-tab ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            <span>⚙️</span> Salon Settings
          </button>
        </div>
      </nav>

      {/* Main Container */}
      <main className="dashboard-content">
        {msg && <div className={`toast-bar ${msg.type}`}>{msg.text}</div>}

        {/* ── OVERVIEW TAB ─────────────────────── */}
        {activeTab === 'overview' && (
          <>
            {/* Booking Link Hub Banner */}
            <div className="link-hub-card">
              <div className="link-hub-info">
                <h3>Your Live Booking Link</h3>
                <p>Add this link to your Instagram, TikTok, Telegram bio or flyers for instant client bookings.</p>
              </div>
              <div className="link-hub-action-box">
                <span className="link-url-text">{customerLink}</span>
                <button className="btn-white" onClick={copyBookingLink}>
                  {copiedLink ? '✓ Copied!' : '📋 Copy Link'}
                </button>
                <a
                  href={customerLink}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-white"
                  style={{ textDecoration: 'none' }}
                >
                  ↗ Open
                </a>
              </div>
            </div>

            {/* KPI Metrics */}
            {metrics && (
              <div className="metrics-row">
                <div className="metric-card">
                  <div className="metric-header">
                    <span className="metric-title">Bookings This Month</span>
                    <div className="metric-icon-box">📅</div>
                  </div>
                  <div className="metric-value">{metrics.bookingsThisMonth}</div>
                </div>

                <div className="metric-card accent">
                  <div className="metric-header">
                    <span className="metric-title">Revenue (This Month)</span>
                    <div className="metric-icon-box">💰</div>
                  </div>
                  <div className="metric-value">{metrics.revenueLabel}</div>
                </div>

                <div className="metric-card">
                  <div className="metric-header">
                    <span className="metric-title">Total Clients</span>
                    <div className="metric-icon-box">👥</div>
                  </div>
                  <div className="metric-value">{metrics.totalCustomers}</div>
                </div>

                <div className="metric-card">
                  <div className="metric-header">
                    <span className="metric-title">New Clients (Month)</span>
                    <div className="metric-icon-box">✨</div>
                  </div>
                  <div className="metric-value">{metrics.newCustomersThisMonth}</div>
                </div>
              </div>
            )}

            {/* Upcoming Appointments Stream */}
            <div className="card">
              <div className="card-title-row">
                <h3 className="card-title">Recent & Upcoming Appointments</h3>
                <button className="btn-sm primary" onClick={() => setActiveTab('appointments')}>
                  View All ({appointments.length}) ›
                </button>
              </div>

              {appointments.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', padding: '1rem 0' }}>
                  No appointments booked yet. Share your booking link to receive appointments!
                </p>
              ) : (
                <div className="appt-stream">
                  {appointments.slice(0, 5).map((a) => {
                    const statusInfo = STATUS_CONFIG[a.status] || { label: a.status, class: 'no_show' };
                    return (
                      <div className="appt-item" key={a.id}>
                        <div className="appt-left">
                          <div className="client-avatar">
                            {a.customer?.name ? a.customer.name.charAt(0).toUpperCase() : 'C'}
                          </div>
                          <div className="appt-info">
                            <h4>{a.serviceName}</h4>
                            <div className="appt-details-text">
                              <strong>{a.customer?.name}</strong>
                              <span>·</span>
                              <span>{new Date(a.startsAt).toLocaleString()}</span>
                              <span>·</span>
                              <span style={{ fontWeight: 700, color: 'var(--primary)' }}>
                                {a.priceLabel}
                              </span>
                              {a.staffProfile && <span>· Specialist: {a.staffProfile.displayName}</span>}
                            </div>
                          </div>
                        </div>

                        <div className="appt-right">
                          <span className={`status-pill ${statusInfo.class}`}>
                            {statusInfo.label}
                          </span>
                          {a.status === 'CONFIRMED' && (
                            <button
                              className="btn-sm primary"
                              onClick={() => updateAppointmentStatus(a.id, 'COMPLETED')}
                              disabled={busy}
                            >
                              ✓ Complete
                            </button>
                          )}
                          {a.customer?.phone && (
                            <a href={`tel:${a.customer.phone}`} className="btn-sm">
                              📞 Call
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── APPOINTMENTS TAB ─────────────────── */}
        {activeTab === 'appointments' && (
          <div className="card">
            <div className="card-title-row">
              <h3 className="card-title">All Salon Appointments</h3>
              <div className="filter-pills">
                {['ALL', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].map((st) => (
                  <button
                    key={st}
                    className={`filter-pill ${apptFilter === st ? 'active' : ''}`}
                    onClick={() => setApptFilter(st)}
                  >
                    {st === 'ALL' ? 'All' : STATUS_CONFIG[st]?.label || st}
                  </button>
                ))}
              </div>
            </div>

            {filteredAppointments.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', padding: '2rem 0', textAlign: 'center' }}>
                No appointments found for status "{apptFilter}".
              </p>
            ) : (
              <div className="appt-stream">
                {filteredAppointments.map((a) => {
                  const statusInfo = STATUS_CONFIG[a.status] || { label: a.status, class: 'no_show' };
                  return (
                    <div className="appt-item" key={a.id}>
                      <div className="appt-left">
                        <div className="client-avatar">
                          {a.customer?.name ? a.customer.name.charAt(0).toUpperCase() : 'C'}
                        </div>
                        <div className="appt-info">
                          <h4>{a.serviceName}</h4>
                          <div className="appt-details-text">
                            <strong>{a.customer?.name}</strong>
                            {a.customer?.phone && (
                              <a href={`tel:${a.customer.phone}`} style={{ fontWeight: 600 }}>
                                ({a.customer.phone})
                              </a>
                            )}
                            <span>·</span>
                            <span>{new Date(a.startsAt).toLocaleString()}</span>
                            <span>·</span>
                            <span style={{ fontWeight: 700, color: 'var(--primary)' }}>
                              {a.priceLabel}
                            </span>
                            {a.staffProfile && <span>· Specialist: {a.staffProfile.displayName}</span>}
                          </div>
                          {a.notes && (
                            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                              📝 Note: "{a.notes}"
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="appt-right">
                        <span className={`status-pill ${statusInfo.class}`}>
                          {statusInfo.label}
                        </span>

                        {/* Status Change Buttons */}
                        {['CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']
                          .filter((s) => s !== a.status)
                          .map((s) => (
                            <button
                              key={s}
                              className={`btn-sm ${s === 'CANCELLED' ? 'danger' : ''}`}
                              onClick={() => updateAppointmentStatus(a.id, s)}
                              disabled={busy}
                            >
                              {s === 'COMPLETED' ? '✓ Complete' : s === 'CANCELLED' ? '✕ Cancel' : s}
                            </button>
                          ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── SERVICES TAB ─────────────────────── */}
        {activeTab === 'services' && (
          <>
            <div className="card">
              <div className="card-title-row">
                <h3 className="card-title">Service Menu ({services.length})</h3>
              </div>

              <div className="service-items-grid">
                {services.map((s) => (
                  <div className="service-item-box" key={s.id}>
                    <div>
                      <div className="service-item-top">
                        <div className="service-item-name">{s.name}</div>
                        <span className={`status-pill ${s.active ? 'confirmed' : 'no_show'}`}>
                          {s.active ? 'Active' : 'Hidden'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', margin: '0.35rem 0' }}>
                        ⏱ {s.durationMinutes} minutes
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div className="service-item-price">{s.priceLabel}</div>
                      <button
                        className="btn-sm"
                        onClick={() => toggleServiceActive(s.id, s.active)}
                        disabled={busy}
                      >
                        {s.active ? 'Hide from Menu' : 'Show on Menu'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Add Service Card */}
            <div className="card">
              <h3 className="card-title" style={{ marginBottom: '1.25rem' }}>
                Add New Service
              </h3>
              <form onSubmit={addService}>
                <div className="grid-3">
                  <div className="form-group">
                    <label>Service Name *</label>
                    <input
                      value={svcName}
                      onChange={(e) => setSvcName(e.target.value)}
                      placeholder="e.g. Balayage & Highlights"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Price in ETB *</label>
                    <input
                      type="number"
                      value={svcPrice}
                      onChange={(e) => setSvcPrice(e.target.value)}
                      placeholder="500"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Duration (Minutes) *</label>
                    <input
                      type="number"
                      value={svcDuration}
                      onChange={(e) => setSvcDuration(e.target.value)}
                      placeholder="60"
                      required
                    />
                  </div>
                </div>

                <button className="btn" type="submit" disabled={busy} style={{ width: 'auto' }}>
                  + Add Service to Menu
                </button>
              </form>
            </div>
          </>
        )}

        {/* ── STAFF / TEAM TAB ─────────────────── */}
        {activeTab === 'staff' && (
          <>
            <div className="card">
              <div className="card-title-row">
                <h3 className="card-title">Team & Specialists ({staff.length})</h3>
              </div>

              {staff.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', padding: '1.5rem 0' }}>
                  No team members added yet. Add your stylists below so clients can pick their favorite specialist!
                </p>
              ) : (
                <div className="staff-cards-grid">
                  {staff.map((st) => {
                    const initials = st.displayName
                      .split(' ')
                      .map((n: string) => n[0])
                      .join('')
                      .toUpperCase()
                      .slice(0, 2);
                    return (
                      <div className="staff-box" key={st.id}>
                        <div className="staff-top-row">
                          <div className="staff-circle">{initials}</div>
                          <div className="staff-name-wrap">
                            <h4>{st.displayName}</h4>
                            <span className="staff-bio-text">{st.bio || 'Stylist / Artist'}</span>
                          </div>
                        </div>

                        <div>
                          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                            ASSIGNED SERVICES:
                          </div>
                          <div className="services-chips-wrap">
                            {st.services && st.services.length > 0 ? (
                              st.services.map((svc: any) => (
                                <span className="svc-chip" key={svc.id}>
                                  {svc.name}
                                </span>
                              ))
                            ) : (
                              <span style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>
                                All services
                              </span>
                            )}
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto', paddingTop: '0.5rem' }}>
                          <button
                            className="btn-sm"
                            onClick={() => {
                              setEditingStaffId(st.id);
                              setEditSvcIds(st.services ? st.services.map((x: any) => x.id) : []);
                            }}
                          >
                            Assign Services
                          </button>
                          <button
                            className={`btn-sm ${st.bookable ? 'primary' : ''}`}
                            onClick={() => toggleStaffBookable(st.id, st.bookable)}
                            disabled={busy}
                          >
                            {st.bookable ? '✓ Bookable' : 'Paused'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Service Assignment Modal / In-page Editor */}
            {editingStaffId && (
              <div className="card" style={{ borderColor: 'var(--primary)' }}>
                <div className="card-title-row">
                  <h3 className="card-title">Assign Services to Stylist</h3>
                  <button className="btn-sm" onClick={() => setEditingStaffId(null)}>
                    ✕ Close
                  </button>
                </div>
                <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                  Select the services this artist can perform:
                </p>
                <div className="grid-3" style={{ marginBottom: '1.25rem' }}>
                  {services.map((svc) => {
                    const isChecked = editSvcIds.includes(svc.id);
                    return (
                      <label
                        key={svc.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.6rem',
                          cursor: 'pointer',
                          padding: '0.5rem',
                          background: isChecked ? 'var(--primary-light)' : 'var(--surface-subtle)',
                          borderRadius: 'var(--radius-md)'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) setEditSvcIds([...editSvcIds, svc.id]);
                            else setEditSvcIds(editSvcIds.filter((id) => id !== svc.id));
                          }}
                          style={{ width: 'auto' }}
                        />
                        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{svc.name}</span>
                      </label>
                    );
                  })}
                </div>
                <button className="btn" onClick={saveStaffServices} disabled={busy} style={{ width: 'auto' }}>
                  Save Assigned Services
                </button>
              </div>
            )}

            {/* Add Team Member Card */}
            <div className="card">
              <h3 className="card-title" style={{ marginBottom: '1.25rem' }}>
                Add Team Member / Stylist
              </h3>
              <form onSubmit={addStaff}>
                <div className="grid-2">
                  <div className="form-group">
                    <label>Stylist Name *</label>
                    <input
                      value={staffName}
                      onChange={(e) => setStaffName(e.target.value)}
                      placeholder="e.g. Hanna Kebede"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Role / Specialty</label>
                    <input
                      value={staffBio}
                      onChange={(e) => setStaffBio(e.target.value)}
                      placeholder="e.g. Master Colorist & Hairdresser"
                    />
                  </div>
                </div>
                <button className="btn" type="submit" disabled={busy} style={{ width: 'auto' }}>
                  + Add Artist
                </button>
              </form>
            </div>
          </>
        )}

        {/* ── CLIENTS CRM TAB ─────────────────── */}
        {activeTab === 'customers' && (
          <div className="card">
            <div className="card-title-row">
              <h3 className="card-title">Client Directory ({customers.length})</h3>
            </div>

            {customers.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', padding: '2rem 0', textAlign: 'center' }}>
                No clients in your directory yet. When clients book appointments, they will automatically appear here!
              </p>
            ) : (
              <div className="customer-rows-list">
                {customers.map((c) => (
                  <div className="crm-row" key={c.id}>
                    <div>
                      <div className="crm-client-name">{c.name}</div>
                      <div className="crm-client-meta">
                        📞 {c.phone} {c.email && `· ✉️ ${c.email}`}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 800, color: 'var(--primary)' }}>
                          {c.totalSpentLabel || `${c.totalSpentSantim / 100} ETB`}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          {c.bookingCount} visit{c.bookingCount === 1 ? '' : 's'}
                        </div>
                      </div>

                      {c.phone && (
                        <a href={`tel:${c.phone}`} className="btn-sm">
                          📞 Call
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── PROFILE & SETTINGS TAB ──────────── */}
        {activeTab === 'profile' && (
          <div className="card">
            <div className="card-title-row">
              <h3 className="card-title">Salon Profile & Branding</h3>
            </div>

            <form onSubmit={saveProfile}>
              <div className="form-group">
                <label>Salon Bio & Tagline</label>
                <textarea
                  rows={3}
                  value={profileAbout}
                  onChange={(e) => setProfileAbout(e.target.value)}
                  placeholder="Tell clients about your salon, styling philosophy, and atmosphere..."
                />
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label>Salon Contact Phone</label>
                  <input
                    value={profilePhone}
                    onChange={(e) => setProfilePhone(e.target.value)}
                    placeholder="+251 911 000 000"
                  />
                </div>
                <div className="form-group">
                  <label>Salon Location / Physical Address</label>
                  <input
                    value={profileAddress}
                    onChange={(e) => setProfileAddress(e.target.value)}
                    placeholder="Bole Medhanialem, Addis Ababa"
                  />
                </div>
              </div>

              <div style={{ marginTop: '1.5rem' }}>
                <button className="btn" type="submit" disabled={busy} style={{ width: 'auto' }}>
                  {busy ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  );
};
