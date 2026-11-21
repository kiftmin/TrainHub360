// @vitest-environment jsdom
// Round 8 / Phase 2 — the browser has to speak the Phase 4 assessment contract.
//
// The builder used to post `type` and no `kind`, so every question was refused with a 400, and the
// API client dropped `problems`, so a trainer saw only "API 400". These tests pin the payload the
// builder sends and the error shape the screens rely on (status + parsed body).
import { describe, test, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCreateQuestion, useGradeAttempt, useSaveAttemptAnswers } from "@/api/hooks";
import { api } from "@/api/client";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

type Call = { url: string; method: string; body: unknown };

function stubFetch(status = 201, payload: unknown = { id: "q_1" }) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return Promise.resolve(new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } }));
  });
  return calls;
}

describe("Round 8 — the question builder posts the real contract", () => {
  test("a scenario question carries kind, points, context and rubric", async () => {
    const calls = stubFetch();
    const { result } = renderHook(() => useCreateQuestion("as_1"), { wrapper });
    result.current.mutate({ kind: "scenario", prompt: "What would you do?", points: 4, scenarioContext: "A learner is absent", rubric: "Names the escalation path" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0].url).toBe("/api/assessments/as_1/questions");
    expect(calls[0].body).toMatchObject({ kind: "scenario", points: 4, scenarioContext: "A learner is absent", rubric: "Names the escalation path" });
    expect((calls[0].body as Record<string, unknown>).type).toBeUndefined();
  });

  test("a choice question carries its options and correct flags", async () => {
    const calls = stubFetch();
    const { result } = renderHook(() => useCreateQuestion("as_1"), { wrapper });
    result.current.mutate({ kind: "single_choice", prompt: "Pick", options: [{ text: "a", isCorrect: true }, { text: "b", isCorrect: false }] });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0].body).toMatchObject({ kind: "single_choice", options: [{ text: "a", isCorrect: true }, { text: "b", isCorrect: false }] });
  });

  test("a short answer carries the accepted forms", async () => {
    const calls = stubFetch();
    const { result } = renderHook(() => useCreateQuestion("as_1"), { wrapper });
    result.current.mutate({ kind: "short_answer", prompt: "Why?", acceptedAnswers: ["because", "as a result"] });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect((calls[0].body as { acceptedAnswers: string[] }).acceptedAnswers).toEqual(["because", "as a result"]);
  });
});

describe("Round 8 — the client keeps the error body the screens need", () => {
  test("publish problems survive the failed request", async () => {
    stubFetch(400, { error: "applied assessments need at least one scenario or short-answer question", problems: ["one problem", "another"] });
    await expect(api("/assessments/as_1/publish", { method: "POST" })).rejects.toMatchObject({
      status: 400,
      body: { problems: ["one problem", "another"] },
    });
  });

  test("an expired save and a new-version conflict are distinguishable", async () => {
    stubFetch(409, { error: "the time limit for this attempt has passed", expired: true });
    await expect(api("/attempts/a_1/answers", { method: "PUT" })).rejects.toMatchObject({ status: 409, body: { expired: true } });

    stubFetch(409, { error: "this assessment is published", requiresNewVersion: true, nextVersion: 2 });
    await expect(api("/assessments/as_1", { method: "PATCH" })).rejects.toMatchObject({ status: 409, body: { requiresNewVersion: true } });
  });
});

describe("Round 8 — attempt and grading hooks speak to the Phase 4 routes", () => {
  test("answers are saved to the attempt route, not the old course route", async () => {
    const calls = stubFetch(200, { attemptId: "a_1", saved: 1 });
    const { result } = renderHook(() => useSaveAttemptAnswers(), { wrapper });
    result.current.mutate({ attemptId: "a_1", answers: [{ questionId: "q_1", optionIds: ["o_1"], text: undefined }] });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0].url).toBe("/api/attempts/a_1/answers");
    expect(calls[0].method).toBe("PUT");
  });

  test("grading posts points per manual question", async () => {
    const calls = stubFetch(200, { attemptId: "a_1", status: "graded", score: 100 });
    const { result } = renderHook(() => useGradeAttempt(), { wrapper });
    result.current.mutate({ attemptId: "a_1", answers: [{ questionId: "q_1", pointsAwarded: 3, comment: "Clear" }] });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0].url).toBe("/api/attempts/a_1/grade");
    expect(calls[0].body).toEqual({ answers: [{ questionId: "q_1", pointsAwarded: 3, comment: "Clear" }] });
  });
});
