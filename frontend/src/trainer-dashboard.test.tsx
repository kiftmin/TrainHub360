// @vitest-environment jsdom
import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Overview } from "@/pages/Overview";

function Providers({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const oneProgramme = {
  programmes: [{ id: "p1", name: "Alpha programme", courseCount: 1, learnerCount: 1, enrolmentCount: 1 }],
  courses: [{ id: "c1", title: "Alpha course", programmeId: "p1", programmeName: "Alpha programme", progress: 40, status: "live", dueDate: null, enrolmentCount: 1, completedEnrolmentCount: 0 }],
  learners: [{ id: "l1", name: "Learner One", programmeId: "p1", programmeName: "Alpha programme", enrolmentCount: 1, activeEnrolmentCount: 1, completedEnrolmentCount: 0 }],
  enrolments: [{ id: "e1", learnerId: "l1", learnerName: "Learner One", programmeId: "p1", programmeName: "Alpha programme", courseId: "c1", courseTitle: "Alpha course", status: "enrolled", progress: 40, completionDate: null }],
  sessions: [{ id: "s1", title: "Alpha session", programmeId: "p1", programmeName: "Alpha programme", courseId: "c1", courseTitle: "Alpha course", date: "2026-12-15", time: "10:00", startsAt: "2026-12-15T10:00:00.000Z", endsAt: null, status: "scheduled", mode: "online", attendees: 1, capacity: null }],
  summary: { programmeCount: 1, courseCount: 1, learnerCount: 1, enrolmentCount: 1, activeEnrolmentCount: 1, completedEnrolmentCount: 0, upcomingSessionCount: 1 },
};

const managerSummary = {
  complianceHealth: 80,
  completionRate: 60,
  competencyRate: 70,
  expiringCredentials: 1,
  dropOffRate: 20,
  timeToCompetency: 12,
  trainerUtilization: 50,
  weeklyActivity: [],
  dropOffHeatmap: [],
  expiringItems: [],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function harness(role: string, trainerBody: unknown = oneProgramme, trainerStatus = 200) {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    if (url === "/api/trainer/dashboard/summary") return json(trainerBody, trainerStatus);
    if (url === "/api/dashboard/summary") return json(managerSummary);
    if (url === "/api/workspace") return json({ organization: { id: "o1", name: "Northstar" }, activeProgramme: null, user: { id: "u1", name: "Manager", email: "manager@example.com", role }, dataSource: "mssql" });
    if (url === "/api/programmes") return json([]);
    return json([]);
  });
  localStorage.setItem("th360_token", "token");
  localStorage.setItem("th360_user", JSON.stringify({ id: "u1", name: `Test ${role}`, role, isOrgStaff: role === "admin" || role === "owner" }));
  return calls;
}

describe("Trainer overview", () => {
  test("loads the trainer dashboard without manager-only requests", async () => {
    const calls = harness("trainer");
    render(<Providers><Overview /></Providers>);
    expect(await screen.findByText("Alpha programme")).toBeTruthy();
    expect(screen.getByText("Alpha session")).toBeTruthy();
    expect(screen.getByText("Learner One")).toBeTruthy();
    await waitFor(() => {
      expect(calls.some((call) => call.url === "/api/trainer/dashboard/summary")).toBe(true);
    });
    expect(calls.some((call) => call.url === "/api/dashboard/summary")).toBe(false);
    expect(calls.some((call) => call.url === "/api/kpi/summary")).toBe(false);
    expect(calls.some((call) => call.url === "/api/programmes")).toBe(false);
    expect(calls.some((call) => call.url === "/api/sessions")).toBe(false);
    expect(calls.some((call) => call.url === "/api/workspace")).toBe(false);
  });

  test("shows data from every authorised programme", async () => {
    harness("trainer", {
      ...oneProgramme,
      programmes: [...oneProgramme.programmes, { id: "p2", name: "Beta programme", courseCount: 0, learnerCount: 0, enrolmentCount: 0 }],
      summary: { ...oneProgramme.summary, programmeCount: 2 },
    });
    render(<Providers><Overview /></Providers>);
    expect(await screen.findByText("Alpha programme")).toBeTruthy();
    expect(screen.getByText("Beta programme")).toBeTruthy();
  });

  test("presents 403 as an authorisation state, not a service failure", async () => {
    harness("trainer", { error: "trainer access required" }, 403);
    render(<Providers><Overview /></Providers>);
    expect(await screen.findByText("Trainer access required")).toBeTruthy();
    expect(screen.getByText("Your account is not an authorised trainer")).toBeTruthy();
    expect(screen.queryByText("Could not load this view")).toBeNull();
  });

  test("shows a retryable error state for server failures", async () => {
    harness("trainer", { error: "internal server error" }, 500);
    render(<Providers><Overview /></Providers>);
    expect(await screen.findByText("Could not load this view")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  test("shows empty states when a trainer has no programme data", async () => {
    harness("trainer", {
      programmes: [], courses: [], learners: [], enrolments: [], sessions: [],
      summary: { programmeCount: 0, courseCount: 0, learnerCount: 0, enrolmentCount: 0, activeEnrolmentCount: 0, completedEnrolmentCount: 0, upcomingSessionCount: 0 },
    });
    render(<Providers><Overview /></Providers>);
    expect(await screen.findByText("No assigned programmes")).toBeTruthy();
    expect(screen.getByText("No sessions scheduled")).toBeTruthy();
    expect(screen.getByText("No learners yet")).toBeTruthy();
  });

  test.each(["owner", "admin"])("keeps the existing organisation dashboard for %s", async (role) => {
    const calls = harness(role);
    render(<Providers><Overview /></Providers>);
    expect(await screen.findByText("Readiness, at a glance.")).toBeTruthy();
    await waitFor(() => {
      expect(calls.some((call) => call.url === "/api/dashboard/summary")).toBe(true);
    });
    expect(calls.some((call) => call.url === "/api/trainer/dashboard/summary")).toBe(false);
  });
});
