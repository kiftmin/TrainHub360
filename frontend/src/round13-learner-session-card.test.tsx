// @vitest-environment jsdom
import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { CalendarPage } from "@/pages/Calendar";
import type { TrainingSession } from "@/api/hooks";

function Providers({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const base = {
  programme: "Safety",
  date: "2026-12-15",
  time: "10:00",
  mode: "online",
  attendees: 3,
  status: "scheduled",
  sequence: 1,
  canJoin: true,
} as const;

const sessions: TrainingSession[] = [
  { ...base, id: "s1", title: "Confirmed session", myRsvpStatus: "confirmed", myWaitlistPosition: null, icsUrl: "/api/sessions/s1/ics", cancellationReason: null, enrolled: false, joinUrl: "https://example.com/join", location: "Room 1" },
  { ...base, id: "s2", title: "Waitlisted session", myRsvpStatus: "waitlisted", myWaitlistPosition: 2, icsUrl: "/api/sessions/s2/ics", cancellationReason: null, enrolled: false, joinUrl: null, location: null },
  { ...base, id: "s3", title: "Cancelled session", status: "cancelled", myRsvpStatus: "invited", myWaitlistPosition: null, icsUrl: "/api/sessions/s3/ics", cancellationReason: "Venue closed", enrolled: false, canJoin: false, joinUrl: null, location: null },
  { ...base, id: "s4", title: "Unrelated session", myRsvpStatus: null, myWaitlistPosition: null, icsUrl: "/api/sessions/s4/ics", cancellationReason: null, enrolled: false, canJoin: false, joinUrl: null, location: null },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

function harness() {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const call = { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    if (url === "/api/sessions") return jsonResponse(sessions);
    if (url.startsWith("/api/sessions/") && url.endsWith("/rsvp")) return jsonResponse({ ok: true });
    if (url.startsWith("/api/sessions/") && url.endsWith("/ics")) {
      return new Response("BEGIN:VCALENDAR", { headers: { "content-type": "text/calendar" } });
    }
    return jsonResponse([]);
  });
  Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:ics"), configurable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  return calls;
}

describe("Round 13 — learner session cards", () => {
  test("shows RSVP state, waitlist position, cancel reason and only visible join details", async () => {
    localStorage.setItem("th360_user", JSON.stringify({ id: "u1", role: "learner", name: "Learner" }));
    harness();
    render(<Providers><CalendarPage /></Providers>);

    const confirmed = await screen.findByTestId("learner-session-s1");
    expect(confirmed.textContent).toContain("RSVP: confirmed");
    expect(screen.getByTestId("join-link-s1")).toBeTruthy();
    expect(screen.getByTestId("location-s1").textContent).toContain("Room 1");
    expect(screen.getByTestId("waitlist-position-s2").textContent).toContain("#2");
    expect(screen.getByTestId("cancel-reason-s3").textContent).toContain("Venue closed");
    expect(screen.queryByTestId("learner-session-s4")).toBeNull();
    expect(screen.queryByTestId("join-link-s3")).toBeNull();
  });

  test("Confirm, Decline and per-session .ics are actionable", async () => {
    localStorage.setItem("th360_user", JSON.stringify({ id: "u1", role: "learner", name: "Learner" }));
    const calls = harness();
    render(<Providers><CalendarPage /></Providers>);

    fireEvent.click(await screen.findByTestId("confirm-s1"));
    fireEvent.click(screen.getByTestId("decline-s2"));
    fireEvent.click(screen.getByTestId("ics-s1"));

    await waitFor(() => {
      expect(calls.some((c) => c.url === "/api/sessions/s1/rsvp" && c.method === "POST" && (c.body as { status?: string }).status === "confirmed")).toBe(true);
      expect(calls.some((c) => c.url === "/api/sessions/s2/rsvp" && c.method === "POST" && (c.body as { status?: string }).status === "declined")).toBe(true);
      expect(calls.some((c) => c.url === "/api/sessions/s1/ics")).toBe(true);
    });
  });
});
