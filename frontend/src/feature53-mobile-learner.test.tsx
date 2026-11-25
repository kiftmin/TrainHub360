// @vitest-environment jsdom
import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, waitFor } from "@testing-library/react";
import { App } from "@/App";

function authedAs(role: string) {
  localStorage.setItem("th360_token", "test-token");
  localStorage.setItem("th360_user", JSON.stringify({ id: "u1", name: "Test Learner", email: "learner@example.com", role, isOrgStaff: false }));
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const workspace = {
  organization: { id: "o1", name: "Northstar", plan: "growth", learnerCount: 12, programmeCount: 2 },
  activeProgramme: { id: "p1", name: "Safety", type: "Test", status: "active", learnerCount: 12, courseCount: 2, progress: 40, owner: "Ava" },
  user: { id: "u1", name: "Test Learner", email: "learner@example.com", role: "learner", initials: "TL", isOrgStaff: false },
  dataSource: "mssql",
};

const dashboard = {
  learner: { id: "u1", name: "Test Learner", email: "learner@example.com", department: "Operations", jobFunction: "Technician" },
  summary: { assignedCourses: 3, completedCourses: 1, overallProgress: 42, outstandingActivities: 2, pendingVerifications: 0, unreadNotifications: 4, unreadMessages: 0, awaitingTrainerReplies: 2, awaitingLearnerReplies: 1, unreadMessageTracking: false },
  courses: [], upcomingSessions: [], latestResults: [], certificates: [], pendingVerifications: [], nextActions: [], notifications: [], messages: [],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("Feature 5.3 phase 5 — mobile learner shell and profile", () => {
  test("learners get a reduced shell, mobile bottom nav and a real profile route", async () => {
    authedAs("learner");
    window.history.replaceState(null, "", "/profile");
    vi.stubGlobal("fetch", (input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/workspace") return Promise.resolve(json(workspace));
      if (url === "/api/me/learner-dashboard") return Promise.resolve(json(dashboard));
      return Promise.resolve(json([]));
    });
    render(<App />);

    expect(await screen.findByTestId("profile-page")).toBeTruthy();
    expect(screen.getByTestId("profile-name").textContent).toContain("Test Learner");
    expect(screen.getByTestId("profile-email").textContent).toContain("learner@example.com");
    expect(screen.getByTestId("profile-role").textContent).toContain("learner");
    await waitFor(() => expect(screen.getByTestId("profile-assigned").textContent).toContain("3"));
    expect(screen.getByTestId("profile-progress").textContent).toContain("42%");

    const mobile = screen.getByTestId("mobile-learner-nav");
    expect(mobile.getAttribute("aria-label")).toBe("Learner mobile navigation");
    expect(screen.getByTestId("mobile-nav-my-learning")).toBeTruthy();
    expect(screen.getByTestId("mobile-nav-calendar")).toBeTruthy();
    expect(screen.getByTestId("mobile-nav-messages")).toBeTruthy();
    expect(screen.getByTestId("mobile-nav-profile")).toBeTruthy();
    expect(screen.queryByText("Programmes")).toBeNull();
    expect(screen.queryByText("Reports")).toBeNull();
  });

  test("staff do not receive the learner bottom navigation", async () => {
    authedAs("admin");
    window.history.replaceState(null, "", "/profile");
    vi.stubGlobal("fetch", (input: string | URL | Request) => String(input) === "/api/workspace" ? Promise.resolve(json({ ...workspace, user: { ...workspace.user, role: "admin", isOrgStaff: true } })) : Promise.resolve(json([])));
    render(<App />);
    expect(await screen.findByTestId("profile-page")).toBeTruthy();
    expect(screen.queryByTestId("mobile-learner-nav")).toBeNull();
  });
});
