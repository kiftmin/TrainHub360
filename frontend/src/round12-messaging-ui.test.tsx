// @vitest-environment jsdom
import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api } from "@/api/client";
import { canManageMessaging } from "@/components/MessagingStaffTools";
import { Messages } from "@/pages/Messages";

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

function signIn(role: string, isOrgStaff = false) {
  localStorage.setItem("th360_token", "test-token");
  localStorage.setItem("th360_user", JSON.stringify({ id: "me", role, name: "Test User", isOrgStaff }));
}

const baseThread = {
  id: "t1",
  subject: "Course question",
  context: "course",
  participant: "Learner A",
  preview: "How do I complete this?",
  updatedAt: "2026-11-22T10:00:00.000Z",
  unread: false,
  urgent: false,
  orgId: "o1",
  programmeId: "p1",
  courseId: "c1",
  course: { id: "c1", title: "Safety Course" },
  slaHours: 24,
  isEscalated: false,
  escalatedAt: null,
  lastLearnerMessageAt: "2026-11-22T09:00:00.000Z",
  lastTrainerResponseAt: null,
  metadataOnly: false,
  averageResponseTimeHours: 2.5,
  slaStatus: "Usually responds within 24 hours.",
  slaState: "ok",
};

const template = {
  id: "tpl1",
  orgId: "o1",
  title: "Welcome",
  body: "Welcome to the programme.",
  createdBy: "me",
  isActive: true,
  createdAt: "2026-11-21T10:00:00.000Z",
  updatedAt: "2026-11-21T10:00:00.000Z",
};

function harness(options: { threads?: unknown[]; templates?: typeof template[]; messages?: unknown[] } = {}) {
  const calls: Call[] = [];
  const threads = options.threads ?? [baseThread];
  const messages = options.messages ?? [];
  let templates = options.templates ?? [template];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: bodyOf(init) });
    const path = String(url);
    const method = init?.method ?? "GET";
    const body = bodyOf(init) as Record<string, unknown> | undefined;
    if (path === "/api/programmes") return jsonResponse([{ id: "p1", name: "Programme 1" }]);
    if (path.startsWith("/api/programmes/p1/members")) return jsonResponse([{ userId: "u2", name: "Learner B", email: "b@example.com", role: "learner" }]);
    if (path.startsWith("/api/courses")) return jsonResponse([{ id: "c1", programmeId: "p1", title: "Safety Course" }]);
    if (path === "/api/message-templates" && method === "GET") return jsonResponse(templates);
    if (path === "/api/message-templates" && method === "POST") {
      const created = { ...template, ...body, id: "tpl2" };
      templates = [...templates, created as typeof template];
      return jsonResponse(created);
    }
    if (path.startsWith("/api/message-templates/") && method === "PATCH") {
      const id = path.split("/").pop();
      templates = templates.map((row) => row.id === id ? { ...row, ...body } : row);
      return jsonResponse(templates.find((row) => row.id === id));
    }
    if (path.startsWith("/api/message-templates/") && method === "DELETE") {
      templates = templates.filter((row) => row.id !== path.split("/").pop());
      return new Response(null, { status: 204 });
    }
    if (path === "/api/sla/run") return jsonResponse({ escalated: 1 });
    if (path === "/api/threads" && method === "POST") return jsonResponse({ ...baseThread, id: "t2", ...body });
    if (path === "/api/threads" || path.startsWith("/api/threads?")) return jsonResponse(threads);
    if (path.startsWith("/api/threads/") && path.endsWith("/sla") && method === "PATCH") return jsonResponse({ ...baseThread, ...body });
    if (path.startsWith("/api/threads/") && path.endsWith("/messages") && method === "POST") return jsonResponse({ id: "m1", threadId: "t1", author: "Test User", body: body?.body, createdAt: "2026-11-22T10:00:00.000Z", urgent: false });
    if (path.startsWith("/api/threads/") && path.endsWith("/messages")) return jsonResponse(messages);
    return jsonResponse({});
  });
  return { calls };
}

