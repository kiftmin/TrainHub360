// @vitest-environment jsdom
import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Messages } from "@/pages/Messages";

function Providers({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const thread = {
  id: "t1",
  subject: "Module 2 question",
  context: "course",
  participant: "Coach T",
  preview: "Ask when you are ready.",
  updatedAt: "2026-11-24T10:00:00.000Z",
  unread: false,
  urgent: false,
  orgId: "o1",
  programmeId: "p1",
  courseId: "c1",
  course: { id: "c1", title: "Safety" },
  slaHours: 12,
  participants: [{ userId: "learner-1", role: "learner" }, { userId: "trainer-1", role: "trainer" }],
  isEscalated: false,
  escalatedAt: null,
  lastLearnerMessageAt: "2026-11-24T09:00:00.000Z",
  lastTrainerResponseAt: null,
  metadataOnly: false,
  averageResponseTimeHours: 3.5,
  slaStatus: "Usually responds within 12 hours.",
  slaState: "ok",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Feature 5.3 phase 4 — learner trainer DMs", () => {
  test("learners may message trainers and see the response promise, but never edit SLA", async () => {
    localStorage.setItem("th360_token", "token");
    localStorage.setItem("th360_user", JSON.stringify({ id: "learner-1", role: "learner", name: "Learner", isOrgStaff: false }));
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (url === "/api/threads" && method === "GET") return Promise.resolve(json([thread]));
      if (url === "/api/threads" && method === "POST") return Promise.resolve(json({ ...thread, id: "t2" }, 201));
      if (url === "/api/programmes") return Promise.resolve(json([{ id: "p1", name: "Programme 1" }]));
      if (url.startsWith("/api/programmes/p1/members")) {
        return Promise.resolve(json([
          { userId: "learner-2", name: "Other Learner", email: "learner2@example.com", role: "learner" },
          { userId: "trainer-1", name: "Coach T", email: "trainer@example.com", role: "trainer" },
        ]));
      }
      if (url.startsWith("/api/courses")) return Promise.resolve(json([{ id: "c1", title: "Safety" }]));
      if (url.startsWith("/api/threads/t1/messages")) return Promise.resolve(json([]));
      return Promise.resolve(json([]));
    });

    render(<Providers><Messages /></Providers>);
    expect((await screen.findByTestId("sla-promise")).textContent).toContain("Usually replies within 12 hours.");
    expect(screen.queryByTestId("sla-editor")).toBeNull();
    expect(screen.queryByTestId("button-run-sla")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /new message/i }));
    fireEvent.change(await screen.findByTestId("select-thread-programme"), { target: { value: "p1" } });
    const participants = await screen.findByTestId("list-thread-participants");
    await waitFor(() => expect(within(participants).queryByRole("checkbox")).toBeTruthy());
    expect(within(participants).queryByText(/Other Learner/)).toBeNull();
    expect(within(participants).getByText(/Coach T/)).toBeTruthy();
    expect(screen.queryByTestId("input-new-thread-sla-hours")).toBeNull();

    fireEvent.change(screen.getByTestId("input-thread-subject"), { target: { value: "Help with module 2" } });
    fireEvent.change(screen.getByTestId("input-thread-body"), { target: { value: "Can we review this?" } });
    fireEvent.click(within(participants).getByRole("checkbox"));
    fireEvent.click(screen.getByTestId("button-create-thread"));

    await waitFor(() => expect(calls.some((call) => call.url === "/api/threads" && call.method === "POST")).toBe(true));
    expect(calls.find((call) => call.url === "/api/threads" && call.method === "POST")?.body).toEqual({
      subject: "Help with module 2",
      body: "Can we review this?",
      programmeId: "p1",
      participantIds: ["trainer-1"],
      urgent: false,
    });
  });
});
