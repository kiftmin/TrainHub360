// @vitest-environment jsdom
// Round 8 / 1.3 — a manual override must never be replaced silently.
//
// The API holds a later automatic result in `pendingAssessmentScore` while the enrolment's score
// source is `manual`. Before this, staff had no way to see it in the app or to decide, so the
// override could sit there forever. These tests pin the two calls the panel makes and that the flag
// only appears when there is something waiting.
import { describe, test, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useAcceptAssessmentScore, useRejectAssessmentScore, useEnrolments, type Enrolment } from "@/api/hooks";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

type Call = { url: string; method: string };

function stubFetch(payload: unknown) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET" });
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }));
  });
  return calls;
}

describe("Round 8 — pending assessment results", () => {
  test("accepting a held result posts to the accept route", async () => {
    const calls = stubFetch({ enrolmentId: "en_1" });
    const { result } = renderHook(() => useAcceptAssessmentScore(), { wrapper });
    result.current.mutate("en_1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0].url).toContain("/enrolments/en_1/accept-assessment-score");
    expect(calls[0].method).toBe("POST");
  });

  test("keeping the override posts to the reject route", async () => {
    const calls = stubFetch({ ok: true });
    const { result } = renderHook(() => useRejectAssessmentScore(), { wrapper });
    result.current.mutate("en_2");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0].url).toContain("/enrolments/en_2/reject-assessment-score");
  });

  test("the enrolment row carries the source, lock and pending result", async () => {
    const row: Enrolment = {
      id: "en_3",
      learnerId: "u_1",
      courseId: "c_1",
      programmeId: "p_1",
      status: "enrolled",
      enrolmentScore: 62,
      appliedScoreSource: "manual",
      appliedAssessmentScore: 80,
      appliedScoreOverrideReason: "agreed with the line manager",
      pendingAssessmentScore: 95,
      pendingAssessmentScoreAt: "2026-11-21T09:00:00.000Z",
      reviewCreditLockedAt: null,
    };
    stubFetch([row]);
    const { result } = renderHook(() => useEnrolments(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [first] = result.current.data ?? [];
    expect(first.appliedScoreSource).toBe("manual");
    expect(first.pendingAssessmentScore).toBe(95);
    expect(first.appliedScoreOverrideReason).toContain("line manager");
  });

  test("an enrolment with no override has nothing pending", async () => {
    stubFetch([{ id: "en_4", learnerId: "u_1", courseId: "c_1", status: "completed", appliedScoreSource: "assessment", pendingAssessmentScore: null }]);
    const { result } = renderHook(() => useEnrolments(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].pendingAssessmentScore ?? null).toBeNull();
  });
});
