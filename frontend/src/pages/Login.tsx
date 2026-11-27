import { useState } from "react";
import { ShieldCheck, KeyRound } from "lucide-react";
import { useLogin, useRequestPasswordReset, useSsoLogin } from "@api-client";
import { setSession } from "../api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Mode = "login" | "forgot";

export function Login({ onDone, onRegister }: { onDone: () => void; onRegister?: () => void }) {
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<Mode>("login");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ssoOpen, setSsoOpen] = useState(false);
  const [ssoOrgId, setSsoOrgId] = useState("");
  const [ssoAssertion, setSsoAssertion] = useState("");
  const [ssoBusy, setSsoBusy] = useState(false);
  const [ssoError, setSsoError] = useState<string | null>(null);
  const login = useLogin();
  const ssoLogin = useSsoLogin();
  const requestReset = useRequestPasswordReset();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await login.mutateAsync({ data: { email, password } });
      setSession(data.accessToken, data.user);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitSso(e: React.FormEvent) {
    e.preventDefault();
    setSsoBusy(true);
    setSsoError(null);
    try {
      const data = await ssoLogin.mutateAsync({ data: { orgId: ssoOrgId, samlAssertion: ssoAssertion } });
      setSession(data.accessToken, data.user);
      onDone();
    } catch (err) {
      setSsoError((err as Error).message);
    } finally {
      setSsoBusy(false);
    }
  }

  async function submitForgot(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await requestReset.mutateAsync({ data: { email } });
      // Round 7 gap 4: the email carries the token in its link and the frontend has a
      // /reset-password page now, so there is nothing to paste and nothing to look up in a
      // console the backend no longer writes to.
      setNotice("If an account exists for that email, a reset link has been sent. Open it from your inbox to choose a new password.");
      setMode("login");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-gradient-to-br from-secondary/40 via-background to-background p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/.08),transparent_45%)]" />
      <div className="relative w-full max-w-md rounded-2xl border border-border/70 bg-card p-8 shadow-[0_24px_60px_-24px_rgba(15,23,42,.18)]">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><ShieldCheck className="size-5" /></div>
          <div>
            <p className="text-lg font-bold tracking-[-.03em]">TrainHub<span className="text-primary">360</span></p>
            <p className="font-mono text-[9px] uppercase tracking-[.16em] text-muted-foreground">readiness OS</p>
          </div>
        </div>
        <h1 className="mt-6 text-2xl font-bold tracking-[-.02em]">Welcome back.</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign in with your seeded admin email to open the workspace.</p>
        {notice && <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</p>}
        {mode === "login" && (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-xs font-semibold">Work email
            <Input
              className="mt-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              type="email"
              required
            />
          </label>
          <label className="block text-xs font-semibold">Password
            <Input
              className="mt-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              type="password"
              required
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-full bg-primary text-primary-foreground" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          <div className="relative my-2"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border/70" /></div><div className="relative flex justify-center text-[11px]"><span className="bg-card px-2 text-muted-foreground">or</span></div></div>
          <Button type="button" variant="outline" className="w-full" onClick={() => { setSsoOpen(true); setError(null); }}>
            <KeyRound className="mr-2 size-4" />Sign in with SSO
          </Button>
          <button type="button" onClick={() => { setMode("forgot"); setError(null); }} className="w-full text-center text-xs font-semibold text-primary hover:underline">
            Forgot password?
          </button>
          {onRegister && (
            <button type="button" onClick={onRegister} className="w-full text-center text-xs font-semibold text-primary hover:underline">
              Create an organization
            </button>
          )}
        </form>
        )}
        {mode === "forgot" && (
        <form onSubmit={submitForgot} className="mt-6 space-y-4">
          <label className="block text-xs font-semibold">Work email
            <Input
              className="mt-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              type="email"
              required
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-full bg-primary text-primary-foreground" disabled={busy}>
            {busy ? "Sending…" : "Send reset link"}
          </Button>
          <button type="button" onClick={() => { setMode("login"); setError(null); }} className="w-full text-center text-xs font-semibold text-primary hover:underline">
            Back to sign in
          </button>
        </form>
        )}
      </div>

      <Dialog open={ssoOpen} onOpenChange={setSsoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign in with SSO</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitSso} className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground">Paste a base64-encoded SAML assertion from your identity provider. The assertion must contain the user's email and be signed with the IdP certificate configured on your organisation.</p>
            <label className="block text-xs font-semibold">Organisation ID
              <Input className="mt-2 font-mono text-xs" value={ssoOrgId} onChange={(e) => setSsoOrgId(e.target.value)} placeholder="org_xxxxxxxxxxxx" required />
            </label>
            <label className="block text-xs font-semibold">SAML assertion (base64)
              <textarea className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs" rows={5} value={ssoAssertion} onChange={(e) => setSsoAssertion(e.target.value)} placeholder="PHNhbWxwOlJlc3BvbnNlLi4." required />
            </label>
            {ssoError && <p className="text-sm text-destructive">{ssoError}</p>}
            <Button className="w-full" disabled={ssoBusy}>{ssoBusy ? "Authenticating…" : "Authenticate"}</Button>
            <p className="text-[11px] text-muted-foreground">Requires SSO_ENABLED=true and SAML config on the organisation record.</p>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
