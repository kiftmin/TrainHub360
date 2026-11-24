// @vitest-environment jsdom
import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MyLearning } from "@/pages/MyLearning";

function Providers({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const dashboard = {
  learner: { id: "u1", name: "Learner One", email: "learner@example.com", department: null, jobFunction: null },
  summary: { assignedCourses: 1, completedCourses: 0, overallProgress: 25, outstandingActivities: 2, pendingVerifications: 1, unreadNotifications: 1, unreadMessages: 0 },
  courses: [{ enrolmentId: "e1", courseId: "c1", title: "Safety", programmeId: "p1", programmeName: "Programme", status: "enrolled", progress: 25, dueDate: null, deadlineDate: null, completionDate: null, completionSource: null, competent: false, competenceStatus: "in_progress", counts: { totalContent: 1, completedContent: 0, inProgressContent: 0, requiredOutstanding: 1, pendingVerification: 0, assessmentsOutstanding: 1, awaitingGrading: 0 }, modules: [{ id: "m1", title: "Module", total: 1, completed: 0, progress: 0 }], assessments: [], nextContentItemId: "item1" }],
  upcomingSessions: [{ id: "s1", title: "Coaching", startsAt: "2026-12-15T10:00:00.000Z", endsAt: null, timezone: "UTC", mode: "online", trainer: "Trainer", courseId: "c1", programmeId: "p1", myRsvpStatus: "confirmed", icsUrl: "/api/sessions/s1/ics" }],
  latestResults: [{ attemptId: "a1", assessmentId: "assessment1", assessmentTitle: "Knowledge check", assessmentType: "recall", courseTitle: "Safety", attemptNumber: 1, status: "graded", submittedAt: "2026-11-01T10:00:00.000Z", gradedAt: "2026-11-01T11:00:00.000Z", score: 8, percent: 80, passed: true, passMark: 70, awaitingGrading: false }],
  certificates: [{ id: "cert1", certificateNumber: "CERT-1", courseId: "c1", courseTitle: "Safety", enrolmentId: "e1", issuedAt: "2026-11-02T10:00:00.000Z", expiresAt: null, status: "active", active: true, printUrl: "/api/certificates/cert1/print" }],
  pendingVerifications: [{ id: "cp1", contentItemId: "item2", contentTitle: "Evidence", courseId: "c1", courseTitle: "Safety", enrolmentId: "e1", submittedAt: null }],
  nextActions: [{ id: "content-e1", type: "continue_content", title: "Continue learning", detail: "Watch the video", href: "/my-learning", priority: 10 }],
  notifications: [{ id: "n1", type: "test", title: "Reminder", body: "Finish content", link: null, createdAt: "2026-11-01T10:00:00.000Z" }],
  messages: [],
};

const content = {
  courseId: "c1",
  progress: 25,
  modules: [{ id: "m1", title: "Module", order: 1, contentItems: [{ id: "item1", type: "native", title: "Watch the video", description: null, order: 1, required: true, estimatedMinutes: 5, body: "Body", fileName: null, mimeType: null, sizeBytes: null, url: null, provider: null, completionMode: "auto", isArchived: false, progress: { status: "not_started", completedAt: null, verifiedAt: null } }] }],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function harness() {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  vi.stubGlobal("fetch", (input: string, init?: RequestInit) => {
    const url = input;
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === "/api/me/learner-dashboard") return jsonResponse(dashboard);
    if (url === "/api/courses/c1/content") return jsonResponse(content);
    if (url === "/api/content/item1/progress") return jsonResponse({ id: "cp2", enrolmentId: "e1", contentItemId: "item1", status: "completed", enrolmentProgress: 100 });
    return jsonResponse([]);
  });
  localStorage.setItem("th360_token", "token");
  return calls;
}

describe("Feature 5.3 — learner dashboard UI", () => {
  test("renders state-derived dashboard data from the generated client", async () => {
    harness();
    render(<Providers><MyLearning /></Providers>);
    expect(await screen.findByTestId("learner-summary")).toBeTruthy();
    expect(screen.getByTestId("learner-summary").textContent).toContain("25%");
    expect(screen.getByTestId("next-actions-heading")).toBeTruthy();
    expect(await screen.findByTestId("next-action")).toBeTruthy();
    expect(screen.getByText("Coaching")).toBeTruthy();
  });

  test("progress, results and certificates tabs expose learner records", async () => {
    harness();
    render(<Providers><MyLearning /></Providers>);
    await screen.findByTestId("learner-summary");

    fireEvent.click(screen.getByTestId("tab-progress"));
    expect(await screen.findByTestId("progress-panel")).toBeTruthy();
    expect(await screen.findByText(/Watch the video/)).toBeTruthy();

    fireEvent.click(screen.getByTestId("tab-results"));
    expect(screen.getByTestId("results-panel").textContent).toContain("Knowledge check");

    fireEvent.click(screen.getByTestId("tab-certificates"));
    expect(screen.getByTestId("certificate-print")).toBeTruthy();
  });

  test("marking content complete posts through the generated progress mutation", async () => {
    const calls = harness();
    render(<Providers><MyLearning /></Providers>);
    await screen.findByTestId("learner-summary");
    fireEvent.click(screen.getByTestId("tab-progress"));
    fireEvent.click(await screen.findByRole("button", { name: "Mark complete" }));
    await waitFor(() => {
      expect(calls.some((call) => call.url === "/api/content/item1/progress" && call.method === "POST" && (call.body as { status?: string }).status === "completed")).toBe(true);
    });
  });
});
