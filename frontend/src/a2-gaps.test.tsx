// @vitest-environment jsdom
// Round 7 / A.2 gaps — the frontend half of the fixes.
//   4. the reset link lands on a real page that posts the token and the new password
//   5. People shows who has not activated and offers "Resend invite"
//   6. the bell's badge is populated on load, without opening the panel
import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ResetPassword } from "@/pages/ResetPassword";
import { NotificationBell } from "@/components/NotificationBell";
import { People } from "@/pages/People";
import { Login } from "@/pages/Login";

function Providers({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("A.2 gap 4 — the password-reset page", () => {
  function setPath(search: string) {
    window.history.replaceState(null, "", `/reset-password${search}`);
  }

  test("says so when the link has no token", async () => {
    setPath("");
    render(<Providers><ResetPassword onDone={() => {}} /></Providers>);
    expect(await screen.findByText(/link is incomplete/i)).toBeTruthy();
  });

  test("posts the token from the link and the new password, then reports success", async () => {
    setPath("?token=reset-abc");
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    render(<Providers><ResetPassword onDone={() => {}} /></Providers>);

    fireEvent.change(await screen.findByLabelText(/new password/i), { target: { value: "correct-horse" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "correct-horse" } });
    fireEvent.click(screen.getByRole("button", { name: /set new password/i }));

    expect(await screen.findByText(/password updated/i)).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/auth/reset-password");
    expect(calls[0].body).toEqual({ token: "reset-abc", newPassword: "correct-horse" });
  });

  test("refuses mismatched passwords without calling the API", async () => {
    setPath("?token=reset-abc");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<Providers><ResetPassword onDone={() => {}} /></Providers>);

    fireEvent.change(await screen.findByLabelText(/new password/i), { target: { value: "correct-horse" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "battery-staple" } });
    fireEvent.click(screen.getByRole("button", { name: /set new password/i }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("shows the server's message for an expired token", async () => {
    setPath("?token=stale");
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse({ error: "invalid or expired token" }, 400)));
    render(<Providers><ResetPassword onDone={() => {}} /></Providers>);

    fireEvent.change(await screen.findByLabelText(/new password/i), { target: { value: "correct-horse" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "correct-horse" } });
    fireEvent.click(screen.getByRole("button", { name: /set new password/i }));

    expect((await screen.findByRole("alert")).textContent).toContain("invalid or expired token");
  });

  test("the login page no longer asks for a pasted token or mentions the console", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(jsonResponse({ sent: true })));
    vi.stubGlobal("fetch", fetchSpy);
    render(<Providers><Login onDone={() => {}} /></Providers>);

    fireEvent.click(screen.getByRole("button", { name: /forgot password/i }));
    fireEvent.change(screen.getByLabelText(/work email/i), { target: { value: "someone@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /send reset link/i }));

    await waitFor(() => expect(screen.getByText(/reset link has been sent/i)).toBeTruthy());
    expect(screen.queryByLabelText(/reset token/i)).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/backend console/i);
  });
});

describe("A.2 gap 6 — the bell's badge is populated before the panel is opened", () => {
  const rows = [
    { id: "n1", userId: "u1", orgId: "o1", type: "session_invite", title: "Invitation: Safety Basics", body: null, link: "/calendar", readAt: null, createdAt: new Date().toISOString() },
  ];

  test("the badge shows the server count on load, and the list is not fetched yet", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      requested.push(url);
      return Promise.resolve(jsonResponse({ items: rows, unread: 3 }));
    });
    render(<Providers><NotificationBell onNavigate={() => {}} /></Providers>);

    const button = await screen.findByRole("button", { name: /notifications, 3 unread/i });
    expect(button.textContent).toContain("3");
    expect(requested.some((u) => u.includes("unread=true"))).toBe(true);
    expect(requested.some((u) => u.includes("limit=20"))).toBe(false);
  });
});

describe("A.2 gap 5 — People shows activation state and can resend an invite", () => {
  const directory = [
    { id: "u1", name: "Activated Person", email: "active@example.com", department: null, jobFunction: null, isActive: true, activatedAt: new Date().toISOString(), roles: [] },
    { id: "u2", name: "Invited Person", email: "invited@example.com", department: null, jobFunction: null, isActive: true, activatedAt: null, roles: [] },
  ];

  test("shows the activation state and resends the invitation for the unactivated user", async () => {
    localStorage.setItem("th360_user", JSON.stringify({ id: "staff-1", role: "admin", name: "Staff", isOrgStaff: true }));
    const calls: string[] = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("resend-activation")) return Promise.resolve(jsonResponse({ ok: true, emailSent: true }));
      if (url.startsWith("/api/users")) return Promise.resolve(jsonResponse(directory));
      // BulkImportButton calls useWorkspace(); an array here crashes its dialog.
      if (url.startsWith("/api/workspace")) {
        return Promise.resolve(jsonResponse({ user: { id: "staff-1", role: "admin", name: "Staff", isOrgStaff: true }, organization: { id: "o1", name: "Org", plan: "pro" }, dataSource: "mssql" }));
      }
      return Promise.resolve(jsonResponse([]));
    });
    render(<Providers><People /></Providers>);

    expect(await screen.findByTestId("row-user-u1")).toBeTruthy();
    expect(screen.getAllByText("activated").length).toBeGreaterThan(0);
    expect(await screen.findByText("invited")).toBeTruthy();
    // Only the unactivated user has a resend action.
    expect(screen.queryByTestId("button-resend-activation-u1")).toBeNull();
    fireEvent.click(screen.getByTestId("button-resend-activation-u2"));
    await waitFor(() => expect(screen.getByTestId("text-directory-notice").textContent).toContain("invited@example.com"));
    expect(calls.some((c) => c.startsWith("POST /api/users/u2/resend-activation"))).toBe(true);
  });
});
