import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ClassnoteStatusRow } from "../classnote-status";
import type { ReportsState } from "../session-input";
import type { OneScreenStudent } from "../types";

const sync = vi.fn();
vi.mock("./use-classnote-status-sync", () => ({ useClassnoteStatusSync: (...a: unknown[]) => sync(...a) }));

import { useReportStatusMerge } from "./use-report-status-merge";

const S1 = {
  id: "s1",
  subjects: [
    { name: "수학", subjectKey: "math", classId: "c1" },
    { name: "수학 특강", subjectKey: "math", classId: "c2" },
  ],
} as unknown as OneScreenStudent;
const REPORTS: ReportsState = { s1: { 수학: { draft: "", sent: true, classnoteStatus: "queued" }, "수학 특강": { draft: "", sent: false } } };

describe("useReportStatusMerge", () => {
  it("대기 학생만 감시하고, ClassNote가 꺼지면 감시 대상이 없다", () => {
    renderHook(() => useReportStatusMerge({ date: "", classnoteOn: true, reports: REPORTS, setReports: vi.fn(), studentsRef: { current: [S1] } }));
    expect(sync.mock.calls.at(-1)![1]).toEqual(["s1"]);
    renderHook(() => useReportStatusMerge({ date: "", classnoteOn: false, reports: REPORTS, setReports: vi.fn(), studentsRef: { current: [S1] } }));
    expect(sync.mock.calls.at(-1)![1]).toEqual([]);
  });
  it("🔴 결과는 반으로 정확히 맞춘 행에만 — 화면에 없는 반의 결과는 붙이지 않는다", () => {
    let state = REPORTS;
    const setReports = vi.fn((fn: (p: ReportsState) => ReportsState) => (state = fn(state)));
    renderHook(() => useReportStatusMerge({ date: "", classnoteOn: true, reports: REPORTS, setReports: setReports as never, studentsRef: { current: [S1] } }));
    const apply = sync.mock.calls.at(-1)![2] as (rows: ClassnoteStatusRow[]) => void;
    act(() => apply([{ studentId: "s1", subject: "math", classId: "c2", status: "success" }, { studentId: "s1", subject: "math", classId: "zz", status: "failed" }]));
    expect(state.s1!["수학 특강"]!.classnoteStatus).toBe("success");
    expect(state.s1!["수학"]!.classnoteStatus).toBe("queued");
  });
});
