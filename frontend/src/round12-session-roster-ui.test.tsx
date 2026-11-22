// @vitest-environment jsdom
import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SessionRosterPanel, canManageSessionRoster } from "@/components/SessionRosterPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

function Providers({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

type Call = { url: string; method: string; body: unknown };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function bodyOf(init?: RequestInit): unknown {
  if (!init?.body) return undefined;
  try {
    return JSON.parse(String(init.body));
  } catch {
    return String(init.body);
  }
}

const roster = {
  sessionId: "s1",
  capacity: 1,
  attendeeCount: 1,
  seatsTaken: 1,
  seatsRemaining: 0,
  invited: 1,
  confirmed: 1,
  waitlisted: 1,
  declined: 0,
  attendees: [
    { id: "u1", rsvpId: "r1", learnerId: "l1", name: "Ada Learner", email: "ada@example.com", isActive: true, status: "confirmed", respondedAt: "2026-11-22T10:00:00.000Z", waitlistedAt: null, createdAt: "2026-11-21T10:00:00.000Z" },
    { id: "u2", rsvpId: "r2", learnerId: "l2", name: "Ben Learner", email: "ben@example.com", isActive: true, status: "waitlisted", respondedAt: null, waitlistedAt: "2026-11-22T10:00:00.000Z", createdAt: "2026-11-21T10:00:00.000Z" },
  ],
  summary: { sessionId: "s1", capacity: 1, attendeeCount: 1, seatsTaken: 1, seatsRemaining: 0, invited: 1, confirmed: 1, waitlisted: 1, declined: 0 },
};

const invitable = {
  sessionId: "s1",
  learners: [{ learnerId: "l3", id: "u3", name: "Cleo Learner", email: "cleo@example.com", eligible: true, reason: null }],
  invitable: [{ learnerId: "l3", id: "u3", name: "Cleo Learner", email: "cleo@example.com", eligible: true, reason: null }],
  invitableLearners: [{ learnerId: "l3", id: "u3", name: "Cleo Learner", email: "cleo@example.com", eligible: true, reason: null }],
  skipped: [{ learnerId: "l9", name: "Skip Learner", email: "skip@example.com", reason: "already_invited" }],
};

function harness(options: { roster?: unknown } = {}) {
  const calls: Call[] = [];
  let currentRoster = options.roster ?? roster;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: bodyOf(init) });
    const path = String(url);
    if (path.includes("/sessions/s1/attendees") && (init?.method ?? "GET") === "GET") return jsonResponse(currentRoster);
    if (path.includes("/sessions/s1/invitable")) return jsonResponse(invitable);
    if (path.includes("/sessions/s1/invite")) {
      return jsonResponse({ sessionId: "s1", invited: 1, newlyInvited: 1, skipped: ["l9"], skippedReasons: { l9: "already_invited" }, rejected: [], results: [] });
    }
    if (path.includes("/sessions/s1/remove")) {
      currentRoster = {
        ...roster,
        attendees: [roster.attendees[1]],
        summary: { ...roster.summary, confirmed: 1, waitlisted: 0, attendeeCount: 1 },
      };
      return jsonResponse(currentRoster);
    }
    if (path.includes("/sessions/s1/cancel")) return jsonResponse({ status: "cancelled" });
    if (path.includes("/sessions/s1")) return jsonResponse({ status: "scheduled" });
    return jsonResponse({});
  });
  return { calls };
}

