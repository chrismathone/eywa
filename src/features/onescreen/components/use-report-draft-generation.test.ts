import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OneScreenStudent } from "../types";

const { mark, gen } = vi.hoisted(() => ({ mark: vi.fn(), gen: vi.fn() }));
vi.mock("../write-timing-store", () => ({ markAutowrite: mark }));
vi.mock("../server/actions", () => ({ generateReportComment: gen }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() } }));

import { useReportDraftGeneration } from "./use-report-draft-generation";

const EN = { id: "s1", name: "학생", subjects: [{ name: "영어", subjectKey: "english", classId: "e1" }] } as unknown as OneScreenStudent;

function setup(readonlyView: boolean) {
  const generateEnglishDraftFor = vi.fn(async () => "ok" as const);
  const hook = renderHook(() =>
    useReportDraftGeneration({
      ctx: { readonlyView, date: "", activeDate: "2026-11-10", showDailyTest: true, showCheckTest: true, classNarratives: {} },
      refs: { reportsRef: { current: {} }, studentsRef: { current: [EN] } },
      t: ((k: string) => k) as never,
      patchReport: vi.fn(),
      generateEnglishDraftFor,
    }),
  );
  return { ...hook, generateEnglishDraftFor };
}

describe("useReportDraftGeneration", () => {
  beforeEach(() => vi.clearAllMocks());
  it("영어 행은 템플릿 글 만들기로 넘기고(quiet 그대로), 기다린 시간을 자동작성으로 적는다", async () => {
    const { result, generateEnglishDraftFor } = setup(false);
    await expect(result.current.generateDraftFor(EN, "영어", { quiet: true })).resolves.toBe("ok");
    expect(generateEnglishDraftFor).toHaveBeenCalledWith(EN, EN.subjects[0], true);
    expect(mark).toHaveBeenCalledTimes(1);
    expect(gen).not.toHaveBeenCalled();
  });
  it("열람 전용이면 아무것도 만들지도 적지도 않는다", async () => {
    const { result, generateEnglishDraftFor } = setup(true);
    await expect(result.current.generateDraftFor(EN, "영어")).resolves.toBeUndefined();
    expect(generateEnglishDraftFor).not.toHaveBeenCalled();
    expect(mark).not.toHaveBeenCalled();
  });
});
