import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { setSession } from "../api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error(`Login failed (${res.status})`);
      const data = await res.json();
      setSession(data.accessToken, data.user);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grain app-shell flex min-h-[100dvh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border/80 bg-card p-8 shadow-[0_20px_60px_rgba(25,51,57,.08)]">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground"><ShieldCheck className="size-5" /></div>
          <div>
            <p className="text-lg font-extrabold tracking-[-.03em]">TrainHub<span className="text-primary">360</span></p>
            <p className="font-mono text-[9px] uppercase tracking-[.16em] text-muted-foreground">readiness OS</p>
          </div>
        </div>
        <h1 className="mt-6 text-2xl font-extrabold tracking-[-.03em]">Welcome back.</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign in with your seeded admin email to open the workspace.</p>
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
          <p className="text-center font-mono text-[10px] text-muted-foreground">JWT stored in localStorage · th360_token</p>
        </form>
      </div>
    </div>
  );
}