describe("session roster UI", () => {
  test("shows capacity, status groups, eligible learners and skipped reasons", async () => {
    harness();
    render(<Providers><SessionRosterPanel sessionId="s1" sessionTitle="Safety briefing" /></Providers>);

    const summary = await screen.findByTestId("roster-summary");
    expect(summary.textContent).toContain("confirmed");
    expect(summary.textContent).toContain("waitlisted");
    expect((await screen.findByTestId("roster-capacity")).textContent).toContain("1/1 seats");
    expect(await screen.findByTestId("invitable-l3")).toBeTruthy();
    expect((await screen.findByTestId("invitable-skipped")).textContent).toContain("already invited");
    expect((await screen.findByTestId("attendee-l1")).textContent).toContain("Ada Learner");
    expect((await screen.findByTestId("attendee-l2")).textContent).toContain("waitlisted");
  });

  test("invites selected learners and exposes skip reasons", async () => {
    const { calls } = harness();
    render(<Providers><SessionRosterPanel sessionId="s1" sessionTitle="Safety briefing" /></Providers>);

    const learner = await screen.findByTestId("invitable-l3");
    fireEvent.click(within(learner).getByRole("checkbox"));
    fireEvent.click(screen.getByTestId("button-invite-selected"));

    await waitFor(() => expect(calls.some((call) => call.url.includes("/sessions/s1/invite"))).toBe(true));
    const inviteCall = calls.find((call) => call.url.includes("/sessions/s1/invite"));
    expect(inviteCall?.method).toBe("POST");
    expect(inviteCall?.body).toEqual({ learnerIds: ["l3"] });
    expect((await screen.findByTestId("roster-message")).textContent).toContain("1 invited, 1 skipped");
    expect((await screen.findByTestId("roster-message")).textContent).toContain("l9: already_invited");
  });

  test("removes an attendee with a reason and reports waitlist promotion", async () => {
    const { calls } = harness();
    render(<Providers><SessionRosterPanel sessionId="s1" sessionTitle="Safety briefing" /></Providers>);

    await screen.findByTestId("attendee-l1");
    fireEvent.change(screen.getByTestId("input-session-reason"), { target: { value: "Schedule conflict" } });
    fireEvent.click(screen.getByTestId("remove-attendee-l1"));

    await waitFor(() => expect(calls.some((call) => call.url.includes("/sessions/s1/remove"))).toBe(true));
    const removeCall = calls.find((call) => call.url.includes("/sessions/s1/remove"));
    expect(removeCall?.body).toEqual({ learnerId: "l1", reason: "Schedule conflict" });
    expect((await screen.findByTestId("roster-message")).textContent).toContain("waitlist promotion completed");
  });

  test("sends reasons with session edits and cancellation", async () => {
    const { calls } = harness();
    render(<Providers><SessionRosterPanel sessionId="s1" sessionTitle="Safety briefing" /></Providers>);

    fireEvent.change(screen.getByTestId("input-session-roster-title"), { target: { value: "Safety briefing updated" } });
    fireEvent.change(screen.getByTestId("input-session-reason"), { target: { value: "Room changed" } });
    fireEvent.click(screen.getByTestId("button-update-session"));

    await waitFor(() => expect(calls.some((call) => call.method === "PATCH" && call.url.includes("/sessions/s1"))).toBe(true));
    const patchCall = calls.find((call) => call.method === "PATCH" && call.url.includes("/sessions/s1"));
    expect(patchCall?.body).toEqual({ title: "Safety briefing updated", reason: "Room changed" });

    fireEvent.click(screen.getByTestId("button-cancel-session"));
    await waitFor(() => expect(calls.some((call) => call.url.includes("/sessions/s1/cancel"))).toBe(true));
    const cancelCall = calls.find((call) => call.url.includes("/sessions/s1/cancel"));
    expect(cancelCall?.body).toEqual({ reason: "Room changed" });
  });

  test("only exposes roster controls to programme staff", () => {
    expect(canManageSessionRoster(null)).toBe(false);
    expect(canManageSessionRoster({ role: "learner" })).toBe(false);
    expect(canManageSessionRoster({ role: "stakeholder" })).toBe(false);
    expect(canManageSessionRoster({ role: "trainer" })).toBe(true);
    expect(canManageSessionRoster({ role: "admin" })).toBe(true);
    expect(canManageSessionRoster({ role: "learner", isOrgStaff: true })).toBe(true);
  });
});
