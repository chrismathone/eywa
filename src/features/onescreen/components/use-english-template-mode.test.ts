import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OneScreenStudent } from "../types";

const list = vi.fn();
vi.mock("@/features/report-templates/server/actions", () => ({ listMyReportTemplates: () => list() }));
vi.mock("../server/english-ment-actions", () => ({ generateEnglishMent: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() } }));

import { useEnglishTemplateMode } from "./use-english-template-mode";

const stu = (subjectKey: string) =>
  ({ id: "s1", name: "학생", subjects: [{ name: "과목", subjectKey, classId: "c1" }] }) as unknown as OneScreenStudent;

function setup(students: OneScreenStudent[]) {
  const setReports = vi.fn();
  const hook = renderHook(() =>
    useEnglishTemplateMode({
      students,
      initialTemplatePrefs: { last: null, byClass: {} },
      activeDate: "2026-11-10",
      report: { showDailyTest: true, showCheckTest: true, teacherName: "강사" },
      classNarratives: {},
      jj: { ensure: vi.fn(), cacheRef: { current: {} }, picksRef: { current: {} } } as never,
      refs: { reportsRef: { current: {} }, studentsRef: { current: students } },
      state: { setReports, patchReport: vi.fn() },
      rowOutOfClass: () => false,
      t: ((k: string) => k) as never,
    }),
  );
  return { ...hook, setReports };
}

describe("useEnglishTemplateMode — 템플릿 목록", () => {
  it("영어 행이 없으면 목록을 부르지 않는다", () => {
    list.mockReset();
    setup([stu("math")]);
    expect(list).not.toHaveBeenCalled();
  });

  it("목록을 못 받으면 실패로 표시하고 기본값으로 붙인 사용자 템플릿을 되돌린다", async () => {
    list.mockReset();
    list.mockRejectedValue(new Error("x"));
    const { result, setReports } = setup([stu("english")]);
    await waitFor(() => expect(result.current.templateListFailed).toBe(true));
    expect(setReports).toHaveBeenCalledTimes(1);
  });

  it("받은 목록이 화면 목록이 되고 비동기 경로용 ref에도 실린다", async () => {
    list.mockReset();
    const tpl = { id: "u1", name: "내 템플릿", body: "" };
    list.mockResolvedValue({ templates: [tpl], notice: null });
    const { result } = setup([stu("english")]);
    await waitFor(() => expect(result.current.englishTemplates).toEqual([tpl]));
    await waitFor(() => expect(result.current.englishTemplatesRef.current).toEqual([tpl]));
    expect(result.current.templateListFailed).toBe(false);
  });
});
