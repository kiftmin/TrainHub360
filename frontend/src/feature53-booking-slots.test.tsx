// @vitest-environment jsdom
import { describe, test, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { CalendarPage } from "@/pages/Calendar";

function Providers({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const startsAt = "2026-12-15T09:30:00.000Z";
const slots = {
  trainerId: "trainer-1",
  timeZone: "UTC",
  slots: [
    { availabilityId: "availability-1", startsAt, endsAt: "2026-12-15T10:00:00.000Z", timeZone: "UTC", durationMinutes: 30, available: true },
    { availabilityId: "availability-1", startsAt: "2026-12-15T10:00:00.000Z", endsAt: "2026-12-15T10:30:00.000Z", timeZone: "UTC", durationMinutes: 30, available: false },
  ],
};

function harness() {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? "GET", body });
    if (url === "/api/sessions") return Promise.resolve(json([]));
    if (url === "/api/bookings" && (init?.method ?? "GET") === "GET") {
      return Promise.resolve(json([{ id: "b1", trainer: "Existing Trainer", trainerId: "trainer-1", course: "Safety", date: "2026-12-14", time: "09:00", duration: "30 min", status: "confirmed" }]));
    }
    if (url === "/api/bookings" && init?.method === "POST") return Promise.resolve(json({ id: "b2" }, 201));
    if (url.startsWith("/api/bookings/slots")) return Promise.resolve(json(slots));
    if (url === "/api/bookings/trainers") return Promise.resolve(json([{ id: "trainer-1", name: "Available Trainer", email: "trainer@example.com" }]));
    if (url === "/api/courses") return Promise.resolve(json([{ id: "course-1", title: "Safety" }]));
    if (url.startsWith("/api/bookings/b1/cancel")) return Promise.resolve(json({ id: "b1", status: "cancelled" }));
    return Promise.resolve(json([]));
  });
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("Feature 5.3 phase 3 — learner booking slots", () => {
  test("books a generated slot and cancels an existing booking", async () => {
    localStorage.setItem("th360_user", JSON.stringify({ id: "learner-1", role: "learner", name: "Learner" }));
    const calls = harness();
    render(<Providers><CalendarPage /></Providers>);

    fireEvent.click(await screen.findByText("Book 1:1"));
    fireEvent.change(await screen.findByTestId("select-booking-trainer"), { target: { value: "trainer-1" } });
    fireEvent.change(screen.getByTestId("input-booking-date"), { target: { value: "2026-12-15" } });

    const slotSelect = (await screen.findByTestId("select-booking-slot")) as HTMLSelectElement;
    await waitFor(() => expect(Array.from(slotSelect.options).some((option) => option.value === startsAt)).toBe(true));
    fireEvent.change(slotSelect, { target: { value: startsAt } });
    fireEvent.click(screen.getByText("Confirm booking"));

    await waitFor(() => {
      const bookingCall = calls.find((call) => call.url === "/api/bookings" && call.method === "POST");
      expect(bookingCall).toBeTruthy();
      expect(bookingCall?.body).toMatchObject({ trainerId: "trainer-1", availabilityId: "availability-1", startsAt });
    });

    fireEvent.click(await screen.findByTestId("cancel-booking-b1"));
    await waitFor(() => {
      expect(calls.some((call) => call.url === "/api/bookings/b1/cancel" && call.method === "POST")).toBe(true);
    });
  });
});
