import { useState } from 'react';
import { ArrowRight, Loader2, Lock, Mail, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
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
        src="/images/hero-network-fallback.webp"
        alt=""
        className="absolute inset-0 w-full h-full object-cover opacity-50 pointer-events-none"
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(70% 60% at 50% 42%, rgba(9,9,11,0.5) 0%, rgba(9,9,11,0.94) 100%)' }}
      />
      {/* Faint brand-yellow glow behind the card for depth, not just a flat panel on the backdrop */}
      <div
        className="absolute w-[520px] h-[520px] rounded-full pointer-events-none blur-3xl opacity-[0.07]"
        style={{ background: '#DFE104' }}
      />

      <div className="relative w-full max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="border border-[#1f1f23] bg-[#0c0c0f]/80 backdrop-blur-md p-8 shadow-[0_0_0_1px_rgba(223,225,4,0.08),0_20px_60px_-15px_rgba(0,0,0,0.8)]">
          <div className="flex items-center gap-2.5 mb-1">
            <img src="/brand/latech-symbol.svg" alt="" className="h-8 w-auto shrink-0" />
            <div className="font-display font-bold uppercase text-2xl tracking-tight">
              LATech <span className="text-[#DFE104]">Portal</span>
            </div>
          </div>
          <p className="text-sm text-[#A1A1AA] mb-8">Sign in with your company account.</p>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#71717A]" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  required
                  className="pl-9"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#71717A] z-10" />
                <PasswordInput
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  className="pl-9"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-sm text-red-400 bg-red-950/30 border border-red-900/50 px-3 py-2">
                <TriangleAlert size={15} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              className="w-full bg-[#DFE104] text-black hover:bg-[#c9cb04] disabled:opacity-60 group"
              disabled={busy}
            >
              {busy ? (
                <>
                  <Loader2 size={15} className="mr-1.5 animate-spin" /> Signing in…
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight size={15} className="ml-1.5 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-[#52525B] mt-5">
          Access is provisioned by your administrator — no self-signup.
        </p>
      </div>
    </div>
  );
}
