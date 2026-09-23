import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upsertGoal } from "../server/actions";
import { useMonthGoals } from "./use-month-goals";

vi.mock("../server/actions", () => ({ upsertGoal: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(upsertGoal).mockReset();
});

describe("반 계획 보기 — 주간 목표도 같은 자동저장 큐", () => {
  it("더블클릭 편집 값이 주간 기간과 역할을 보존해 저장된다", async () => {
    vi.mocked(upsertGoal).mockResolvedValue({ ok: true });
    const { result } = renderHook(() =>
      useMonthGoals({
        classId: "c1",
        scope: "week",
        periodStart: "2026-09-21",
        initial: { homeroom: {}, assistant: {} },
      }),
    );
    act(() => result.current.setField("assistant", "reading", "textbook", "Reading A"));
    await act(async () => { await result.current.flushAll(); });
    expect(upsertGoal).toHaveBeenCalledWith(expect.objectContaining({
      classId: "c1",
      scope: "week",
      periodStart: "2026-09-21",
      role: "assistant",
      skillArea: "reading",
      textbook: "Reading A",
    }));
    expect(result.current.getError()).toBeNull();
  });

  it("저장 실패 후 입력을 버리고 닫으면 대기 중이던 값은 전송하지 않는다", async () => {
    vi.mocked(upsertGoal).mockResolvedValueOnce({ ok: false, error: "저장 실패" });
    const { result, unmount } = renderHook(() =>
      useMonthGoals({ classId: "c1", scope: "week", periodStart: "2026-09-21", initial: { homeroom: {}, assistant: {} } }),
    );
    act(() => result.current.setField("homeroom", "reading", "textbook", "A"));
    await act(async () => { await result.current.flushAll(); });
    expect(result.current.getError()).toBe("저장 실패");
    act(() => {
      result.current.setField("homeroom", "reading", "textbook", "B");
      result.current.discardPending();
      unmount();
    });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(upsertGoal).toHaveBeenCalledTimes(1);
  });

  it("한 역할의 저장 실패를 다른 역할의 저장 성공이 지우지 않는다", async () => {
    vi.mocked(upsertGoal).mockImplementation(async ({ role }) =>
      role === "homeroom" ? { ok: false, error: "담임 저장 실패" } : { ok: true },
    );
    const { result } = renderHook(() =>
      useMonthGoals({ classId: "c1", scope: "week", periodStart: "2026-09-21", initial: { homeroom: {}, assistant: {} } }),
    );
    act(() => {
      result.current.setField("homeroom", "reading", "textbook", "A");
      result.current.setField("assistant", "reading", "textbook", "B");
    });
    await act(async () => { await result.current.flushAll(); });
    expect(result.current.getError()).toBe("담임 저장 실패");
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("월간 목표 큐 — 저장 중에 같은 키에 친 칸이 사라지지 않는다(리뷰 2026-09-14)", () => {
  it("🔴 교재명 → Tab(flushAll·저장1 출발) → 목표 진도 입력 → 저장1 끝 → 600ms 안에 다른 칸(flushAll) = 목표 진도가 서버로 간다", async () => {
    let finishFirst: (v: { ok: true }) => void = () => {};
    vi.mocked(upsertGoal)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValue({ ok: true });

    const { result } = renderHook(() =>
      useMonthGoals({ classId: "c1", periodStart: "2026-09-01", initial: { homeroom: {}, assistant: {} } }),
    );

    // ① 교재명 입력
    act(() => result.current.setField("homeroom", "reading", "textbook", "Wonders 3"));
    // ② Tab — 루트 onBlur가 flushAll → 저장1 출발(아직 안 끝남)
    let firstFlush: Promise<void> = Promise.resolve();
    act(() => {
      firstFlush = result.current.flushAll();
    });
    expect(upsertGoal).toHaveBeenCalledTimes(1);
    // ③ 같은 키(homeroom|reading)의 목표 진도 입력 — 대기분·새 타이머
    act(() => result.current.setField("homeroom", "reading", "targetProgress", "U3"));
    // ④ 저장1이 끝난다(finally)
    await act(async () => {
      finishFirst({ ok: true });
      await firstFlush;
    });
    // ⑤ 600ms가 지나기 전에 다른 칸으로 — flushAll
    await act(async () => {
      await result.current.flushAll();
    });

    expect(upsertGoal).toHaveBeenCalledTimes(2);
    expect(vi.mocked(upsertGoal).mock.calls[1]![0]).toMatchObject({
      role: "homeroom",
      skillArea: "reading",
      textbook: "Wonders 3",
      targetProgress: "U3",
    });
    // 타이머가 뒤늦게 한 번 더 보내지 않는다(flushAll이 껐다).
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(upsertGoal).toHaveBeenCalledTimes(2);
  });
});

describe("월간 목표 큐 — 저장 실패 되돌리기가 그사이 친 값을 지우지 않는다(재리뷰 2026-09-14)", () => {
  it("🔴 교재명 → flushAll(저장1 출발) → 목표 진도 입력 → 저장1 실패 = 되돌리지 않고, 다음 저장이 두 칸을 함께 보낸다", async () => {
    let failFirst: (v: { ok: false; error: string }) => void = () => {};
    vi.mocked(upsertGoal)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            failFirst = resolve;
          }),
      )
      .mockResolvedValue({ ok: true });

    const { result } = renderHook(() =>
      useMonthGoals({ classId: "c1", periodStart: "2026-09-01", initial: { homeroom: {}, assistant: {} } }),
    );

    act(() => result.current.setField("homeroom", "reading", "textbook", "Wonders 3"));
    let firstFlush: Promise<void> = Promise.resolve();
    act(() => {
      firstFlush = result.current.flushAll();
    });
    expect(upsertGoal).toHaveBeenCalledTimes(1);
    // 저장1이 도는 동안 같은 키의 목표 진도 입력 — 대기 타이머
    act(() => result.current.setField("homeroom", "reading", "targetProgress", "U3"));
    await act(async () => {
      failFirst({ ok: false, error: "편집 권한이 없습니다" });
      await firstFlush;
    });

    // 되돌리지 않았다 — 판정에 쓰는 값이 방금 친 두 칸 그대로(실패 사유는 알린다).
    expect(result.current.goals.homeroom.reading).toEqual({ textbook: "Wonders 3", targetProgress: "U3" });
    expect(result.current.error).toBe("편집 권한이 없습니다");

    // 대기 타이머가 나가며 **옛 값이 아니라** 두 칸을 함께 보낸다.
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(upsertGoal).toHaveBeenCalledTimes(2);
    expect(vi.mocked(upsertGoal).mock.calls[1]![0]).toMatchObject({
      textbook: "Wonders 3",
      targetProgress: "U3",
    });
  });

  it("그사이 새 입력이 없으면 실패는 종전대로 되돌린다", async () => {
    vi.mocked(upsertGoal).mockResolvedValueOnce({ ok: false, error: "저장 실패" });
    const { result } = renderHook(() =>
      useMonthGoals({ classId: "c1", periodStart: "2026-09-01", initial: { homeroom: {}, assistant: {} } }),
    );
    act(() => result.current.setField("homeroom", "reading", "textbook", "Wonders 3"));
    await act(async () => {
      await result.current.flushAll();
    });
    expect(result.current.goals.homeroom.reading).toEqual({ textbook: null, targetProgress: null });
    expect(result.current.error).toBe("저장 실패");
  });
});
