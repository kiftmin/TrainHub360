// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { App } from "@/App";

function authedAs(role: string) {
  localStorage.setItem("th360_token", "test-token");
  localStorage.setItem("th360_user", JSON.stringify({ id: "u1", name: "Test User", role }));
}

describe("RBAC-aware navigation", () => {
  afterEach(() => {
    cleanup();
  });
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
  });

  test("stakeholder sees a reduced nav and the stakeholder dashboard", async () => {
    authedAs("stakeholder");
    render(<App />);
    expect(await screen.findByText("Progress, at a glance.", undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.queryByText("Programmes")).toBeNull();
    expect(screen.queryByText("Review credit")).toBeNull();
  });

  test("admin sees the full nav", async () => {
    authedAs("admin");
    render(<App />);
    expect(await screen.findByText("Programmes", undefined, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByText("Review credit")).toBeTruthy();
  });
});

describe("ReviewCredit page states", () => {
  beforeEach(() => {
    localStorage.clear();
    authedAs("admin");
  });

  afterEach(() => {
    cleanup();
  });

  test("shows the settings heading once loaded", async () => {
    authedAs("admin");
    window.history.pushState({}, "", "/review-credit");
    vi.stubGlobal("fetch", (url: string) => {
      if (String(url).includes("/review-credit/settings")) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ "content-type": "application/json" }),
          json: () => Promise.resolve({ enabled: false, maxWeighting: 10, assessmentWeight: 50, timelinessWeight: 30, applicationWeight: 20, requireManagerSignoff: true, collectApplicationScores: true, eligibleProgrammeTypes: [] }),
        });
      }
      return Promise.reject(new Error("offline"));
    });
    render(<App />);
    expect(await screen.findByText("Make performance visible.", undefined, { timeout: 8000 })).toBeTruthy();
  });

  test("sign-out returns to the login screen", async () => {
    authedAs("admin");
    window.history.pushState({}, "", "/");
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    render(<App />);
    await screen.findByText("Programmes", undefined, { timeout: 5000 });
    fireEvent.click(screen.getByText("Sign out"));
    expect(await screen.findByText("Welcome back.", undefined, { timeout: 5000 })).toBeTruthy();
  });
});

