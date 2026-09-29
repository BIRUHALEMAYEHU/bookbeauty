import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

const TOKEN_KEY = 'book_platform_token';

async function platformFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`/platform/api${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const App: React.FC = () => {
  const [staff, setStaff] = useState<any>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setBooting(false);
      return;
    }
    platformFetch('/auth/me')
      .then(d => setStaff(d.staff))
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setBooting(false));
  }, []);

  if (booting) return <div className="shell"><p className="muted">Loading…</p></div>;
  if (!staff) return <Login onAuthed={setStaff} />;
  return <Console staff={staff} onLogout={() => { localStorage.removeItem(TOKEN_KEY); setStaff(null); }} />;
};

const Login: React.FC<{ onAuthed: (s: any) => void }> = ({ onAuthed }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'login' | 'mfa' | 'setup'>('login');
  const [code, setCode] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await platformFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      if (data.requiresMfaSetup) {
        setSetupToken(data.setupToken);
        setSecret(data.secret);
        setStep('setup');
      } else if (data.requiresMfa) {
        setMfaToken(data.mfaToken);
        setStep('mfa');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const verifySetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await platformFetch('/auth/mfa/setup/verify', {
        method: 'POST',
        body: JSON.stringify({ setupToken, code })
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      onAuthed(data.staff);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const verifyMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await platformFetch('/auth/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({ mfaToken, code })
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      onAuthed(data.staff);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shell">
      <div className="card">
        <h1>Book Platform</h1>
        <p className="muted">Staff console — MFA required.</p>
        {step === 'login' && (
          <form onSubmit={login}>
            <label>Email</label>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" required />
            <label>Password</label>
            <input value={password} onChange={e => setPassword(e.target.value)} type="password" required />
            <button className="btn" disabled={busy}>{busy ? '…' : 'Continue'}</button>
          </form>
        )}
        {step === 'setup' && (
          <form onSubmit={verifySetup}>
            <p className="muted">Add this secret in your authenticator app:</p>
            <code className="secret">{secret}</code>
            <label>First 6-digit code</label>
            <input value={code} onChange={e => setCode(e.target.value)} required />
            <button className="btn" disabled={busy}>Enable MFA</button>
          </form>
        )}
        {step === 'mfa' && (
          <form onSubmit={verifyMfa}>
            <label>Authenticator code</label>
            <input value={code} onChange={e => setCode(e.target.value)} required />
            <button className="btn" disabled={busy}>Verify</button>
          </form>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
};

const Console: React.FC<{ staff: any; onLogout: () => void }> = ({ staff, onLogout }) => {
  const [query, setQuery] = useState('');
  const [list, setList] = useState<any[]>([]);
  const [error, setError] = useState('');

  const search = async () => {
    try {
      const data = await platformFetch(`/businesses?query=${encodeURIComponent(query)}`);
      setList(data.businesses || []);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => {
    search().catch(() => undefined);
  }, []);

  return (
    <div className="shell wide">
      <header className="top">
        <div>
          <h1>Businesses</h1>
          <p className="muted">{staff.email} · {staff.role}</p>
        </div>
        <button className="btn ghost" type="button" onClick={onLogout}>Sign out</button>
      </header>
      <div className="row">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name or slug" />
        <button className="btn" type="button" onClick={search}>Search</button>
      </div>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Slug</th>
            <th>Plan</th>
            <th>Status</th>
            <th>Owner</th>
          </tr>
        </thead>
        <tbody>
          {list.map(b => (
            <tr key={b.id}>
              <td>{b.name}</td>
              <td>/{b.slug}</td>
              <td>{b.plan}</td>
              <td>{b.status}</td>
              <td>{b.owner?.email}</td>
            </tr>
          ))}
          {list.length === 0 && (
            <tr><td colSpan={5} className="muted">No businesses yet</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