describe("Round 12 messaging UI", () => {
  test("staff see course scope, SLA indicators and editable response windows", async () => {
    signIn("trainer");
    const { calls } = harness({ threads: [{ ...baseThread, slaState: "escalated", slaStatus: "Escalated — trainer reply overdue" }] });
    render(<Providers><Messages /></Providers>);

    expect(await screen.findByTestId("thread-row-t1")).toBeTruthy();
    expect((await screen.findByTestId("sla-thread-t1")).textContent).toContain("Escalated");
    expect((await screen.findByTestId("course-thread-t1")).textContent).toContain("course");
    expect((await screen.findByTestId("active-sla")).textContent).toContain("trainer reply overdue");
    expect(screen.getByText("Average trainer response: 2.5 hours")).toBeTruthy();
    expect(screen.getByTestId("sla-editor")).toBeTruthy();
    expect(screen.getByTestId("message-templates-panel")).toBeTruthy();

    fireEvent.change(screen.getByTestId("input-thread-sla-hours"), { target: { value: "8" } });
    fireEvent.click(screen.getByTestId("button-save-thread-sla"));

    await waitFor(() => expect(calls.some((call) => call.method === "PATCH" && call.url === "/api/threads/t1/sla")).toBe(true));
    expect(calls.find((call) => call.url === "/api/threads/t1/sla")?.body).toEqual({ slaHours: 8 });
    expect((await screen.findByTestId("sla-editor-message")).textContent).toContain("8 hours");
  });

  test("learners see the response promise but no staff tools or template requests", async () => {
    signIn("learner");
    const { calls } = harness();
    render(<Providers><Messages /></Providers>);

    expect((await screen.findByTestId("active-sla")).textContent).toContain("Usually responds within 24 hours.");
    expect(screen.queryByTestId("sla-editor")).toBeNull();
    expect(screen.queryByTestId("message-templates-panel")).toBeNull();
    expect(screen.queryByTestId("button-run-sla")).toBeNull();
    expect(calls.some((call) => call.url.includes("/message-templates"))).toBe(false);
  });

  test("inbox filters send programme, course and SLA status to the API", async () => {
    signIn("admin", true);
    const { calls } = harness();
    render(<Providers><Messages /></Providers>);

    await screen.findByTestId("thread-row-t1");
    fireEvent.change(screen.getByTestId("filter-thread-programme"), { target: { value: "p1" } });
    await waitFor(() => expect(calls.some((call) => call.url.includes("programmeId=p1"))).toBe(true));
    await waitFor(() => expect((screen.getByTestId("filter-thread-course") as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(screen.getByTestId("filter-thread-course"), { target: { value: "c1" } });
    await waitFor(() => expect(calls.some((call) => call.url.includes("programmeId=p1&courseId=c1"))).toBe(true));
    fireEvent.change(screen.getByTestId("filter-thread-sla"), { target: { value: "escalated" } });

    await waitFor(() => expect(calls.some((call) => call.url.includes("programmeId=p1&courseId=c1&slaStatus=escalated"))).toBe(true));
  });

  test("new threads carry the selected course and staff response window", async () => {
    signIn("trainer");
    const { calls } = harness();
    render(<Providers><Messages /></Providers>);

    fireEvent.click(screen.getByRole("button", { name: /new message/i }));
    const programmeSelect = await screen.findByTestId("select-thread-programme");
    await waitFor(() => expect(within(programmeSelect).getByRole("option", { name: "Programme 1" })).toBeTruthy());
    fireEvent.change(programmeSelect, { target: { value: "p1" } });
    await waitFor(() => expect((screen.getByTestId("select-thread-course") as HTMLSelectElement).disabled).toBe(false));
    const courseSelect = screen.getByTestId("select-thread-course");
    await waitFor(() => expect(within(courseSelect).getByRole("option", { name: "Safety Course" })).toBeTruthy());
    fireEvent.change(courseSelect, { target: { value: "c1" } });
    await waitFor(() => expect(within(screen.getByTestId("list-thread-participants")).queryByRole("checkbox")).not.toBeNull());
    fireEvent.change(screen.getByTestId("input-thread-subject"), { target: { value: "Course help" } });
    fireEvent.change(screen.getByTestId("input-thread-body"), { target: { value: "Please explain module 2." } });
    fireEvent.click(within(screen.getByTestId("list-thread-participants")).getByRole("checkbox"));
    fireEvent.click(screen.getByTestId("button-create-thread"));

    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url === "/api/threads")).toBe(true));
    expect(calls.find((call) => call.method === "POST" && call.url === "/api/threads")?.body).toEqual({
      subject: "Course help",
      body: "Please explain module 2.",
      programmeId: "p1",
      participantIds: ["u2"],
      urgent: false,
      courseId: "c1",
      slaHours: 24,
    });
  });

  test("canned responses can be created, edited, inserted and deactivated", async () => {
    signIn("trainer");
    const { calls } = harness({ templates: [] });
    render(<Providers><Messages /></Providers>);

    const panel = await screen.findByTestId("message-templates-panel");
    fireEvent.change(within(panel).getByTestId("input-template-title"), { target: { value: "Late reply" } });
    fireEvent.change(within(panel).getByTestId("input-template-body"), { target: { value: "Sorry for the delay." } });
    fireEvent.click(within(panel).getByTestId("button-save-template"));

    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.url === "/api/message-templates")).toBe(true));
    expect(calls.find((call) => call.method === "POST" && call.url === "/api/message-templates")?.body).toEqual({ title: "Late reply", body: "Sorry for the delay." });
    const row = await screen.findByTestId("template-row-tpl2");
    fireEvent.click(within(row).getByTestId("insert-template-tpl2"));
    expect((screen.getByLabelText("Write a reply") as HTMLTextAreaElement).value).toBe("Sorry for the delay.");

    fireEvent.click(within(row).getByTestId("edit-template-tpl2"));
    fireEvent.change(within(screen.getByTestId("message-templates-panel")).getByTestId("input-template-title"), { target: { value: "Updated reply" } });
    fireEvent.click(within(screen.getByTestId("message-templates-panel")).getByTestId("button-save-template"));
    await waitFor(() => expect(calls.some((call) => call.method === "PATCH" && call.url === "/api/message-templates/tpl2")).toBe(true));
    expect(calls.find((call) => call.method === "PATCH" && call.url === "/api/message-templates/tpl2")?.body).toEqual({ title: "Updated reply", body: "Sorry for the delay." });

    fireEvent.click(within(await screen.findByTestId("template-row-tpl2")).getByTestId("remove-template-tpl2"));
    await waitFor(() => expect(calls.some((call) => call.method === "DELETE" && call.url === "/api/message-templates/tpl2")).toBe(true));
    expect((await screen.findByTestId("templates-message")).textContent).toContain("deactivated");
  });

  test("metadata-only threads hide messages and disable replies", async () => {
    signIn("learner");
    const { calls } = harness({ threads: [{ ...baseThread, metadataOnly: true }] });
    render(<Providers><Messages /></Providers>);

    expect(await screen.findByTestId("metadata-only-notice")).toBeTruthy();
    expect(screen.getByText("Replies are disabled for metadata-only threads.")).toBeTruthy();
    expect(screen.queryByLabelText("Write a reply")).toBeNull();
    expect(calls.some((call) => call.url.includes("/messages"))).toBe(false);
  });

  test("role helper and empty DELETE responses are handled", async () => {
    expect(canManageMessaging(null)).toBe(false);
    expect(canManageMessaging({ role: "learner" })).toBe(false);
    expect(canManageMessaging({ role: "stakeholder" })).toBe(false);
    expect(canManageMessaging({ role: "trainer" })).toBe(true);
    expect(canManageMessaging({ role: "admin" })).toBe(true);
    expect(canManageMessaging({ role: "learner", isOrgStaff: true })).toBe(true);

    vi.stubGlobal("fetch", () => new Response(null, { status: 204 }));
    await expect(api<void>("/message-templates/tpl1", { method: "DELETE" })).resolves.toBeUndefined();
  });
});
