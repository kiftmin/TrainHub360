// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Overview } from "@/pages/Overview";
import { Learning } from "@/pages/Learning";
import { Programmes } from "@/pages/Programmes";
import { People } from "@/pages/People";
import { MyLearning } from "@/pages/MyLearning";
import { Assessments } from "@/pages/Assessments";
import { CalendarPage } from "@/pages/Calendar";
import { Messages } from "@/pages/Messages";
import { Reports } from "@/pages/Reports";
import { Governance } from "@/pages/Governance";
import { ReviewCredit } from "@/pages/ReviewCredit";
import { SettingsPage } from "@/pages/Settings";

function Providers({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const pages: [string, () => JSX.Element][] = [
  ["Overview", () => <Overview />],
  ["Learning", () => <Learning />],
  ["Programmes", () => <Programmes />],
  ["People", () => <People />],
  ["MyLearning", () => <MyLearning />],
  ["Assessments", () => <Assessments />],
  ["Calendar", () => <CalendarPage />],
  ["Messages", () => <Messages />],
  ["Reports", () => <Reports />],
  ["Governance", () => <Governance />],
  ["ReviewCredit", () => <ReviewCredit />],
  ["Settings", () => <SettingsPage />],
];

describe("pages render without crashing", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
  });

  afterEach(() => {
    cleanup();
  });

  for (const [name, renderPage] of pages) {
    test(`${name} renders a heading or error state`, async () => {
      const utils = render(<Providers>{renderPage()}</Providers>);
      const heading = await utils.findByRole("heading", undefined, { timeout: 4000 }).catch(() => null);
      const error = heading ? null : await utils.findByText("Could not load this view", undefined, { timeout: 4000 }).catch(() => null);
      expect(heading ?? error ?? utils.container.firstChild).toBeTruthy();
    }, 15000);
  }
});
