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
    { id: "u6", rsvpId: "r6", learnerId: "l6", name: "Removed Learner", email: "removed@example.com", isActive: true, status: "removed", respondedAt: "2026-11-22T11:00:00.000Z", waitlistedAt: null, removalReason: "Safety escalation", removedAt: "2026-11-22T11:00:00.000Z", removedBy: "u9", createdAt: "2026-11-21T10:00:00.000Z" },
  ],
  summary: { sessionId: "s1", capacity: 1, attendeeCount: 1, seatsTaken: 1, seatsRemaining: 0, invited: 1, confirmed: 1, waitlisted: 1, declined: 0, removed: 1 },
};

const learner3 = { learnerId: "l3", id: "u3", name: "Cleo Learner", email: "cleo@example.com", eligible: true, reason: null };
const invitable = {
  sessionId: "s1",
  q: "",
  limit: 50,
  total: 1,
  nextCursor: null,
  learners: [learner3],
  invitable: [learner3],
  invitableLearners: [learner3],
  skipped: [{ learnerId: "l9", name: "Skip Learner", email: "skip@example.com", reason: "already_invited" }],
};

const pageOne = {
  ...invitable,
  total: 2,
  nextCursor: "cursor-2",
};

const pageTwo = {
  ...invitable,
  total: 2,
  nextCursor: null,
  learners: [{ learnerId: "l4", id: "u4", name: "Dana Learner", email: "dana@example.com", eligible: true, reason: null }],
  invitable: [{ learnerId: "l4", id: "u4", name: "Dana Learner", email: "dana@example.com", eligible: true, reason: null }],
  invitableLearners: [{ learnerId: "l4", id: "u4", name: "Dana Learner", email: "dana@example.com", eligible: true, reason: null }],
  skipped: [],
};

const searchPage = {
  ...invitable,
  q: "dee",
  total: 1,
  nextCursor: null,
  learners: [{ learnerId: "l5", id: "u5", name: "Deep Learner", email: "deep@example.com", eligible: true, reason: null }],
  invitable: [{ learnerId: "l5", id: "u5", name: "Deep Learner", email: "deep@example.com", eligible: true, reason: null }],
  invitableLearners: [{ learnerId: "l5", id: "u5", name: "Deep Learner", email: "deep@example.com", eligible: true, reason: null }],
  skipped: [],
};

function harness(options: { roster?: unknown; invitable?: (url: string) => unknown } = {}) {
  const calls: Call[] = [];
  let currentRoster = options.roster ?? roster;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: bodyOf(init) });
    const path = String(url);
    if (path.includes("/sessions/s1/attendees") && (init?.method ?? "GET") === "GET") return jsonResponse(currentRoster);
    if (path.includes("/sessions/s1/invitable")) return jsonResponse(options.invitable?.(path) ?? invitable);
    if (path.includes("/sessions/s1/invite")) {
      return jsonResponse({ sessionId: "s1", allEnrolled: false, selectedCount: 1, invited: 1, newlyInvited: 1, skipped: ["l9"], skippedCount: 1, skippedReasons: { l9: "already_invited" }, rejected: [], results: [] });
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

  test("shows removed attendees with their reason and no remove control", async () => {
    harness();
    render(<Providers><SessionRosterPanel sessionId="s1" sessionTitle="Safety briefing" /></Providers>);

    const removed = await screen.findByTestId("attendee-l6");
    expect(removed.textContent).toContain("removed");
    expect((await screen.findByTestId("attendee-removal-reason-l6")).textContent).toContain("Safety escalation");
    expect(screen.queryByTestId("remove-attendee-l6")).toBeNull();
  });

  test("debounces search, loads more pages and shows the selected count", async () => {
    const { calls } = harness({
      invitable: (url) => {
        if (url.includes("q=dee")) return searchPage;
        if (url.includes("cursor=cursor-2")) return pageTwo;
        return pageOne;
      },
    });
    render(<Providers><SessionRosterPanel sessionId="s1" sessionTitle="Safety briefing" /></Providers>);

    await waitFor(() => expect(screen.getByTestId("invitable-total").textContent).toContain("2 eligible"));
    expect((await screen.findByTestId("invitable-selected-count")).textContent).toContain("0 selected");
    const learner = await screen.findByTestId("invitable-l3");
    fireEvent.click(within(learner).getByRole("checkbox"));
    expect((await screen.findByTestId("invitable-selected-count")).textContent).toContain("1 selected");

    fireEvent.click(await screen.findByTestId("button-invitable-more"));
    expect(await screen.findByTestId("invitable-l4")).toBeTruthy();
    expect((await screen.findByTestId("invitable-selected-count")).textContent).toContain("1 selected");
    await waitFor(() => expect(calls.some((call) => call.url.includes("cursor=cursor-2"))).toBe(true));

    fireEvent.change(screen.getByTestId("input-invitable-search"), { target: { value: "dee" } });
    await waitFor(() => expect(calls.some((call) => call.url.includes("q=dee"))).toBe(true));
    expect(await screen.findByTestId("invitable-l5")).toBeTruthy();
    expect(screen.queryByTestId("invitable-l3")).toBeNull();
    expect((await screen.findByTestId("invitable-selected-count")).textContent).toContain("0 selected");
  });

  test("invites all eligible learners in one batched request", async () => {
    const { calls } = harness();
    render(<Providers><SessionRosterPanel sessionId="s1" sessionTitle="Safety briefing" /></Providers>);

    await screen.findByTestId("invitable-l3");
    fireEvent.click(screen.getByTestId("button-invite-all"));

    await waitFor(() => expect(calls.some((call) => call.url.includes("/sessions/s1/invite"))).toBe(true));
    const inviteCall = calls.find((call) => call.url.includes("/sessions/s1/invite"));
    expect(inviteCall?.body).toEqual({ allEnrolled: true });
    expect((await screen.findByTestId("roster-message")).textContent).toContain("1 invited");
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
