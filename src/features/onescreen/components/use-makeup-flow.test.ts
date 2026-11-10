import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OneScreenStudent } from "../types";

const fetchAbs = vi.fn();
vi.mock("@/features/attendance/server/makeup-actions", () => ({
  fetchMakeupAbsences: (...a: unknown[]) => fetchAbs(...a),
  fetchMakeupHostClasses: vi.fn(async () => ({ options: [] })),
}));
vi.mock("../server/actions", () => ({ buildMakeupStudent: vi.fn() }));
vi.mock("../server/makeup-register-actions", () => ({ registerMakeupEntries: vi.fn() }));
vi.mock("../server/makeup-class-actions", () => ({ setMakeupClass: vi.fn() }));
vi.mock("../server/makeup-remove-actions", () => ({ removeMakeupEntry: vi.fn() }));
vi.mock("@/features/attendance/server/actions", () => ({ linkMakeupToAbsence: vi.fn() }));
vi.mock("@/features/attendance/server/makeup-note-action", () => ({ noteMakeupAgainstAbsence: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() } }));

import { useMakeupFlow } from "./use-makeup-flow";

function setup() {
  return renderHook(() =>
    useMakeupFlow({
      ctx: { date: "", activeDate: "2026-11-10", classFilter: "전체", matchingClasses: [], todayClasses: [] },
      state: {
        students: [] as OneScreenStudent[],
        setStudents: vi.fn(),
        reports: {},
        setReports: vi.fn(),
        studentsRef: { current: [] },
        templatePrefsRef: { current: { last: null, byClass: {} } },
      },
      i18n: { t: ((k: string) => k) as never, tf: ((k: string) => k) as never },
      ui: { setSelId: vi.fn(), setCardSubject: vi.fn(), askSendClass: vi.fn() },
      rows: { patch: vi.fn(), readonlyBlocked: () => false, applySessionSaveResult: vi.fn() },
      attendance: { setAttendanceFor: vi.fn(), applyAttendanceLocal: vi.fn(), withMark: (s) => s },
    }),
  );
}

describe("useMakeupFlow — 결석 후보 응답 순서 가드", () => {
  it("🔴 같은 학생을 다른 앵커로 다시 열면 늦게 온 옛 조회는 버린다", async () => {
    let resolveOld!: (v: unknown) => void;
    const oldList = { options: [{ date: "old" }], hiddenBySubject: 0 };
    const newList = { options: [{ date: "new" }], hiddenBySubject: 0 };
    fetchAbs.mockImplementationOnce(() => new Promise((r) => (resolveOld = r))).mockImplementationOnce(async () => newList);
    const { result } = setup();
    act(() =>
      result.current.setMakeupAsk({
        studentId: "s1",
        studentName: "학생",
        mk: {} as OneScreenStudent,
        candidates: [],
        sentSubjects: [],
        isNew: true,
        absences: { options: [], hiddenBySubject: 0 },
        absencesLoading: true,
      }),
    );
    let first!: Promise<void>;
    act(() => {
      first = result.current.loadAbsences("s1", "math-class");
    });
    await act(async () => result.current.loadAbsences("s1", "english-class"));
    await act(async () => {
      resolveOld(oldList);
      await first;
    });
    expect(result.current.makeupAsk?.absences).toBe(newList);
    expect(result.current.makeupAsk?.absencesLoading).toBe(false);
  });
});
