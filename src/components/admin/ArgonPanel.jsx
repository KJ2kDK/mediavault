import { useState, useEffect, useCallback } from 'react';

/* ──────────────────────────────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────────────────────────────── */
const api = (path, opts = {}) =>
  fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  }).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
const put  = (path, body) => api(path, { method: 'PUT',  body: JSON.stringify(body) });

function formatExpiry(ts) {
  if (!ts || ts === '—') return '—';
  const d = new Date(Number(ts) * 1000 || ts);
  if (isNaN(d)) return String(ts);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function daysUntil(ts) {
  if (!ts) return Infinity;
  const exp = new Date(Number(ts) * 1000 || ts);
  return Math.ceil((exp - Date.now()) / 86400000);
}

/* ──────────────────────────────────────────────────────────────────────────────
   Config Section (collapsed by default when connected)
   ────────────────────────────────────────────────────────────────────────────── */
function ArgonConfig({ onConnected }) {
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [maskedKey, setMaskedKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    api('/api/argon/config').then(data => {
      setBaseUrl(data.baseUrl || '');
      setHasKey(data.hasKey);
      setMaskedKey(data.maskedKey || '');
      if (data.hasKey) { onConnected(true); setCollapsed(true); }
    }).catch(() => {});
  }, [onConnected]);

  const save = async () => {
    setSaving(true);
    const body = { baseUrl };
    if (apiKey.trim()) body.apiKey = apiKey.trim();
    await put('/api/argon/config', body);
    setApiKey('');
    setSaving(false);
    const data = await api('/api/argon/config');
    setHasKey(data.hasKey);
    setMaskedKey(data.maskedKey || '');
  };

  const test = async () => {
    setTesting(true); setTestResult(null);
    try {
      const data = await post('/api/argon/test');
      setTestResult(data.success ? 'connected' : `failed: ${data.error}`);
      if (data.success) { onConnected(true); setCollapsed(true); }
    } catch { setTestResult('failed'); }
    setTesting(false);
  };

  if (collapsed && hasKey) {
    return (
      <button onClick={() => setCollapsed(false)} className="text-[10px] text-vault-muted hover:text-vault-teal transition-colors flex items-center gap-1">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        API Settings ({maskedKey})
      </button>
    );
  }

  return (
    <div className="space-y-3 p-4 bg-vault-card/30 border border-vault-border rounded-xl">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-widest text-vault-muted">API Configuration</h4>
        {hasKey && <button onClick={() => setCollapsed(true)} className="text-[10px] text-vault-muted hover:text-white">Collapse</button>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-vault-muted uppercase tracking-wider mb-1 block">API Base URL</label>
          <input type="text" value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
            className="w-full px-3 py-2 rounded bg-vault-surface border border-vault-border text-xs text-white placeholder:text-vault-muted/50 focus:outline-none focus:border-vault-teal/50 font-mono" />
        </div>
        <div>
          <label className="text-[10px] text-vault-muted uppercase tracking-wider mb-1 block">
            API Key {hasKey && <span className="text-vault-teal">({maskedKey})</span>}
          </label>
          <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
            placeholder={hasKey ? 'Enter new key to change' : 'Paste your X-ApiKey'}
            className="w-full px-3 py-2 rounded bg-vault-surface border border-vault-border text-xs text-white placeholder:text-vault-muted/50 focus:outline-none focus:border-vault-teal/50 font-mono" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving} className="px-3 py-1.5 rounded bg-vault-teal text-black text-xs font-medium hover:bg-vault-teal/80 disabled:opacity-50">
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button onClick={test} disabled={testing || !hasKey} className="px-3 py-1.5 rounded bg-vault-card border border-vault-border text-xs text-white hover:bg-vault-border disabled:opacity-50">
          {testing ? 'Testing...' : 'Test Connection'}
        </button>
        {testResult && <span className={`text-xs ${testResult === 'connected' ? 'text-green-400' : 'text-red-400'}`}>{testResult === 'connected' ? 'Connected' : testResult}</span>}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Dashboard — matches the real Argon Resellers layout
   ────────────────────────────────────────────────────────────────────────────── */
function DashboardView({ lines, balance, onManage }) {
  const active    = lines.filter(l => String(l.status || l.state).toLowerCase() === 'active' || l.status === 1 || l.status === '1');
  const suspended = lines.filter(l => String(l.status || l.state).toLowerCase() === 'suspended' || l.status === 0 || l.status === '0');
  const expiring  = lines.filter(l => { const d = daysUntil(l.exp_date || l.expires || l.expiry); return d >= 0 && d <= 5; });
  const online    = lines.filter(l => l.online || l.is_online);

  const recentlyCreated = [...lines]
    .sort((a, b) => (b.created_at || b.created || 0) - (a.created_at || a.created || 0))
    .slice(0, 10);

  const statCards = [
    { label: 'Active Lines',    count: active.length,    bg: 'bg-green-500', icon: '▶' },
    { label: 'Suspended Lines', count: suspended.length, bg: 'bg-blue-600',  icon: '⏸' },
    { label: 'Expiring Soon',   count: expiring.length,  bg: 'bg-orange-500', icon: '⚠' },
    { label: 'Online Lines',    count: online.length,    bg: 'bg-cyan-600',  icon: '👥' },
  ];

  return (
    <div className="space-y-4">
      {/* ── 4 Stat Cards ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {statCards.map(s => (
          <div key={s.label} className={`${s.bg} rounded-lg p-4 flex items-center gap-3`}>
            <span className="text-2xl">{s.icon}</span>
            <div>
              <p className="text-white text-xs font-medium">{s.label}</p>
              <p className="text-white text-xl font-bold">{s.count}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Two-column: Recently Created  |  Expiring Soon ──── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recently Created Lines */}
        <div className="bg-vault-surface border border-vault-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-vault-border flex items-center gap-2">
            <span className="text-vault-muted">🕐</span>
            <h4 className="text-sm font-semibold text-white">Recently Created Lines</h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-vault-muted uppercase tracking-wider bg-vault-card/50">
                  <th className="px-4 py-2">#</th>
                  <th className="px-4 py-2">Username</th>
                  <th className="px-4 py-2">Created At</th>
                  <th className="px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recentlyCreated.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-vault-muted/50">No lines yet</td></tr>
                )}
                {recentlyCreated.map((line, i) => {
                  const id = line.id || line.line_id;
                  return (
                    <tr key={id || i} className="border-t border-vault-border/30 hover:bg-vault-card/30 transition-colors">
                      <td className="px-4 py-2 text-vault-muted">{id}</td>
                      <td className="px-4 py-2 text-white font-mono">{line.username || line.user || '—'}</td>
                      <td className="px-4 py-2 text-vault-muted">{formatExpiry(line.created_at || line.created)}</td>
                      <td className="px-4 py-2">
                        <button onClick={() => onManage(line)}
                          className="px-3 py-1 rounded bg-vault-teal text-black text-[10px] font-bold hover:bg-vault-teal/80 transition-colors">
                          Manage
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Expiring Soon Lines */}
        <div className="bg-vault-surface border border-vault-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-vault-border flex items-center gap-2">
            <span className="text-orange-400">⚠</span>
            <h4 className="text-sm font-semibold text-white">Expiring-soon Lines</h4>
          </div>
          {/* Warning note */}
          <div className="mx-4 mt-3 p-3 rounded bg-yellow-500/10 border border-yellow-500/30">
            <p className="text-[11px] text-yellow-400 flex items-start gap-2">
              <span className="text-base leading-none">⚠</span>
              <span>
                <span className="font-bold">Note:</span> Kindly make sure to renew any needed lines whenever possible.
                Any expired lines will remain on the system for 5 more days before they are completely terminated.
              </span>
            </p>
          </div>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-vault-muted uppercase tracking-wider bg-vault-card/50">
                  <th className="px-4 py-2">#</th>
                  <th className="px-4 py-2">Username</th>
                  <th className="px-4 py-2">Expiry Date</th>
                  <th className="px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {expiring.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-vault-muted/50">No expiring lines</td></tr>
                )}
                {expiring.map((line, i) => {
                  const id = line.id || line.line_id;
                  return (
                    <tr key={id || i} className="border-t border-vault-border/30 hover:bg-vault-card/30 transition-colors">
                      <td className="px-4 py-2 text-vault-muted">{id}</td>
                      <td className="px-4 py-2 text-white font-mono">{line.username || line.user || '—'}</td>
                      <td className="px-4 py-2 text-orange-400">{formatExpiry(line.exp_date || line.expires || line.expiry)}</td>
                      <td className="px-4 py-2">
                        <button onClick={() => onManage(line)}
                          className="px-3 py-1 rounded bg-vault-teal text-black text-[10px] font-bold hover:bg-vault-teal/80 transition-colors">
                          Manage
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Balance / Credit info */}
      {balance && (
        <div className="flex items-center gap-4 text-xs text-vault-muted">
          {Object.entries(balance).map(([k, v]) => (
            <span key={k} className="px-3 py-1.5 rounded bg-vault-surface border border-vault-border">
              <span className="uppercase tracking-wider text-[10px]">{k.replace(/_/g, ' ')}: </span>
              <span className="text-white font-bold">{typeof v === 'number' ? v.toFixed(2) : String(v)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Create Line — matches the real Argon "Create a new line" form
   ────────────────────────────────────────────────────────────────────────────── */
function CreateLineForm({ templates, onCreated }) {
  const [form, setForm] = useState({
    username: '', password: '', notes: '',
    package_id: '', additional_connections: '0', template_id: '',
  });
  const DEFAULT_PACKAGES = [
    { id: '24h_test', name: '24H Test', cost: 0 },
    { id: '3h_test',  name: '3H Test',  cost: 0 },
    { id: '1_month',  name: '1 Month',  cost: 0.1 },
    { id: '3_months', name: '3 Months', cost: 0.25 },
    { id: '6_months', name: '6 Months', cost: 0.5 },
    { id: '1_year',   name: '1 Year',   cost: 1 },
  ];
  const [packages, setPackages] = useState(DEFAULT_PACKAGES);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState(null);

  // Try to load packages from API, keep defaults if it fails
  useEffect(() => {
    api('/api/argon/packages').then(data => {
      const pkgs = Array.isArray(data) ? data : data.packages || data.data || [];
      if (pkgs.length > 0) setPackages(pkgs);
    }).catch(() => {});
  }, []);

  // Calculate cost (display only — actual cost computed server-side)
  const selectedPkg = packages.find(p => String(p.id) === String(form.package_id));
  const baseCost = selectedPkg?.cost || selectedPkg?.price || 0;
  const extraConn = Math.max(0, Number(form.additional_connections) || 0);
  const connCost = extraConn > 2 ? (extraConn - 2) * 0.08 : 0; // 2 free, 0.08/each after
  const totalCost = (Number(baseCost) + connCost).toFixed(2);

  const create = async () => {
    setCreating(true); setResult(null);
    try {
      // Build payload — only send non-empty fields
      const payload = {};
      if (form.username.trim()) payload.username = form.username.trim();
      if (form.password.trim()) payload.password = form.password.trim();
      if (form.notes.trim()) payload.notes = form.notes.trim();
      if (form.package_id) payload.package_id = form.package_id;
      if (form.additional_connections) payload.additional_connections = Number(form.additional_connections);
      if (form.template_id) payload.template_id = form.template_id;

      const data = await post('/api/argon/lines/create', payload);
      if (!data.error) {
        setResult({ success: true, data });
        setForm({ ...form, username: '', password: '', notes: '' });
        onCreated?.();
      } else {
        setResult({ success: false, error: data.error });
      }
    } catch (err) { setResult({ success: false, error: err.message }); }
    setCreating(false);
  };

  const inputCls = "w-full px-3 py-2.5 rounded bg-vault-bg border border-vault-border text-xs text-white placeholder:text-vault-muted/50 focus:outline-none focus:border-vault-teal/50";
  const labelCls = "text-xs text-vault-muted font-semibold mb-1.5 block";

  return (
    <div className="bg-vault-surface border border-vault-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-vault-border bg-vault-card/30">
        <h4 className="text-sm font-semibold text-white">Create New Line</h4>
      </div>

      <div className="p-5 space-y-4">
        {/* Username */}
        <div>
          <label className={labelCls}>Username</label>
          <input type="text" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
            placeholder="Auto-generated if left empty"
            className={inputCls} />
        </div>

        {/* Password */}
        <div>
          <label className={labelCls}>Password</label>
          <input type="text" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
            placeholder="Auto-generated if left empty"
            className={inputCls} />
        </div>

        {/* Notes */}
        <div>
          <label className={labelCls}>Notes</label>
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
            rows={3} placeholder="Optional notes for this line"
            className={`${inputCls} resize-y`} />
        </div>

        {/* Package */}
        <div>
          <label className={labelCls}>Package</label>
          <select value={form.package_id} onChange={e => setForm({ ...form, package_id: e.target.value })}
            className={inputCls}>
            <option value="">Select package...</option>
            {packages.map(p => (
              <option key={p.id} value={p.id}>
                {p.name || p.title || `Package #${p.id}`}
                {p.cost != null ? ` (${p.cost} credit)` : p.price != null ? ` (${p.price} credit)` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Additional connections */}
        <div>
          <label className={labelCls}>Additional connections</label>
          <input type="number" min="0" value={form.additional_connections}
            onChange={e => setForm({ ...form, additional_connections: e.target.value })}
            className={inputCls} />
          <p className="text-[10px] text-vault-muted mt-1.5">
            Each line is allowed to have 2 free additional connections. Any extra additional connections will cost you 0.08 credit for each.
          </p>
        </div>

        {/* Total cost */}
        <div className="py-2">
          <p className="text-sm text-white font-semibold">
            Total cost: <span className="text-vault-teal">{totalCost} credit</span>
          </p>
        </div>

        {/* Template */}
        <div>
          <label className={labelCls}>Template</label>
          <select value={form.template_id} onChange={e => setForm({ ...form, template_id: e.target.value })}
            className={inputCls}>
            <option value="">None</option>
            {templates.map(t => (
              <option key={t.id} value={t.id}>{t.name || t.title || t.template_name || `#${t.id}`}</option>
            ))}
          </select>
        </div>

        {/* Separator */}
        <div className="flex items-center gap-3 py-1 text-vault-muted text-[10px]">
          <div className="flex-1 border-t border-vault-border" />
          <span>or</span>
          <div className="flex-1 border-t border-vault-border" />
        </div>

        {/* Folder edit buttons */}
        <div className="flex flex-wrap gap-2">
          <button className="px-3 py-2 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-500 transition-colors">
            Edit live TV folders
          </button>
          <button className="px-3 py-2 rounded bg-green-600 text-white text-xs font-medium hover:bg-green-500 transition-colors">
            Edit movie folders
          </button>
          <button className="px-3 py-2 rounded bg-purple-600 text-white text-xs font-medium hover:bg-purple-500 transition-colors">
            Edit series folders
          </button>
        </div>

        {/* Create button */}
        <div className="pt-2">
          <button onClick={create} disabled={creating}
            className="px-5 py-2.5 rounded bg-vault-accent text-white text-sm font-medium hover:bg-vault-accent/80 disabled:opacity-50 transition-colors">
            {creating ? 'Creating...' : 'Create'}
          </button>
          {result && (
            <span className={`ml-3 text-xs ${result.success ? 'text-green-400' : 'text-red-400'}`}>
              {result.success ? 'Line created successfully!' : result.error}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Manage Lines — full table with search + actions
   ────────────────────────────────────────────────────────────────────────────── */
function ManageLines({ lines, loading, onRefresh, onManage }) {
  const [search, setSearch] = useState('');

  const searchLines = async () => {
    if (!search.trim()) { onRefresh(); return; }
    try {
      const data = await post('/api/argon/lines/search', { query: search });
      // handled via parent
    } catch {}
  };

  const filtered = search.trim()
    ? lines.filter(l => {
        const q = search.toLowerCase();
        return (l.username || l.user || '').toLowerCase().includes(q) ||
               String(l.id || l.line_id || '').includes(q);
      })
    : lines;

  const statusColor = (status) => {
    const s = String(status || '').toLowerCase();
    if (s === 'active' || s === 'enabled' || s === '1' || status === 1) return 'text-green-400 bg-green-400/10';
    if (s === 'suspended' || s === 'disabled' || s === '0' || status === 0) return 'text-red-400 bg-red-400/10';
    if (s === 'expired') return 'text-yellow-400 bg-yellow-400/10';
    return 'text-vault-muted bg-vault-card';
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search lines by username or ID..."
          className="flex-1 px-3 py-2 rounded bg-vault-bg border border-vault-border text-xs text-white placeholder:text-vault-muted/50 focus:outline-none focus:border-vault-teal/50" />
        <button onClick={onRefresh} className="px-3 py-2 rounded bg-vault-card border border-vault-border text-xs text-vault-muted hover:text-white">
          Refresh
        </button>
      </div>

      {loading && <p className="text-xs text-vault-muted animate-pulse py-4 text-center">Loading lines...</p>}

      {!loading && (
        <div className="bg-vault-surface border border-vault-border rounded-lg overflow-hidden">
          <div className="max-h-[500px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-vault-card/50 sticky top-0">
                <tr className="text-left text-vault-muted uppercase tracking-wider">
                  <th className="px-4 py-2">#</th>
                  <th className="px-4 py-2">Username</th>
                  <th className="px-4 py-2">Password</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Expiry Date</th>
                  <th className="px-4 py-2">Connections</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-vault-muted/50">No lines found</td></tr>
                )}
                {filtered.map((line, i) => {
                  const id = line.id || line.line_id;
                  return (
                    <tr key={id || i} className="border-t border-vault-border/30 hover:bg-vault-card/30 transition-colors">
                      <td className="px-4 py-2 text-vault-muted">{id}</td>
                      <td className="px-4 py-2 font-mono text-white">{line.username || line.user || '—'}</td>
                      <td className="px-4 py-2 font-mono text-vault-muted">{line.password || line.pass || '—'}</td>
                      <td className="px-4 py-2">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${statusColor(line.status || line.state)}`}>
                          {String(line.status || line.state || '—')}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-vault-muted">{formatExpiry(line.exp_date || line.expires || line.expiry)}</td>
                      <td className="px-4 py-2 text-vault-muted">{line.max_connections || line.max_conn || '—'}</td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => onManage(line)}
                          className="px-3 py-1 rounded bg-vault-teal text-black text-[10px] font-bold hover:bg-vault-teal/80 transition-colors">
                          Manage
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 bg-vault-card/50 border-t border-vault-border text-[10px] text-vault-muted">
            {filtered.length} line{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Manage Templates
   ────────────────────────────────────────────────────────────────────────────── */
function ManageTemplates({ templates, loading }) {
  if (loading) return <p className="text-xs text-vault-muted animate-pulse py-4 text-center">Loading templates...</p>;

  return (
    <div className="bg-vault-surface border border-vault-border rounded-lg overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-vault-card/50">
          <tr className="text-left text-vault-muted uppercase tracking-wider">
            <th className="px-4 py-2">#</th>
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Details</th>
          </tr>
        </thead>
        <tbody>
          {templates.length === 0 && (
            <tr><td colSpan={3} className="px-4 py-8 text-center text-vault-muted/50">No templates</td></tr>
          )}
          {templates.map((t, i) => (
            <tr key={t.id || i} className="border-t border-vault-border/30 hover:bg-vault-card/30 transition-colors">
              <td className="px-4 py-2 text-vault-muted">{t.id || i + 1}</td>
              <td className="px-4 py-2 text-white font-medium">{t.name || t.title || t.template_name || '—'}</td>
              <td className="px-4 py-2 text-vault-muted">
                {Object.entries(t).filter(([k]) => !['id', 'name', 'title', 'template_name'].includes(k)).slice(0, 4).map(([k, v]) => (
                  <span key={k} className="mr-3">
                    <span className="uppercase tracking-wider text-[10px]">{k.replace(/_/g, ' ')}:</span> {String(v)}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Line Detail Modal — full management view
   ────────────────────────────────────────────────────────────────────────────── */
function LineDetailModal({ line, onClose, onRefresh }) {
  const [detail, setDetail] = useState(null);
  const [watching, setWatching] = useState(null);
  const [actionLoading, setActionLoading] = useState('');
  const [showWatching, setShowWatching] = useState(false);

  const id = line?.id || line?.line_id;

  useEffect(() => {
    if (!id) return;
    api(`/api/argon/lines/${id}`).then(setDetail).catch(() => {});
  }, [id]);

  const loadWatching = async () => {
    setShowWatching(true);
    try { setWatching(await api(`/api/argon/lines/${id}/watching-now`)); }
    catch { setWatching([]); }
  };

  const doAction = async (action) => {
    setActionLoading(action);
    try {
      let endpoint, body = { line_id: id };
      switch (action) {
        case 'suspend':  endpoint = '/api/argon/lines/suspend'; break;
        case 'activate': endpoint = '/api/argon/lines/activate'; break;
        case 'refund':
          if (!confirm(`Refund line ${line.username || id}? This cannot be undone.`)) { setActionLoading(''); return; }
          endpoint = '/api/argon/lines/refund'; break;
        case 'enable-auto-renew':  endpoint = '/api/argon/lines/auto-renew/enable'; break;
        case 'disable-auto-renew': endpoint = '/api/argon/lines/auto-renew/disable'; break;
        default: setActionLoading(''); return;
      }
      await post(endpoint, body);
      onRefresh();
      // Reload detail
      try { setDetail(await api(`/api/argon/lines/${id}`)); } catch {}
    } catch {}
    setActionLoading('');
  };

  if (!line) return null;
  const data = detail || line;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-vault-bg border border-vault-border rounded-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-vault-border">
          <div>
            <h4 className="text-sm font-bold text-white">Manage Line</h4>
            <p className="text-[10px] text-vault-muted font-mono mt-0.5">{data.username || data.user || '—'} (#{id})</p>
          </div>
          <button onClick={onClose} className="text-vault-muted hover:text-white p-1">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Line info grid */}
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(data).map(([k, v]) => (
              <div key={k} className="py-1.5">
                <p className="text-[10px] text-vault-muted uppercase tracking-wider">{k.replace(/_/g, ' ')}</p>
                <p className="text-xs text-white font-mono mt-0.5 break-all">{typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—')}</p>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-vault-border">
            <button onClick={() => doAction('activate')} disabled={!!actionLoading}
              className="px-4 py-2 rounded bg-green-500/20 text-green-400 text-xs font-medium hover:bg-green-500/30 disabled:opacity-50">
              {actionLoading === 'activate' ? 'Activating...' : 'Activate'}
            </button>
            <button onClick={() => doAction('suspend')} disabled={!!actionLoading}
              className="px-4 py-2 rounded bg-yellow-500/20 text-yellow-400 text-xs font-medium hover:bg-yellow-500/30 disabled:opacity-50">
              {actionLoading === 'suspend' ? 'Suspending...' : 'Suspend'}
            </button>
            <button onClick={() => doAction('refund')} disabled={!!actionLoading}
              className="px-4 py-2 rounded bg-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/30 disabled:opacity-50">
              {actionLoading === 'refund' ? 'Refunding...' : 'Refund'}
            </button>
            <button onClick={() => doAction('enable-auto-renew')} disabled={!!actionLoading}
              className="px-4 py-2 rounded bg-vault-teal/20 text-vault-teal text-xs font-medium hover:bg-vault-teal/30 disabled:opacity-50">
              Auto-Renew ON
            </button>
            <button onClick={() => doAction('disable-auto-renew')} disabled={!!actionLoading}
              className="px-4 py-2 rounded bg-vault-card text-vault-muted text-xs font-medium hover:text-white disabled:opacity-50 border border-vault-border">
              Auto-Renew OFF
            </button>
            <button onClick={loadWatching} disabled={showWatching}
              className="px-4 py-2 rounded bg-blue-400/20 text-blue-400 text-xs font-medium hover:bg-blue-400/30 disabled:opacity-50 ml-auto">
              Watching Now
            </button>
          </div>

          {/* Watching Now */}
          {showWatching && (
            <div className="bg-vault-surface border border-vault-border rounded-lg p-3">
              <h5 className="text-xs font-semibold text-white mb-2">Currently Watching</h5>
              {!watching && <p className="text-xs text-vault-muted animate-pulse">Loading...</p>}
              {watching && Array.isArray(watching) && watching.length === 0 && (
                <p className="text-xs text-vault-muted/50">Not watching anything right now</p>
              )}
              {watching && Array.isArray(watching) && watching.map((w, i) => (
                <div key={i} className="p-2 rounded bg-vault-card/50 border border-vault-border/50 mb-1">
                  {Object.entries(w).map(([k, v]) => (
                    <div key={k} className="flex gap-2 py-0.5">
                      <span className="text-[10px] text-vault-muted w-24 shrink-0">{k}</span>
                      <span className="text-xs text-white">{String(v ?? '—')}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────────
   Sidebar navigation items — mirrors the real Argon panel structure
   ────────────────────────────────────────────────────────────────────────────── */
const SIDEBAR_ITEMS = [
  { id: 'dashboard',    label: 'Dashboard',          section: null,             icon: '📊' },
  { id: 'sep-lines',    label: 'LINES',              section: 'sep' },
  { id: 'create-line',  label: 'Create Line',        section: 'lines',          icon: '➕' },
  { id: 'manage-lines', label: 'Manage Lines',       section: 'lines',          icon: '📋' },
  { id: 'sep-tpl',      label: 'TEMPLATES',          section: 'sep' },
  { id: 'manage-tpl',   label: 'Manage Templates',   section: 'templates',      icon: '📄' },
  { id: 'sep-tools',    label: 'TOOLS',              section: 'sep' },
  { id: 'audit-logs',   label: 'Audit Logs',         section: 'tools',          icon: '📝' },
  { id: 'api-info',     label: 'API',                section: 'tools',          icon: '🔌' },
];

/* ──────────────────────────────────────────────────────────────────────────────
   Main Argon Panel — with sidebar navigation matching Argon dashboard
   ────────────────────────────────────────────────────────────────────────────── */
export default function ArgonPanel() {
  const [connected, setConnected] = useState(false);
  const [activeView, setActiveView] = useState('dashboard');
  const [lines, setLines] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [balance, setBalance] = useState(null);
  const [linesLoading, setLinesLoading] = useState(true);
  const [tplLoading, setTplLoading] = useState(true);
  const [manageLine, setManageLine] = useState(null);

  const loadLines = useCallback(async () => {
    setLinesLoading(true);
    try {
      const data = await api('/api/argon/lines');
      setLines(Array.isArray(data) ? data : data.lines || data.data || []);
    } catch {}
    setLinesLoading(false);
  }, []);

  const loadTemplates = useCallback(async () => {
    setTplLoading(true);
    try {
      const data = await api('/api/argon/templates');
      setTemplates(Array.isArray(data) ? data : data.templates || data.data || []);
    } catch {}
    setTplLoading(false);
  }, []);

  const loadBalance = useCallback(async () => {
    try { setBalance(await api('/api/argon/balance')); } catch {}
  }, []);

  useEffect(() => {
    if (!connected) return;
    loadLines();
    loadTemplates();
    loadBalance();
  }, [connected, loadLines, loadTemplates, loadBalance]);

  const handleManage = (line) => setManageLine(line);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
          <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
          </svg>
        </div>
        <div>
          <h3 className="text-sm font-bold text-white">Argon Resellers</h3>
          <p className="text-[10px] text-vault-muted">IPTV line management</p>
        </div>
        {connected && (
          <>
            <span className="text-[10px] px-2 py-0.5 rounded bg-green-400/10 text-green-400 font-bold">CONNECTED</span>
            {balance && (
              <span className="ml-auto text-xs text-vault-muted">
                {Object.entries(balance).map(([k, v]) => (
                  <span key={k} className="mr-3">
                    <span className="text-[10px] uppercase tracking-wider">{k.replace(/_/g, ' ')}: </span>
                    <span className="text-white font-bold">{typeof v === 'number' ? v.toFixed(2) : String(v)}</span>
                  </span>
                ))}
              </span>
            )}
          </>
        )}
      </div>

      {/* Config */}
      <ArgonConfig onConnected={setConnected} />

      {/* Main layout: sidebar + content */}
      {connected && (
        <div className="flex gap-4">
          {/* Left sidebar nav */}
          <div className="w-48 shrink-0 space-y-0.5">
            {SIDEBAR_ITEMS.map(item => {
              if (item.section === 'sep') {
                return (
                  <div key={item.id} className="pt-3 pb-1 px-2">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-vault-muted/60">{item.label}</p>
                  </div>
                );
              }
              return (
                <button key={item.id} onClick={() => setActiveView(item.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors ${
                    activeView === item.id
                      ? 'bg-vault-teal/10 text-vault-teal'
                      : 'text-vault-muted hover:text-white hover:bg-vault-card/50'
                  }`}>
                  <span className="text-sm">{item.icon}</span>
                  {item.label}
                </button>
              );
            })}
          </div>

          {/* Content area */}
          <div className="flex-1 min-w-0">
            {activeView === 'dashboard' && (
              <DashboardView lines={lines} balance={balance} onManage={handleManage} />
            )}
            {activeView === 'create-line' && (
              <CreateLineForm templates={templates} onCreated={() => { loadLines(); setActiveView('manage-lines'); }} />
            )}
            {activeView === 'manage-lines' && (
              <ManageLines lines={lines} loading={linesLoading} onRefresh={loadLines} onManage={handleManage} />
            )}
            {activeView === 'manage-tpl' && (
              <ManageTemplates templates={templates} loading={tplLoading} />
            )}
            {activeView === 'audit-logs' && (
              <div className="bg-vault-surface border border-vault-border rounded-lg p-5">
                <h4 className="text-sm font-semibold text-white mb-3">Audit Logs</h4>
                <p className="text-xs text-vault-muted">Argon audit logs are available on the Argon Resellers website directly. This section can be extended to pull logs via API if Argon adds that endpoint.</p>
              </div>
            )}
            {activeView === 'api-info' && (
              <div className="bg-vault-surface border border-vault-border rounded-lg p-5 space-y-3">
                <h4 className="text-sm font-semibold text-white">API Information</h4>
                <div className="space-y-2 text-xs text-vault-muted">
                  <p>Base URL: <span className="text-white font-mono">https://distributors.argontv.nl</span></p>
                  <p>Auth: <span className="text-white font-mono">X-ApiKey</span> header</p>
                  <p className="text-[10px] pt-2 border-t border-vault-border">
                    Endpoints proxied: balance, lines (list/get/search/create/edit/suspend/activate/refund/auto-renew), templates (list/search/delete), watching-now
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Line Detail Modal */}
      {manageLine && (
        <LineDetailModal
          line={manageLine}
          onClose={() => setManageLine(null)}
          onRefresh={() => { loadLines(); }}
        />
      )}
    </div>
  );
}
