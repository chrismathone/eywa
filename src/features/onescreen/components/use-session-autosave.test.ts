import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OneScreenStudent } from "../types";

const save = vi.fn();
vi.mock("../server/actions", () => ({ saveOnescreenSession: (input: unknown) => save(input) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), message: vi.fn() } }));

import { useSessionAutosave } from "./use-session-autosave";

const stu = (over: Partial<OneScreenStudent> = {}) =>
  ({
    id: "s1",
    name: "학생",
    grade: "중1",
    tag: "A",
    attendance: "출석",
    subjects: [],
    tests: { daily: { score: null, max: 20 }, check: { score: null, max: 10 } },
    attitude: null,
    homework: "",
    note: "",
    ...over,
  }) as OneScreenStudent;

function setup(students: OneScreenStudent[]) {
  const setStudents = vi.fn();
  const t = (k: string) => k;
  const hook = renderHook(
    (p: { students: OneScreenStudent[]; date: string }) =>
      useSessionAutosave({
        students: p.students,
        reports: {},
        setStudents,
        date: p.date,
        showDailyTest: true,
        showCheckTest: true,
        t: t as never,
      }),
    { initialProps: { students, date: "2026-11-10" } },
  );
  return { ...hook, setStudents };
}

describe("useSessionAutosave — 자동저장 경계", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    save.mockReset();
    save.mockResolvedValue({ ok: true, updatedAt: "t1" });
  });
  afterEach(() => vi.useRealTimers());

  it("800ms 디바운스 — 그 전엔 안 보내고, 보낼 때 **최신** 학생·날짜로 조립한다", async () => {
    const { result, rerender } = setup([stu()]);
    act(() => result.current.queueSave("s1"));
    await act(async () => vi.advanceTimersByTime(799));
    expect(save).not.toHaveBeenCalled();
    rerender({ students: [stu({ sessionUpdatedAt: "t0" })], date: "2026-11-09" });
    await act(async () => vi.advanceTimersByTime(1));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0]).toMatchObject({ studentId: "s1", baseUpdatedAt: "t0", sessionDate: "2026-11-09" });
  });

  it("flushSavesRef = 대기 중 저장을 지금 보낸다(날짜 이동 전)", async () => {
    const { result } = setup([stu()]);
    act(() => result.current.queueSave("s1"));
    await act(async () => result.current.flushSavesRef.current());
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("언마운트하면 대기 타이머를 버린다(보내지 않는다)", async () => {
    const { result, unmount } = setup([stu()]);
    act(() => result.current.queueSave("s1"));
    unmount();
    await act(async () => vi.advanceTimersByTime(2000));
    expect(save).not.toHaveBeenCalled();
  });

  it("응답 반영 — 기준 시각을 ref에 즉시 싣고 state도 올린다 · 건너뜀은 올리지 않는다", async () => {
    const { result, setStudents } = setup([stu()]);
    act(() => result.current.applySessionSaveResult("s1", { ok: true, skipped: true, updatedAt: "x" }));
    expect(setStudents).not.toHaveBeenCalled();
    act(() => result.current.applySessionSaveResult("s1", { ok: true, updatedAt: "t9" }));
    expect(result.current.studentsRef.current[0]!.sessionUpdatedAt).toBe("t9");
    expect(setStudents).toHaveBeenCalledTimes(1);
  });
});
