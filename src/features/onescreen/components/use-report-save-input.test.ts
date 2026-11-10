import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReportsState } from "../session-input";
import type { OneScreenStudent } from "../types";
import { useReportSaveInput } from "./use-report-save-input";

const st = {
  id: "s1",
  name: "학생",
  grade: "중1",
  subjects: [{ name: "수학", subjectKey: "math", classId: "c1", today: "1-1", videoHomework: true }],
  tests: { daily: { score: null, max: 20 }, check: { score: null, max: 10 } },
  attitude: null,
  homework: "",
} as unknown as OneScreenStudent;

function setup(reportsRef: { current: ReportsState }, videoHwSaveOk = false) {
  return renderHook(() =>
    useReportSaveInput({
      ctx: { date: "2026-11-10", activeDate: "2026-11-10", showDailyTest: true, showCheckTest: true },
      refs: { reportsRef, trendOptOutRef: { current: new Set() } },
      video: {
        videoHwSaveOk,
        videoHwPolicy: null,
        videoHwByOther: () => false,
        videoDueReady: false,
        submitLinkMode: "off" as never,
        videoHwStore: null as never,
      },
      english: { jj: { picksRef: { current: {} } } as never, freshEnglishDraft: () => ({ draft: "", autoDraft: undefined }) },
    }),
  ).result.current;
}

describe("useReportSaveInput", () => {
  it("🔴 초안은 부를 때 ref에서 읽는다 — 훅을 만든 뒤 바뀐 글도 싣는다(#10)", () => {
    const reportsRef: { current: ReportsState } = { current: {} };
    const { buildSaveInputFor } = setup(reportsRef);
    reportsRef.current = { s1: { 수학: { draft: "나중에 쓴 멘트", sent: false } } };
    const built = buildSaveInputFor(st, "수학");
    expect(built.draft).toBe("나중에 쓴 멘트");
    expect(built.input).toMatchObject({ studentId: "s1", reportDate: "2026-11-10", subject: "math", classId: "c1", outOfClass: false });
  });
  it("영상 과제 값을 못 읽은 세션이면 영상 칸을 싣지 않는다(저장돼 있던 '있음'을 덮지 않게)", () => {
    const { buildSaveInputFor } = setup({ current: {} }, false);
    expect(buildSaveInputFor(st, "수학").input).not.toHaveProperty("videoHomework");
  });
});
