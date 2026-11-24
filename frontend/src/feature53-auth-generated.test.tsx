// @vitest-environment jsdom
import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Login } from "@/pages/Login";
import { Register } from "@/pages/Register";
import { Activate } from "@/pages/Activate";
import { ResetPassword } from "@/pages/ResetPassword";

function Providers({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function harness(handler: (url: string, method: string, body: unknown) => Response | Promise<Response>) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    return handler(url, method, body);
  });
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("Feature 5.3 phase 4 — generated auth UI", () => {
  test("login uses the generated client and stores the returned session", async () => {
    const user = { id: "u1", name: "Learner One", email: "learner@example.com", role: "learner", initials: "LO", isOrgStaff: false };
    const calls = harness((url) => url === "/api/auth/login" ? json({ accessToken: "token-1", user }) : json({}));
    const done = vi.fn();
    render(<Providers><Login onDone={done} /></Providers>);

    fireEvent.change(screen.getByLabelText(/work email/i), { target: { value: "learner@example.com" } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "correct-horse" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(calls.some((call) => call.url === "/api/auth/login" && call.method === "POST")).toBe(true);
    expect(calls.find((call) => call.url === "/api/auth/login")?.body).toEqual({ email: "learner@example.com", password: "correct-horse" });
    expect(localStorage.getItem("th360_token")).toBe("token-1");
    expect(JSON.parse(localStorage.getItem("th360_user") ?? "{}")).toMatchObject({ id: "u1", role: "learner" });
  });

  test("registration posts the typed organization body through the generated client", async () => {
    const calls = harness((url) => url === "/api/organizations" ? json({ orgId: "o1", domainVerified: false }, 201) : json({}));
    const done = vi.fn();
    render(<Providers><Register onDone={done} onBack={() => {}} /></Providers>);

    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: "Northstar" } });
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: "Ava Mokoena" } });
    fireEvent.change(screen.getByLabelText(/work email/i), { target: { value: "ava@example.com" } });
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: "correct-horse" } });
    fireEvent.click(screen.getByRole("button", { name: /create organization/i }));

    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(calls.find((call) => call.url === "/api/organizations")?.body).toEqual({
      name: "Northstar", adminName: "Ava Mokoena", adminEmail: "ava@example.com", domain: "", adminPassword: "correct-horse",
    });
  });

  test("activation and reset send newPassword to match the documented contract", async () => {
    window.history.replaceState(null, "", "/activate?token=activate-1");
    const calls = harness((url) => json({ ok: true }));
    const { unmount } = render(<Providers><Activate onDone={() => {}} /></Providers>);
    fireEvent.change(await screen.findByLabelText(/new password/i), { target: { value: "correct-horse" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "correct-horse" } });
    fireEvent.click(screen.getByRole("button", { name: /activate account/i }));
    await waitFor(() => expect(calls.some((call) => call.url === "/api/auth/activate")).toBe(true));
    expect(calls.find((call) => call.url === "/api/auth/activate")?.body).toEqual({ token: "activate-1", newPassword: "correct-horse" });
    unmount();

    window.history.replaceState(null, "", "/reset-password?token=reset-1");
    const resetCalls = harness((url) => json({ ok: true }));
    render(<Providers><ResetPassword onDone={() => {}} /></Providers>);
    fireEvent.change(await screen.findByLabelText(/new password/i), { target: { value: "battery-staple" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "battery-staple" } });
    fireEvent.click(screen.getByRole("button", { name: /set new password/i }));
    await waitFor(() => expect(resetCalls.some((call) => call.url === "/api/auth/reset-password")).toBe(true));
    expect(resetCalls.find((call) => call.url === "/api/auth/reset-password")?.body).toEqual({ token: "reset-1", newPassword: "battery-staple" });
  });
});
