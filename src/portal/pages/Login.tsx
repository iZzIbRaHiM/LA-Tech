import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '../AuthContext';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-[#09090B] text-[#FAFAFA] flex items-center justify-center p-6 overflow-hidden">
      {/* Higgsfield-generated 3D network backdrop (same asset as the marketing hero fallback) */}
      <img
        src="/images/hero-network-fallback.png"
        alt=""
        className="absolute inset-0 w-full h-full object-cover opacity-40 pointer-events-none"
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(70% 60% at 50% 50%, rgba(9,9,11,0.55) 0%, rgba(9,9,11,0.92) 100%)' }}
      />
      <div className="relative w-full max-w-sm border border-[#1f1f23] bg-[#0c0c0f]/80 backdrop-blur-sm p-8">
        <div className="font-display font-bold uppercase text-2xl mb-1">
          LATech <span className="text-[#DFE104]">Portal</span>
        </div>
        <p className="text-sm text-[#A1A1AA] mb-8">Sign in with your company account.</p>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" className="w-full bg-[#DFE104] text-black hover:bg-[#c9cb04]" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}
