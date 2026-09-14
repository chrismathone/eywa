import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upsertGoal } from "../server/actions";
import { useMonthGoals } from "./use-month-goals";

vi.mock("../server/actions", () => ({ upsertGoal: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(upsertGoal).mockReset();
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
