// @vitest-environment jsdom
import { describe, test, expect, afterEach, vi } from "vitest";
import { render, renderHook, cleanup, screen, within, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Assessments } from "@/pages/Assessments";
import { ModuleContentManager } from "@/pages/Programmes";
import { useRecalculationStatus, type CourseAssessment } from "@/api/hooks";

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

const course = {
  id: "c1",
  title: "Safety",
  programmeId: "p1",
  programmeName: "Operations",
  category: "Safety",
  progress: 0,
  status: "active",
  appliedThreshold: 70,
  appliedScore: null,
  dueDate: null,
  trainer: "Trainer",
};

const moduleRow = { id: "m1", courseId: "c1", title: "Core module" };

function assessment(overrides: Partial<CourseAssessment> & { id: string }): CourseAssessment {
  return {
    moduleId: "m1",
    type: "recall",
    title: "Safety paper",
    passMark: 70,
    isPublished: false,
    version: 1,
    publishedAt: null,
    supersededAt: null,
    supersedesId: null,
    changeKind: null,
    questions: [],
    attemptCount: 0,
    bestScore: null,
    remainingAttempts: null,
    locked: false,
    ...overrides,
  };
}

const oldPaper = assessment({ id: "as_old", version: 1, supersededAt: "2026-11-20T10:00:00.000Z", changeKind: "minor" });
const livePaper = assessment({ id: "as_live", version: 2, isPublished: true, publishedAt: "2026-11-20T12:00:00.000Z", changeKind: "minor" });
const draftPaper = assessment({ id: "as_draft", version: 3, supersedesId: "as_live" });

const completeStatus = { pending: false, job: { id: "j1", status: "done", attempts: 1, lastError: null }, attempts: 1, stale: false, lastError: null };
const pendingStatus = { pending: true, job: { id: "j2", status: "running", attempts: 1, lastError: null }, attempts: 1, stale: false, lastError: null };

function staffHarness(options: {
  status?: (call: number) => unknown;
  publish?: (url: string, init?: RequestInit) => Response | undefined;
} = {}) {
  const calls: Call[] = [];
  const versions = [oldPaper, livePaper, draftPaper];
  let statusCalls = 0;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    const call = { url, method: init?.method ?? "GET", body: bodyOf(init) };
    calls.push(call);
    if (url === "/api/courses" && call.method === "GET") return jsonResponse([course]);
    if (url === "/api/programmes/p1/modules") return jsonResponse([moduleRow]);
    if (url === "/api/modules/m1/assessments" && call.method === "GET") return jsonResponse(versions);
    if (url === "/api/modules/m1/assessments" && call.method === "POST") {
      const input = (call.body ?? {}) as { title?: string; type?: "recall" | "applied"; passMark?: number };
      const created = assessment({ id: "as_created", title: input.title ?? "", type: input.type ?? "recall", passMark: input.passMark ?? 70 });
      versions.push(created);
      return jsonResponse(created, 201);
    }
    if (url.startsWith("/api/assessments/") && call.method === "PATCH") {
      const id = url.split("/").pop();
      if (id === "as_live") {
        const created = assessment({ id: "as_draft2", title: livePaper.title, version: 3, isPublished: false, publishedAt: null, supersedesId: "as_live" });
        if (!versions.some((v) => v.id === created.id)) versions.push(created);
        return jsonResponse(created, 201);
      }
      const current = versions.find((v) => v.id === id) ?? draftPaper;
      return jsonResponse({ ...current });
    }
    if (url.startsWith("/api/assessments/") && call.method === "POST" && url.endsWith("/discard-draft")) {
      return jsonResponse({ discarded: "as_draft", liveVersion: "as_live" });
    }
    if (url.startsWith("/api/assessments/") && call.method === "POST" && url.endsWith("/publish")) {
      return options.publish?.(url, init) ?? jsonResponse({ ...draftPaper, isPublished: true, publishedAt: "2026-11-21T12:00:00.000Z" });
    }
    if (url.endsWith("/publish-impact") && call.method === "GET") {
      return jsonResponse({ enrolled: 12, completed: 4, notCompleted: 8, withAttempts: 5 });
    }
    if (url.startsWith("/api/assessments/") && call.method === "GET") {
      const id = url.split("/").pop() ?? "unknown";
      const found = versions.find((v) => v.id === id);
      return jsonResponse({ ...(found ?? assessment({ id })), questions: [] });
    }
    if (url === "/api/courses/c1/evaluation-status") {
      statusCalls += 1;
      return jsonResponse(options.status ? options.status(statusCalls) : completeStatus);
    }
    if (url === "/api/enrolments") return jsonResponse([]);
    return jsonResponse([]);
  });
  return { calls, versions };
}

