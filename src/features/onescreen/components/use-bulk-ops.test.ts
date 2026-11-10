import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OneScreenStudent } from "../types";

vi.mock("../server/bulk-log-actions", () => ({ logOnescreenBulkApply: vi.fn(async () => undefined) }));
vi.mock("@/features/attendance/server/actions", () => ({ setAttendanceBulk: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() } }));

import { useBulkOps, type BulkRowSetters } from "./use-bulk-ops";

const stu = (id: string, today = "") =>
  ({
    id,
    name: id,
    grade: "중1",
    tag: "A반",
    attendance: "출석",
    subjects: [{ name: "수학", subjectKey: "math", classId: "c1", className: "A반", today, attendanceRaw: "present" }],
    tests: { daily: { score: null, max: 20 }, check: { score: null, max: 10 } },
    attitude: null,
    homework: "",
  }) as unknown as OneScreenStudent;

function setup(visible: OneScreenStudent[]) {
  const calls: string[] = [];
  const rec =
    (name: string) =>
    (...a: unknown[]) =>
      calls.push(`${name}:${String(a[0])}`);
  const setters = new Proxy({} as BulkRowSetters, { get: (_t, k) => rec(String(k)) });
  const hook = renderHook(() =>
    useBulkOps({
      view: { visible, activeClassFilter: null, classTags: [], displaySettings: { options: { sort: "class" } } },
      ctx: { canEditAttendance: true, readonlyView: false, activeDate: "2026-11-10", lang: "ko" },
      i18n: { t: ((k: string) => k) as never, tf: ((k: string) => k) as never },
      refs: { reportsRef: { current: {} }, studentsRef: { current: visible } },
      bulk: { bulkBusy: null, bulkGen: false },
      video: { videoHwSaveOk: false, videoHwPolicy: null, videoHwByOther: () => false, videoDueReady: false, submitLinkMode: "off" as never, videoHwStore: null as never },
      attendance: { setAttPending: vi.fn(), applyAttendanceLocal: vi.fn() },
      makeupPrev: { prevLoaded: new Set(), loadMakeupPrevAll: vi.fn(async () => undefined) },
      setters,
      readonlyBlocked: () => false,
    }),
  );
  return { ...hook, calls };
}

describe("useBulkOps", () => {
  it("selectRows — 체크한 행만, 없으면 표시 전체(진도 있는 행)", () => {
    const { result } = setup([stu("a", "1-1"), stu("b", "1-2")]);
    expect(result.current.selectRows("save").map((r) => r.key)).toEqual(["a::수학", "b::수학"]);
    expect(result.current.selectRows("save", ["b::수학"]).map((r) => r.key)).toEqual(["b::수학"]);
  });

  it("값 일괄 적용 — 행마다 세터를 예전 순서대로(태도 → 진도) 부른다", async () => {
    const { result, calls } = setup([stu("a"), stu("b")]);
    await act(async () => result.current.bulkApplyValues([], { attitude: "좋음", today: "1-1" }, false, "math"));
    expect(calls).toEqual(["setAttitudeValue:a", "setProgressFor:a", "setAttitudeValue:b", "setProgressFor:b"]);
  });

  it("맨 위 행 복사 — 첫 행 진도를 아래 빈 행에", () => {
    const { result, calls } = setup([stu("a", "1-1"), stu("b")]);
    act(() => result.current.copyFirstRowDown([], false));
    expect(calls).toEqual(["setProgressFor:b"]);
  });
});
