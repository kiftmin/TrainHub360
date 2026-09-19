import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function Register({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [form, setForm] = useState({ name: "", adminName: "", adminEmail: "", domain: "", adminPassword: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/organizations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Registration failed (${res.status})`);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-border/80 bg-card p-8 shadow-[0_20px_60px_rgba(25,51,57,.08)]">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground"><ShieldCheck className="size-5" /></div>
          <div>
            <p className="text-lg font-extrabold tracking-[-.03em]">TrainHub<span className="text-primary">360</span></p>
            <p className="font-mono text-[9px] uppercase tracking-[.16em] text-muted-foreground">readiness OS</p>
          </div>
        </div>
        <h1 className="mt-6 text-2xl font-extrabold tracking-[-.03em]">Create your organization.</h1>
        <p className="mt-1 text-sm text-muted-foreground">Self-service workspace setup with domain verification.</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-xs font-semibold">Organization name
            <Input className="mt-2" value={form.name} onChange={set("name")} placeholder="Northstar Logistics" required />
          </label>
          <label className="block text-xs font-semibold">Your name
            <Input className="mt-2" value={form.adminName} onChange={set("adminName")} placeholder="Ava Mokoena" required />
          </label>
          <label className="block text-xs font-semibold">Work email
            <Input className="mt-2" value={form.adminEmail} onChange={set("adminEmail")} placeholder="you@company.com" type="email" required />
          </label>
          <label className="block text-xs font-semibold">Company domain (optional)
            <Input className="mt-2" value={form.domain} onChange={set("domain")} placeholder="company.com" />
          </label>
          <label className="block text-xs font-semibold">Password
            <Input className="mt-2" value={form.adminPassword} onChange={set("adminPassword")} placeholder="••••••••" type="password" required />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-full bg-primary text-primary-foreground" disabled={busy}>
            {busy ? "Creating…" : "Create organization"}
          </Button>
          <button type="button" onClick={onBack} className="w-full text-center text-xs font-semibold text-primary hover:underline">
            Back to sign in
          </button>
        </form>
      </div>
    </div>
  );
}
