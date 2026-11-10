import { describe, expect, it } from "vitest";
import { englishJjPick, englishJjStatus, englishRowFactsOf, englishRowFlagsOf, type JjView } from "./english-row-facts";
import { jjDayKey } from "./jj-day";
import type { OneScreenStudent, Subject } from "./types";

const su = { name: "영어", subjectKey: "english", classId: "e1", today: "Unit 3", attitude: "좋음", homework: "100%", note: "잘함" } as Subject;
const st = {
  id: "s1",
  name: "학생",
  grade: "중1",
  subjects: [su],
  tests: { daily: { score: null, max: 20 }, check: { score: null, max: 10 } },
  attitude: null,
  homework: "",
} as unknown as OneScreenStudent;
const CTX = { teacherName: "Jane", showDailyTest: true, showCheckTest: true, activeDate: "2026-11-10" };
const KEY = jjDayKey("s1", "2026-11-10");
const jjOf = (cache: JjView["cache"], pending: string[] = []): JjView => ({ cache, pending: new Set(pending) }) as JjView;

describe("englishRowFactsOf", () => {
  it("행 값·담당자·진도로 사실을 만든다(보고서 단어 테스트 값 포함)", () => {
    const f = englishRowFactsOf(st, su, { draft: "", sent: false, wordRetest: true, wordFeedback: "철자" }, {}, CTX);
    expect(f).toMatchObject({ studentName: "학생", teacherName: "Jane", progress: "Unit 3", attitude: "좋음", homework: "100%", note: "잘함", wordRetest: true, wordFeedback: "철자" });
  });
});

describe("인재원 하루치 상태", () => {
  it("없거나 다시 받는 중이면 '불러오는 중' · 미연결·오류는 그대로", () => {
    expect(englishJjStatus(jjOf({}), "s1", CTX.activeDate)).toEqual({ kind: "loading" });
    expect(englishJjStatus(jjOf({ [KEY]: { status: "unlinked" } }, [KEY]), "s1", CTX.activeDate)).toEqual({ kind: "loading" });
    expect(englishJjStatus(jjOf({ [KEY]: { status: "unlinked" } }), "s1", CTX.activeDate)).toEqual({ kind: "unlinked" });
    expect(englishJjStatus(jjOf({ [KEY]: { status: "error", message: "x" } }), "s1", CTX.activeDate)).toEqual({ kind: "error", detail: "x" });
  });
  it("결과지 고르기는 받은 자료가 있을 때만", () => {
    expect(englishJjPick(jjOf({ [KEY]: { status: "unlinked" } }), "s1", CTX.activeDate)).toBeNull();
  });
});

describe("englishRowFlagsOf", () => {
  const deps = {
    findTemplate: () => null,
    englishFactsOf: () => englishRowFactsOf(st, su, undefined, {}, CTX),
    templatesLoaded: true,
    templateListFailed: false,
  };
  it("고른 템플릿이 목록에 없으면 — 목록을 제대로 받았을 때만 '삭제됨'", () => {
    expect(englishRowFlagsOf(st, su, { draft: "", sent: false, templateId: "gone" }, deps).templateGone).toBe(true);
    expect(englishRowFlagsOf(st, su, { draft: "", sent: false, templateId: "gone" }, { ...deps, templateListFailed: true }).templateGone).toBe(false);
    expect(englishRowFlagsOf(st, su, { draft: "", sent: false, templateId: "gone" }, { ...deps, templatesLoaded: false }).templateGone).toBe(false);
  });
});
