import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { OverviewSnapshot } from "@/features/dashboard/overview/model";
import { useOverview } from "./use-overview";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  saved: null as null | (() => void),
  channel: vi.fn(),
}));
vi.mock("@/features/dashboard/overview/actions", () => ({
  refreshOverview: mocks.refresh,
}));
vi.mock("@/lib/realtime/record-channel", () => ({
  subscribeRecordSaved: (cb: () => void) => { mocks.saved = cb; return () => { mocks.saved = null; }; },
}));
// DB 변경 구독(postgres_changes)은 뗐다(2026-10-29 DB 메모리) — 채널을 열면 이 가짜가 잡는다.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ channel: mocks.channel, removeChannel: vi.fn() }),
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
          levels: [],
          schools: [],
          concurrent: 0,
          programs: { eie: 0, injaewon: 0, math: 0, both: 0, noEnrollment: 7, otherOnly: 0 },
          gradeSplit: { rows: [], neither: 7 },
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
  mocks.saved = null;
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
  it("coalesces save signals from this browser and re-queries", async () => {
    mocks.refresh.mockImplementation(async () => initial());
    setup();
    act(() => {
      mocks.saved!();
      mocks.saved!();
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
  it("🔴 opens no database change subscription (DB memory 2026-10-29) and drops the save signal on unmount", () => {
    const { unmount } = setup();
    expect(mocks.channel).not.toHaveBeenCalled();
    expect(mocks.saved).not.toBeNull();
    unmount();
    expect(mocks.saved).toBeNull();
  });
});
