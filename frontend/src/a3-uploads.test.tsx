// @vitest-environment jsdom
// Round 6 / A.3 — the frontend half of multipart uploads.
//
// The upload used to be base64 inside a JSON body, which express.json() caps at 100 KB, so a
// real PDF failed with 413. These tests pin the browser side: a FormData body, no JSON content
// type, and a content item that references the upload's storedFileId rather than a copied key.
import { describe, test, expect, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useUploadContent, useUploadEvidence } from "@/api/hooks";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function stubFetch() {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body,
    });
    return Promise.resolve(
      new Response(
        JSON.stringify({
          storedFileId: "file_1", storageKey: "content/2026-01-01/abc.pdf", fileName: "handbook.pdf",
          mimeType: "application/pdf", sizeBytes: 204800, checksum: "a".repeat(64), purpose: "content",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
  });
  return calls;
}

function pdf(name = "handbook.pdf") {
  return new File([new Uint8Array(200 * 1024)], name, { type: "application/pdf" });
}

describe("A.3 — the browser uploads multipart, not base64 in JSON", () => {
  test("useUploadContent sends FormData to the module's upload route", async () => {
    const calls = stubFetch();
    const { result } = renderHook(() => useUploadContent("mod_1"), { wrapper });
    result.current.mutate(pdf());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.url).toBe("/api/modules/mod_1/content/upload");
    expect(call.method).toBe("POST");
    expect(call.body).toBeInstanceOf(FormData);
    expect((call.body as FormData).get("file")).toBeInstanceOf(File);
    expect(String(call.headers["content-type"] ?? "")).not.toMatch(/application\/json/);
    expect(result.current.data?.storedFileId).toBe("file_1");
  });

  test("useUploadEvidence posts the proof to the evidence route", async () => {
    const calls = stubFetch();
    const { result } = renderHook(() => useUploadEvidence(), { wrapper });
    result.current.mutate(pdf("evidence.pdf"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls[0].url).toBe("/api/uploads/evidence");
    expect(calls[0].body).toBeInstanceOf(FormData);
  });

  test("an ordinary JSON request still carries the JSON content type", async () => {
    const calls = stubFetch();
    const { api } = await import("@/api/client");
    await api("/content/abc/progress", { method: "POST", body: JSON.stringify({ status: "completed" }) });
    expect(calls[0].headers["content-type"]).toBe("application/json");
  });
});
