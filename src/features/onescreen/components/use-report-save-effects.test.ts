import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OneScreenStudent } from "../types";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() } }));

import { useReportSaveEffects } from "./use-report-save-effects";

const st = (over: Partial<OneScreenStudent> = {}) =>
  ({ id: "s1", name: "학생", subjects: [{ name: "수학", classId: "c1", videoHomework: true }], progressConfirmed: false, ...over }) as unknown as OneScreenStudent;

function setup(students: OneScreenStudent[]) {
  const patch = vi.fn();
  const store = { markKept: vi.fn(), markSeen: vi.fn() };
  const fx = renderHook(() =>
    useReportSaveEffects({
      studentsRef: { current: students },
      i18n: { t: ((k: string) => k) as never, tf: ((k: string) => k) as never },
      videoHwStore: store as never,
      patch,
    }),
  ).result.current;
  return { fx, patch, store };
}

describe("useReportSaveEffects", () => {
  it("저장=진도 확정 — 이미 확정이면 고치지 않는다(불필요한 자동저장 방지)", () => {
    const a = setup([st()]);
    a.fx.confirmProgressOnSave("s1");
    expect(a.patch).toHaveBeenCalledTimes(1);
    const b = setup([st({ progressConfirmed: true })]);
    b.fx.confirmProgressOnSave("s1");
    expect(b.patch).not.toHaveBeenCalled();
  });
  it("서버가 영상 과제를 작성 선생님 값으로 두면 그 줄을 잠그고 화면 값을 되돌린다 · 응답에 없으면 아무 일도 없다", () => {
    const { fx, patch, store } = setup([st()]);
    fx.applyKeptVideoHomework("s1", "수학", {});
    expect(patch).not.toHaveBeenCalled();
    fx.applyKeptVideoHomework("s1", "수학", { keptVideoHomework: false });
    expect(store.markKept).toHaveBeenCalledWith("s1", "c1", false);
    expect(patch).toHaveBeenCalledTimes(1);
  });
  it("서버가 정한 마감을 그 줄에 싣는다", () => {
    const { fx, patch } = setup([st()]);
    fx.applyVideoHomeworkDue("s1", "수학", { videoHomeworkDue: { mode: "next", date: "2026-11-12" } as never });
    const updated = (patch.mock.calls[0]![1] as (s: OneScreenStudent) => OneScreenStudent)(st());
    expect(updated.subjects[0]).toMatchObject({ videoHomeworkDue: "next", videoHomeworkDueDate: "2026-11-12" });
  });
});