function staffSession() {
  localStorage.setItem("th360_user", JSON.stringify({ id: "staff-1", role: "admin", name: "Staff", isOrgStaff: true }));
}

async function openCourse() {
  fireEvent.click(await screen.findByRole("button", { name: /Safety/ }));
}

async function selectModule() {
  const select = await screen.findByTestId("module-select");
  await waitFor(() => expect(within(select).getAllByRole("option").some((o) => o.textContent === "Core module")).toBe(true));
  fireEvent.change(select, { target: { value: "m1" } });
}

describe("Round 10 — versioned assessment builder", () => {
  test("the version dropdown shows live, superseding draft and superseded papers", async () => {
    staffSession();
    staffHarness();
    render(<Providers><Assessments /></Providers>);
    await openCourse();
    await selectModule();
    const select = await screen.findByTestId("assessment-version-select");
    expect(select.textContent).toContain("v2 — Safety paper (live)");
    expect(select.textContent).toContain("v3 — Safety paper (draft superseding v2)");
    expect(select.textContent).toContain("v1 — Safety paper (superseded)");
  });

  test("editing a live paper asks for confirmation before PATCHing with confirmNewVersion", async () => {
    staffSession();
    const { calls } = staffHarness();
    render(<Providers><Assessments /></Providers>);
    await openCourse();
    await selectModule();
    fireEvent.change(await screen.findByTestId("assessment-version-select"), { target: { value: "as_live" } });
    fireEvent.click(await screen.findByRole("button", { name: "Create draft from live" }));
    const dialog = await screen.findByTestId("version-confirm-dialog");
    expect(within(dialog).getByText(/Create version 3/)).toBeTruthy();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Create v3" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH" && c.url === "/api/assessments/as_live")).toBe(true));
    const patch = calls.find((c) => c.method === "PATCH");
    expect((patch?.body as { confirmNewVersion?: boolean }).confirmNewVersion).toBe(true);
  });

  test("a replacement publish waits for a deliberate choice, shows real counts and sends that choice", async () => {
    staffSession();
    const { calls } = staffHarness({
      publish: () => jsonResponse({ error: "an assessment needs at least one question", problems: ["an assessment needs at least one question"] }, 400),
    });
    render(<Providers><Assessments /></Providers>);
    await openCourse();
    await selectModule();
    fireEvent.change(await screen.findByTestId("assessment-version-select"), { target: { value: "as_draft" } });
    const publishButton = await screen.findByRole("button", { name: "Publish" });
    expect((publishButton as HTMLButtonElement).disabled).toBe(true);
    expect((await screen.findByTestId("publish-change-kind-minor")).textContent).toContain("5 learners' results stand");
    expect(screen.getByTestId("publish-change-kind-new_paper").textContent).toContain("8 learners who haven't completed must retake it");
    fireEvent.click(screen.getByTestId("publish-change-kind-new_paper"));
    expect((publishButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(publishButton);
    expect(await screen.findByText("an assessment needs at least one question")).toBeTruthy();
    const publish = calls.find((c) => c.url === "/api/assessments/as_draft/publish");
    expect((publish?.body as { changeKind?: string }).changeKind).toBe("new_paper");
  });

  test("saving a draft with no questions is allowed and discarding it leaves the live paper alone", async () => {
    staffSession();
    const { calls } = staffHarness();
    render(<Providers><Assessments /></Providers>);
    await openCourse();
    await selectModule();
    fireEvent.change(await screen.findByTestId("assessment-version-select"), { target: { value: "as_draft" } });
    fireEvent.click(await screen.findByRole("button", { name: "Save draft details" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH" && c.url === "/api/assessments/as_draft")).toBe(true));
    fireEvent.click(await screen.findByRole("button", { name: "Discard draft" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/assessments/as_draft/discard-draft")).toBe(true));
    expect(await screen.findByTestId("discard-notice")).toBeTruthy();
    expect(calls.some((c) => c.method === "PATCH" && c.url === "/api/assessments/as_live")).toBe(false);
  });

  test("another draft can be created for the same module without editing the live paper", async () => {
    staffSession();
    const { calls, versions } = staffHarness();
    render(<Providers><Assessments /></Providers>);
    await openCourse();
    await selectModule();
    fireEvent.change(screen.getByPlaceholderText("Applied scenario test"), { target: { value: "Second draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Create assessment" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/api/modules/m1/assessments")).toBe(true));
    expect(versions.some((v) => v.id === "as_created")).toBe(true);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(localStorage.getItem("th360_user")).toContain("admin");
  });
});

describe("Round 10 — recalculation feedback", () => {
  test("polls while pending and stops once the queue is empty", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", () => {
      calls += 1;
      return jsonResponse(calls < 3 ? pendingStatus : completeStatus);
    });
    const { result, unmount } = renderHook(() => useRecalculationStatus("c1", true, 20), { wrapper: Providers });
    await waitFor(() => expect(result.current.data?.pending).toBe(false), { timeout: 3000 });
    expect(calls).toBeGreaterThanOrEqual(3);
    const seen = calls;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(calls).toBe(seen);
    unmount();
  });

  test("stops on a stale job and surfaces lastError and job.status", async () => {
    let calls = 0;
    const stale = { ...pendingStatus, stale: true, lastError: "worker lost its heartbeat", job: { id: "j2", status: "running", attempts: 2, lastError: "worker lost its heartbeat" } };
    vi.stubGlobal("fetch", () => {
      calls += 1;
      return jsonResponse(stale);
    });
    const { result, unmount } = renderHook(() => useRecalculationStatus("c1", true, 20), { wrapper: Providers });
    await waitFor(() => expect(result.current.data?.stale).toBe(true));
    expect(result.current.data?.job?.status).toBe("running");
    expect(result.current.data?.lastError).toContain("heartbeat");
    const seen = calls;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(calls).toBe(seen);
    unmount();
  });

  test("clears its polling timer on unmount", async () => {
    vi.stubGlobal("fetch", () => jsonResponse(pendingStatus));
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const { result, unmount } = renderHook(() => useRecalculationStatus("c1", true, 1000), { wrapper: Providers });
    await waitFor(() => expect(result.current.data?.pending).toBe(true));
    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  test("publish shows recalculating and then the completed state", async () => {
    staffSession();
    staffHarness({
      status: (call) => call === 1 ? pendingStatus : completeStatus,
    });
    render(<Providers><Assessments /></Providers>);
    await openCourse();
    await selectModule();
    fireEvent.change(await screen.findByTestId("assessment-version-select"), { target: { value: "as_draft" } });
    fireEvent.click(await screen.findByTestId("publish-change-kind-minor"));
    fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
    expect(await screen.findByTestId("recalculation-status")).toBeTruthy();
    expect(screen.getByTestId("recalculation-status").textContent).toContain("Recalculating");
    await waitFor(() => expect(screen.getByTestId("recalculation-status").textContent).toContain("Recalculation complete"), { timeout: 5000 });
  });

  test("a stalled recalculation is reported instead of spinning forever", async () => {
    staffSession();
    const stalled = { ...pendingStatus, stale: true, lastError: "evaluation worker stopped", job: { id: "j3", status: "running", attempts: 3, lastError: "evaluation worker stopped" } };
    staffHarness({ status: () => stalled });
    render(<Providers><Assessments /></Providers>);
    await openCourse();
    await selectModule();
    fireEvent.change(await screen.findByTestId("assessment-version-select"), { target: { value: "as_draft" } });
    fireEvent.click(await screen.findByTestId("publish-change-kind-minor"));
    fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
    await waitFor(() => expect(screen.getByTestId("recalculation-status").textContent).toContain("Recalculation stalled"));
    expect(screen.getByTestId("recalculation-status").textContent).toContain("evaluation worker stopped");
  });
});

describe("Round 10 — content recalculation feedback", () => {
  test("adding required content starts evaluation-status polling", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      const call = { url, method: init?.method ?? "GET", body: bodyOf(init) };
      calls.push(call);
      if (url === "/api/modules/m1/content" && call.method === "GET") return jsonResponse([]);
      if (url === "/api/modules/m1/content" && call.method === "POST") {
        const input = (call.body ?? {}) as { title?: string };
        return jsonResponse({ id: "ci_1", title: input.title ?? "", type: "native", required: true }, 201);
      }
      if (url === "/api/courses/c1/evaluation-status") return jsonResponse(pendingStatus);
      return jsonResponse([]);
    });
    render(<Providers><ModuleContentManager moduleId="m1" moduleTitle="Core module" courseId="c1" /></Providers>);
    fireEvent.change(await screen.findByTestId("input-content-title"), { target: { value: "Handbook" } });
    fireEvent.click(screen.getByTestId("button-add-content"));
    const status = await screen.findByTestId("recalculation-status");
    expect(status.textContent).toContain("Recalculating");
    expect(calls.some((c) => c.url === "/api/courses/c1/evaluation-status")).toBe(true);
  });

  test("archiving content starts evaluation-status polling", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      const call = { url, method: init?.method ?? "GET", body: bodyOf(init) };
      calls.push(call);
      if (url === "/api/modules/m1/content" && call.method === "GET") return jsonResponse([{ id: "ci_1", title: "Handbook", type: "native", required: true }]);
      if (url === "/api/content/ci_1" && call.method === "DELETE") return jsonResponse({ id: "ci_1", isArchived: true });
      if (url === "/api/courses/c1/evaluation-status") return jsonResponse(pendingStatus);
      return jsonResponse([]);
    });
    render(<Providers><ModuleContentManager moduleId="m1" moduleTitle="Core module" courseId="c1" /></Providers>);
    fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
    expect(await screen.findByTestId("recalculation-status")).toBeTruthy();
    expect(calls.some((c) => c.url === "/api/content/ci_1" && c.method === "DELETE")).toBe(true);
    expect(calls.some((c) => c.url === "/api/courses/c1/evaluation-status")).toBe(true);
  });
});

describe("Round 10 — learner notices", () => {
  test("new-paper and pending-review notes are shown without answer keys or rubrics", async () => {
    localStorage.setItem("th360_user", JSON.stringify({ id: "u1", role: "learner", name: "Learner" }));
    const learnerCourse = { ...course };
    const newPaper = assessment({ id: "as_new", version: 3, isPublished: true, publishedAt: "2026-11-21T10:00:00.000Z", changeKind: "new_paper" });
    const minor = assessment({ id: "as_minor", version: 4, isPublished: true, publishedAt: "2026-11-22T10:00:00.000Z", changeKind: "minor" });
    const superseded = assessment({ id: "as_old", version: 2, isPublished: false, supersededAt: "2026-11-21T10:00:00.000Z", changeKind: "minor" });
    vi.stubGlobal("fetch", (url: string) => {
      if (url === "/api/courses") return jsonResponse([learnerCourse]);
      if (url === "/api/courses/c1/assessments") return jsonResponse([newPaper, minor, superseded].map((a) => ({ ...a, questions: [] })));
      if (url === "/api/enrolments") return jsonResponse([{ id: "en1", learnerId: "u1", courseId: "c1", status: "enrolled", pendingAssessmentScore: 88 }]);
      return jsonResponse([]);
    });
    render(<Providers><Assessments /></Providers>);
    await openCourse();
    expect(await screen.findByTestId("new-paper-note-as_new")).toBeTruthy();
    expect(screen.getByTestId("new-paper-note-as_new").textContent).toContain("please retake it");
    expect((await screen.findByTestId("minor-note-as_minor")).textContent).toContain("minor correction, your result stands");
    expect((await screen.findByTestId("pending-score-notice")).textContent).toContain("staff review");
    const oldRow = screen.getByTestId("assessment-row-as_old");
    expect(oldRow.textContent).toContain("Superseded");
    expect(within(oldRow).queryByRole("button", { name: /start|resume|retry/i })).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/answer key|rubric|isCorrect/i);
  });
});
