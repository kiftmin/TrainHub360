// @vitest-environment jsdom
import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ProgrammeDetail } from "@/pages/Programmes";
import type { Course, Module, ProgrammeMember } from "@/api/hooks";

function Providers({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

type Call = { url: string; method: string; body?: unknown };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const programme = {
  id: "p1",
  name: "Operations",
  type: "Onboarding",
  status: "active",
  learnerCount: 0,
  courseCount: 1,
  progress: 0,
  owner: "Owner",
};

const course: Course = {
  id: "c1",
  title: "Safety",
  programmeId: "p1",
  programmeName: "Operations",
  category: "General",
  progress: 0,
  status: "active",
  appliedThreshold: 70,
  appliedScore: null,
  dueDate: null,
  trainer: "",
};

const trainerMember: ProgrammeMember = { userId: "trainer-1", name: "Trainer One", email: "trainer@example.com", role: "trainer" };
const otherTrainer: ProgrammeMember = { userId: "trainer-2", name: "Trainer Two", email: "trainer2@example.com", role: "trainer" };

function harness(options: {
  role?: string;
  courses?: Course[];
  modules?: Module[];
  members?: ProgrammeMember[];
  coursePost?: (body: { title?: string; category?: string; trainerId?: string }) => Response;
  modulePost?: (body: { courseId?: string; title?: string }) => Response;
} = {}) {
  const calls: Call[] = [];
  let courses = [...(options.courses ?? [course])];
  let modules = [...(options.modules ?? [])];
  vi.stubGlobal("fetch", (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    if (url === "/api/programmes" && method === "GET") return jsonResponse([programme]);
    if ((url === "/api/courses" || url.startsWith("/api/courses?")) && method === "GET") return jsonResponse(courses);
    if (url === "/api/courses" && method === "POST") {
      const failure = options.coursePost?.(body ?? {});
      if (failure) return failure;
      const created = { ...course, id: `c-new-${calls.length}`, title: body.title ?? "", category: body.category ?? "General" };
      courses = [...courses, created];
      return jsonResponse(created, 201);
    }
    if (url === "/api/programmes/p1/modules" && method === "GET") return jsonResponse(modules);
    if (url === "/api/programmes/p1/modules" && method === "POST") {
      const failure = options.modulePost?.(body ?? {});
      if (failure) return failure;
      const created = { id: `m-new-${calls.length}`, courseId: body.courseId ?? "", title: body.title ?? "" };
      modules = [...modules, created];
      return jsonResponse(created, 201);
    }
    if (url === "/api/programmes/p1/members" && method === "GET") return jsonResponse(options.members ?? [trainerMember, otherTrainer]);
    return jsonResponse([]);
  });
  localStorage.setItem("th360_token", "token");
  localStorage.setItem("th360_user", JSON.stringify({
    id: "trainer-1",
    name: "Trainer One",
    role: options.role ?? "trainer",
    isOrgStaff: options.role === "admin" || options.role === "owner",
  }));
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Programme Detail — course and module authoring", () => {
  test("authorised trainers and administrators see the creation actions", async () => {
    harness({ role: "trainer" });
    render(<Providers><ProgrammeDetail id="p1" /></Providers>);
    expect(await screen.findByTestId("button-add-course")).toBeTruthy();
    expect(await screen.findByTestId("button-add-module")).toBeTruthy();
    expect(screen.queryByTestId("button-submit-member")).toBeNull();
  });

  test("learners and users without a programme grant do not see the creation actions", async () => {
    harness({ role: "learner" });
    render(<Providers><ProgrammeDetail id="p1" /></Providers>);
    await screen.findByText("Operations");
    expect(screen.queryByTestId("button-add-course")).toBeNull();
    expect(screen.queryByTestId("button-add-module")).toBeNull();
  });

  test("the module form requires a course selection", async () => {
    harness();
    render(<Providers><ProgrammeDetail id="p1" /></Providers>);
    fireEvent.click(await screen.findByTestId("button-add-module"));
    const select = await screen.findByTestId("select-module-course");
    expect((select as HTMLSelectElement).value).toBe("");
    expect((screen.getByTestId("button-submit-module") as HTMLButtonElement).disabled).toBe(true);
  });

  test("course creation posts the programme and selected trainer, then refreshes the list", async () => {
    const calls = harness();
    render(<Providers><ProgrammeDetail id="p1" /></Providers>);
    fireEvent.click(await screen.findByTestId("button-add-course"));
    fireEvent.change(await screen.findByTestId("input-course-title"), { target: { value: "New course" } });
    fireEvent.change(screen.getByTestId("input-course-category"), { target: { value: "Safety" } });
    fireEvent.change(screen.getByTestId("select-course-trainer-create"), { target: { value: "trainer-2" } });
    fireEvent.click(screen.getByTestId("button-submit-course"));
    await waitFor(() => {
      expect(calls.some((c) => c.url === "/api/courses" && c.method === "POST")).toBe(true);
    });
    const post = calls.find((c) => c.url === "/api/courses" && c.method === "POST");
    expect(post?.body).toEqual({ title: "New course", programmeId: "p1", category: "Safety", trainerId: "trainer-2" });
    expect(await screen.findByText("New course")).toBeTruthy();
    expect(screen.queryByTestId("input-course-title")).toBeNull();
  });

  test("module creation posts an explicit course and refreshes the list", async () => {
    const calls = harness();
    render(<Providers><ProgrammeDetail id="p1" /></Providers>);
    fireEvent.click(await screen.findByTestId("button-add-module"));
    fireEvent.change(await screen.findByTestId("select-module-course"), { target: { value: "c1" } });
    fireEvent.change(screen.getByTestId("input-module-title"), { target: { value: "New module" } });
    fireEvent.click(screen.getByTestId("button-submit-module"));
    await waitFor(() => {
      expect(calls.some((c) => c.url === "/api/programmes/p1/modules" && c.method === "POST")).toBe(true);
    });
    const post = calls.find((c) => c.url === "/api/programmes/p1/modules" && c.method === "POST");
    expect(post?.body).toEqual({ courseId: "c1", title: "New module" });
    expect(await screen.findByText("New module")).toBeTruthy();
    expect(screen.queryByTestId("input-module-title")).toBeNull();
  });

  test("API errors are shown in the course dialog", async () => {
    harness({ coursePost: () => jsonResponse({ error: "forbidden for this programme" }, 403) });
    render(<Providers><ProgrammeDetail id="p1" /></Providers>);
    fireEvent.click(await screen.findByTestId("button-add-course"));
    fireEvent.change(await screen.findByTestId("input-course-title"), { target: { value: "Denied" } });
    fireEvent.click(screen.getByTestId("button-submit-course"));
    expect((await screen.findByTestId("course-form-error")).textContent).toContain("forbidden for this programme");
  });

  test("a programme without courses explains that a course is required first", async () => {
    harness({ courses: [] });
    render(<Providers><ProgrammeDetail id="p1" /></Providers>);
    fireEvent.click(await screen.findByTestId("button-add-module"));
    expect((await screen.findByTestId("module-no-courses")).textContent).toContain("Create a course");
    fireEvent.click(screen.getByTestId("button-module-add-course"));
    expect(await screen.findByTestId("input-course-title")).toBeTruthy();
    expect(screen.queryByTestId("select-module-course")).toBeNull();
  });
});
