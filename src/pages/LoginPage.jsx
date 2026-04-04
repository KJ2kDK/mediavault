import { useState } from 'react';

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isSetup, setIsSetup] = useState(null); // null = checking, true = no users yet

  // Check if this is first-time setup
  useState(() => {
    fetch('/api/auth/status')
      .then((r) => r.json())
      .then((d) => setIsSetup(!d.hasUsers))
      .catch(() => setIsSetup(false));
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError(null);

    try {
      const endpoint = isSetup ? '/api/auth/register' : '/api/auth/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');
      localStorage.setItem('mediavault_token', data.token);
      onLogin(data.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (isSetup === null) return null; // still checking

  return (
    <div className="min-h-screen bg-vault-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold">
            <span className="text-vault-accent">MEDIA</span>
            <span className="text-vault-teal">VAULT</span>
          </h1>
          <p className="text-vault-muted text-xs mt-2">
            {isSetup ? 'Create your account to get started' : 'Sign in to continue'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-vault-card border border-vault-border rounded-xl p-6 space-y-4">
          <div>
            <label className="block text-[11px] text-vault-muted uppercase tracking-wider mb-1.5">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              className="w-full px-3 py-2.5 rounded-lg bg-vault-bg border border-vault-border text-sm text-vault-text placeholder:text-vault-muted/50 focus:outline-none focus:border-vault-accent/50"
              placeholder="Enter username"
            />
          </div>
          <div>
            <label className="block text-[11px] text-vault-muted uppercase tracking-wider mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isSetup ? 'new-password' : 'current-password'}
              className="w-full px-3 py-2.5 rounded-lg bg-vault-bg border border-vault-border text-sm text-vault-text placeholder:text-vault-muted/50 focus:outline-none focus:border-vault-accent/50"
              placeholder={isSetup ? 'Choose a password' : 'Enter password'}
            />
          </div>
          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading || !username.trim() || !password}
            className="w-full py-2.5 rounded-lg bg-vault-accent text-white text-sm font-medium hover:bg-vault-accentHover disabled:opacity-50 disabled:cursor-default transition-colors"
          >
            {loading ? 'Please wait...' : isSetup ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-[10px] text-vault-muted/50 mt-6">MediaVault v0.1.0</p>
      </div>
    </div>
  );
}
