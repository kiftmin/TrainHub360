// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Activate } from "@/pages/Activate";
import { NotificationBell } from "@/components/NotificationBell";

function Providers({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The shared api client reads `res.headers.get("content-type")`, so stubs must be real
// Response objects rather than {ok, status, json} shapes.
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function setUrl(search: string) {
  window.history.replaceState(null, "", `/activate${search}`);
}

describe("A.2 activation page", () => {
  test("says so when the link has no token", async () => {
    setUrl("");
    render(<Providers><Activate onDone={() => {}} /></Providers>);
    expect(await screen.findByText(/link is incomplete/i)).toBeTruthy();
  });

  test("posts the token and the new password, then reports success", async () => {
    setUrl("?token=tok-abc");
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    render(<Providers><Activate onDone={() => {}} /></Providers>);

    fireEvent.change(await screen.findByLabelText(/new password/i), { target: { value: "correct-horse" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "correct-horse" } });
    fireEvent.click(screen.getByRole("button", { name: /activate account/i }));

    expect(await screen.findByText(/account activated/i)).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/auth/activate");
    expect(calls[0].body).toEqual({ token: "tok-abc", newPassword: "correct-horse" });
  });

  test("refuses mismatched passwords without calling the API", async () => {
    setUrl("?token=tok-abc");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<Providers><Activate onDone={() => {}} /></Providers>);

    fireEvent.change(await screen.findByLabelText(/new password/i), { target: { value: "correct-horse" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "battery-staple" } });
    fireEvent.click(screen.getByRole("button", { name: /activate account/i }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("shows the server's message for an expired token", async () => {
    setUrl("?token=stale");
    vi.stubGlobal("fetch", () =>
      Promise.resolve(jsonResponse({ error: "invalid or expired activation token" }, 400)),
    );
    render(<Providers><Activate onDone={() => {}} /></Providers>);

    fireEvent.change(await screen.findByLabelText(/new password/i), { target: { value: "correct-horse" } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: "correct-horse" } });
    fireEvent.click(screen.getByRole("button", { name: /activate account/i }));

    expect((await screen.findByRole("alert")).textContent).toContain("invalid or expired activation token");
  });
});

describe("A.2 notification bell", () => {
  const rows = [
    { id: "n1", userId: "u1", orgId: "o1", type: "session_invite", title: "Invitation: Safety Basics", body: "Mon 10:00", link: "/calendar", readAt: null, createdAt: new Date().toISOString() },
    { id: "n2", userId: "u1", orgId: "o1", type: "certificate_expiring", title: "Certificate expiring", body: null, link: null, readAt: new Date().toISOString(), createdAt: new Date(Date.now() - 3600_000).toISOString() },
  ];

  test("shows the unread count and opens the list on click", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse({ items: rows, unread: 1 })));
    render(<Providers><NotificationBell onNavigate={() => {}} /></Providers>);

    // The badge count comes from the same request as the list, which is only made once the
    // panel opens; so the count appears after the first open, then stays.
    fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));
    expect(await screen.findByText("Invitation: Safety Basics")).toBeTruthy();
    expect(screen.getByText("Certificate expiring")).toBeTruthy();
    expect(screen.getByRole("button", { name: /notifications, 1 unread/i }).textContent).toContain("1");
  });

  test("navigates to the stored link and marks that one read", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      requested.push(url);
      if (url.includes("/read")) return Promise.resolve(jsonResponse({ ok: true }));
      return Promise.resolve(jsonResponse({ items: rows, unread: 1 }));
    });
    const navigated: string[] = [];
    render(<Providers><NotificationBell onNavigate={(p) => navigated.push(p)} /></Providers>);

    fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));
    fireEvent.click(await screen.findByText("Invitation: Safety Basics"));

    await waitFor(() => expect(navigated).toEqual(["/calendar"]));
    expect(requested.some((u) => u === "/api/notifications/n1/read")).toBe(true);
  });

  test("has no badge when everything is read, and an empty state", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(jsonResponse({ items: [], unread: 0 })));
    render(<Providers><NotificationBell onNavigate={() => {}} /></Providers>);

    const button = await screen.findByRole("button", { name: "Notifications" });
    expect(button.textContent).toBe("");
    fireEvent.click(button);
    expect(await screen.findByText(/nothing yet/i)).toBeTruthy();
  });
});
