// @vitest-environment jsdom
import { describe, test, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, screen, waitFor } from "@testing-library/react";
import { App } from "@/App";

function authedAs(role: string) {
  localStorage.setItem("th360_token", "test-token");
  localStorage.setItem("th360_user", JSON.stringify({ id: "u1", name: `Test ${role}`, role, isOrgStaff: role === "admin" || role === "owner" }));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const workspace = {
  organization: { id: "o1", name: "Northstar", plan: "growth", learnerCount: 12, programmeCount: 2 },
  activeProgramme: { id: "p1", name: "Safety", type: "Test", status: "active", learnerCount: 12, courseCount: 2, progress: 40, owner: "Ava" },
  user: { id: "u1", name: "Test User", email: "user@example.com", role: "learner", initials: "TU", isOrgStaff: false },
  dataSource: "mssql",
};

const dashboard = {
  learner: { id: "u1", name: "Test Learner", email: "learner@example.com", department: "Operations", jobFunction: "Technician" },
  summary: { assignedCourses: 3, completedCourses: 1, overallProgress: 42, outstandingActivities: 2, pendingVerifications: 0, unreadNotifications: 0, unreadMessages: 0 },
  courses: [], upcomingSessions: [], latestResults: [], certificates: [], pendingVerifications: [], nextActions: [], notifications: [], messages: [],
};

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", (input: string | URL | Request) => {
    const url = String(input);
    if (url === "/api/workspace") return Promise.resolve(json(workspace));
    if (url === "/api/me/learner-dashboard") return Promise.resolve(json(dashboard));
    return Promise.resolve(json([]));
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("Feature 5.3 security — route-level authorisation", () => {
  test("a learner opening / is redirected to /my-learning", async () => {
    authedAs("learner");
    window.history.replaceState(null, "", "/");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/my-learning"));
    expect(await screen.findByText("Your path, in order.", undefined, { timeout: 8000 })).toBeTruthy();
  });

  test("a learner cannot open management or administration routes", async () => {
    for (const path of ["/reports", "/settings"]) {
      authedAs("learner");
      window.history.replaceState(null, "", path);
      render(<App />);
      await waitFor(() => expect(window.location.pathname).toBe("/my-learning"));
      cleanup();
      localStorage.clear();
    }
  });

  test("a learner can open /my-learning and /profile", async () => {
    authedAs("learner");
    window.history.replaceState(null, "", "/profile");
    render(<App />);
    expect(await screen.findByTestId("profile-page", undefined, { timeout: 8000 })).toBeTruthy();
    expect(window.location.pathname).toBe("/profile");
  });

  test("staff and administrators retain permitted routes", async () => {
    authedAs("admin");
    window.history.replaceState(null, "", "/reports");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/reports"));
    expect(screen.queryByText("Welcome back.")).toBeNull();
    cleanup();
    localStorage.clear();

    authedAs("owner");
    window.history.replaceState(null, "", "/settings");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/settings"));
    expect(screen.queryByText("Welcome back.")).toBeNull();
  });

  test("unauthenticated users are redirected to login", async () => {
    window.history.replaceState(null, "", "/reports");
    render(<App />);
    expect(await screen.findByText("Welcome back.", undefined, { timeout: 8000 })).toBeTruthy();
  });

  test("a revoked session returns to login after a 401", async () => {
    authedAs("learner");
    window.history.replaceState(null, "", "/my-learning");
    vi.stubGlobal("fetch", (input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/workspace") return Promise.resolve(json(workspace));
      if (url === "/api/me/learner-dashboard") return Promise.resolve(json({ error: "session expired" }, 401));
      return Promise.resolve(json([]));
    });
    render(<App />);
    expect(await screen.findByText("Welcome back.", undefined, { timeout: 8000 })).toBeTruthy();
    expect(localStorage.getItem("th360_token")).toBeNull();
  });
});
