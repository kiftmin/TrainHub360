import { useState } from "react";
import { setSession } from "../api/client";

export function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("admin@example.com");
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
        body: JSON.stringify({ email, password: "x" }),
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
    <div className="card" style={{ maxWidth: 380, margin: "80px auto" }}>
      <h1>Sign in</h1>
      <p>Use your seeded admin email to get a session token.</p>
      <form onSubmit={submit}>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          type="email"
          required
          style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid var(--border)", background: "hsla(0,0%,100%,.05)", color: "inherit", marginBottom: 12 }}
        />
        {error && <p style={{ color: "#f87171" }}>{error}</p>}
        <button className="btn" disabled={busy} style={{ width: "100%" }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
