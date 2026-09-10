import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { OverviewSnapshot } from "@/features/dashboard/overview/model";
import { useOverview } from "./use-overview";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  callbacks: new Map<string, () => void>(),
  removed: vi.fn(),
}));
vi.mock("@/features/dashboard/overview/actions", () => ({
  refreshOverview: mocks.refresh,
}));
vi.mock("@/lib/realtime/record-channel", () => ({
  subscribeRecordSaved: () => () => {},
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: () => {
      const channel = {
        on: (_event: string, config: { table: string }, cb: () => void) => {
          mocks.callbacks.set(config.table, cb);
          return channel;
        },
        subscribe: () => channel,
      };
      return channel;
    },
    removeChannel: mocks.removed,
  }),
}));

function initial(): OverviewSnapshot {
  return {
    scope: "tenant:user:master:all",
    tenantId: "tenant",
    academy: "학원",
    today: "2026-09-10",
    requestedAt: Date.now(),
    allowed: ["dashboard", "students"],
    subjects: {},
    sections: {
      students: {
        data: {
          enrolled: 7,
          subjects: [],
          grades: [],
          levels: [],
          schools: [],
        },
        at: Date.now(),
        error: false,
      },
    },
  };
}
function setup(data = initial()) {
  const client = new QueryClient({
    defaultOptions: { queries: { gcTime: Infinity } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { ...renderHook(() => useOverview(data), { wrapper }), client };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-10T12:00:00Z"));
  vi.clearAllMocks();
  mocks.callbacks.clear();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("overview live refresh", () => {
  it("polls a fresh snapshot after 30 seconds even without any database event", async () => {
    mocks.refresh.mockImplementation(async () => initial());
    setup();
    expect(mocks.refresh).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
  it("coalesces database events and re-queries instead of trusting the event payload", async () => {
    mocks.refresh.mockImplementation(async () => initial());
    setup();
    expect(mocks.callbacks.has("invoices")).toBe(false);
    act(() => {
      mocks.callbacks.get("students")!();
      mocks.callbacks.get("students")!();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1199);
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
  it("retains data with a stale flag when one area fails", async () => {
    const data = initial();
    mocks.refresh.mockResolvedValue({
      ...data,
      requestedAt: data.requestedAt + 30_000,
      sections: { students: { data: null, at: null, error: true } },
    });
    const { result } = setup(data);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_010);
    });
    expect(result.current.data.sections.students?.data?.enrolled).toBe(7);
    expect(result.current.data.sections.students?.error).toBe(true);
    expect(result.current.data.sections.students?.at).toBe(data.requestedAt);
  });
  it("removes event subscriptions on unmount", () => {
    const { unmount } = setup();
    const count = mocks.callbacks.size;
    unmount();
    expect(mocks.removed).toHaveBeenCalledTimes(count);
  });
});
