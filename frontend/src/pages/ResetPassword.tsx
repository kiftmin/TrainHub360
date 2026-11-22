import { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type State = 'checking' | 'ready' | 'missing' | 'done';

/**
 * Round 7 gap 4. The password-reset email links to /reset-password?token=…, but the app had
 * no such route: it fell through to the login page, which ignored the token and still asked
 * the user to paste one from a console the backend no longer writes to.
 *
 * This page is rendered before any session exists (same pattern as Activate), so the link
 * works for a user who is signed out. Nothing here trusts the token beyond sending it back.
 */
export function ResetPassword({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [state, setState] = useState<State>('checking');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('token') ?? '';
    setToken(fromUrl);
    setState(fromUrl ? 'ready' : 'missing');
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Reset failed (${res.status})`);
      setState('done');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
            {state === 'done' ? <CheckCircle2 className="size-5" /> : <ShieldCheck className="size-5" />}
          </div>
          <div>
            <p className="text-[15px] font-extrabold tracking-[-.03em]">
              TrainHub<span className="text-primary">360</span>
            </p>
            <p className="font-mono text-[9px] uppercase tracking-[.16em] text-muted-foreground">password reset</p>
          </div>
        </div>

        {state === 'checking' && <p className="mt-8 text-sm text-muted-foreground">Checking your link…</p>}

        {state === 'missing' && (
          <div className="mt-8">
            <h1 className="text-lg font-bold">This link is incomplete</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              A reset link must include a token. Use the link from your reset email again, or request a new one from
              the sign-in page.
            </p>
            <Button className="mt-6 w-full" variant="outline" onClick={onDone}>
              Back to sign in
            </Button>
          </div>
        )}

        {state === 'done' && (
          <div className="mt-8">
            <h1 className="text-lg font-bold">Password updated</h1>
            <p className="mt-2 text-sm text-muted-foreground">Sign in with your new password.</p>
            <Button className="mt-6 w-full" onClick={onDone}>
              Go to sign in
            </Button>
          </div>
        )}

        {state === 'ready' && (
          <form className="mt-8 space-y-4" onSubmit={submit}>
            <div>
              <h1 className="text-lg font-bold">Choose a new password</h1>
              <p className="mt-1 text-sm text-muted-foreground">At least 8 characters. The link works once.</p>
            </div>
            <label className="block text-xs font-semibold">
              New password
              <Input className="mt-1.5" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required minLength={8} />
            </label>
            <label className="block text-xs font-semibold">
              Confirm password
              <Input className="mt-1.5" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required minLength={8} />
            </label>
            {error && (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
            <Button className="w-full" type="submit" disabled={busy || !token}>
              <KeyRound className="mr-2 size-4" />
              {busy ? 'Updating…' : 'Set new password'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

export default ResetPassword;
