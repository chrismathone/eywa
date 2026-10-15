/**
 * 퇴원관리 분석 축 · 사유 묶음(원장 2026-10-15). 칸 숫자 = 그 칸을 눌러 거른 명단 수여야 한다 — 같은 함수가 두 쪽을 낸다.
 */
import { describe, expect, it } from "vitest";
import {
  FACET_NONE,
  REASON_CLEANUP,
  attributeTeachers,
  gradeItems,
  judgeSubjects,
  parseBreakdownAxis,
  parseFacet,
  reasonFacetLabel,
  reasonFacetOf,
  schoolItems,
  subjectItems,
  teacherFacetsIn,
  teacherItems,
} from "./breakdown";

const facet = (over: Partial<{ cleanup: boolean; reasonKey: string | null; reasonLabel: string | null }>) =>
  reasonFacetOf({ cleanup: false, reasonKey: null, reasonLabel: null, ...over });

describe("사유 묶음 — 막대와 필터가 같은 값", () => {
  it("🔴 장부 정리(일괄 퇴원)는 '기타'가 아니라 따로 — 사유 키가 기타여도", () => {
    expect(facet({ cleanup: true, reasonKey: "other", reasonLabel: "기타" })).toEqual({ value: REASON_CLEANUP, label: "장부 정리" });
  });
  it("표준 사유 = 키(퇴원 사유 · 수강 종료 사유가 키든 한글 라벨이든 표기 흔들림이든)", () => {
    expect(facet({ reasonKey: "dissatisfaction", reasonLabel: "수업 불만족" })).toEqual({ value: "dissatisfaction", label: "수업 불만족" });
    expect(facet({ reasonKey: null, reasonLabel: "dissatisfied" })).toEqual({ value: "dissatisfaction", label: "수업 불만족" });
    expect(facet({ reasonKey: null, reasonLabel: "졸업" })).toEqual({ value: "graduated", label: "졸업" });
  });
  it("🔴 자유 글(수강 종료의 '반 폐지' 등)은 기타로 뭉개지 않는다 — 키가 기타로 접혀 있어도", () => {
    expect(facet({ reasonKey: "other", reasonLabel: "반 폐지" })).toEqual({ value: "t:반 폐지", label: "반 폐지" });
    expect(reasonFacetLabel("t:반 폐지")).toBe("반 폐지");
  });
  it("🔴 영문 키가 글로 남은 옛 퇴원(메타데이터 없음)도 한글로 — raw 코드를 화면에 내지 않는다(퇴원율과 같은 `reasonKeyOf`)", () => {
    expect(facet({ reasonKey: null, reasonLabel: "other" })).toEqual({ value: "other", label: "기타" });
    expect(facet({ reasonKey: "other", reasonLabel: "기타" })).toEqual({ value: "other", label: "기타" });
    // 대소문자 흔들림 · 별칭 · 모르는 영문 코드(기타로) — 자유 글 막대로 영문이 새지 않는다.
    expect(facet({ reasonKey: null, reasonLabel: "Moved" })).toEqual({ value: "relocation", label: "이사" });
    expect(facet({ reasonKey: null, reasonLabel: "unknown_code" })).toEqual({ value: "other", label: "기타" });
  });
  it("아무것도 없으면 미기재", () => {
    expect(facet({})).toEqual({ value: "unspecified", label: "미기재" });
    expect(reasonFacetLabel("unspecified")).toBe("미기재");
    expect(reasonFacetLabel("cleanup")).toBe("장부 정리");
    expect(reasonFacetLabel("nope")).toBeNull();
  });
});

describe("분석 축", () => {
  it("축·칸 주소 값 정리 — 모르는 축은 과목(기본) · 빈 값·너무 긴 값은 필터 없음", () => {
    expect(parseBreakdownAxis("teacher")).toBe("teacher");
    expect(parseBreakdownAxis("x")).toBe("subject");
    expect(parseFacet(" 중2 ")).toBe("중2");
    expect(parseFacet("")).toBeNull();
    // 긴 자유 글 사유도 눌러 거를 수 있다(`t:` + 글).
    expect(parseFacet(`t:${"가".repeat(80)}`)).toBe(`t:${"가".repeat(80)}`);
    expect(parseFacet("가".repeat(301))).toBeNull();
  });

  it("과목 — 두 과목을 함께 끊은 줄은 과목마다 · 과목 미상은 맨 끝", () => {
    const items = subjectItems(
      [{ subjects: ["math", "english"] }, { subjects: ["math"] }, { subjects: [] }],
      (k) => ({ math: "수학", english: "영어" })[k] ?? k,
    );
    expect(items).toEqual([
      { value: "math", label: "수학", count: 2 },
      { value: "english", label: "영어", count: 1 },
      { value: FACET_NONE, label: "과목 미상", count: 1 },
    ]);
  });

  it("학년 — 학원설정 학년 순서대로(많은 순 아님) · 설정에 없는 학년은 그 뒤 · 미기재 맨 끝", () => {
    const rows = [{ grade: "고1" }, { grade: "고1" }, { grade: "중3" }, { grade: "N수" }, { grade: null }, { grade: " " }];
    expect(gradeItems(rows, ["초6", "중1", "중2", "중3", "고1"]).map((i) => [i.label, i.count])).toEqual([
      ["중3", 1],
      ["고1", 2],
      ["N수", 1],
      ["학년 미기재", 2],
    ]);
  });

  it("학교 — 많은 순(같으면 가나다) · 미기재 맨 끝", () => {
    const rows = [{ school: "침산중" }, { school: "경명여중" }, { school: "경명여중" }, { school: "대구일중" }, { school: null }];
    expect(schoolItems(rows).map((i) => i.label)).toEqual(["경명여중", "대구일중", "침산중", "학교 미기재"]);
  });

  it("강사 — 칸 값마다 한 건(함께 맡았으면 각각 · '담당 미반영'은 맨 끝) · 같은 id 두 번은 한 번 · 걸린 범위 밖(null)은 안 센다", () => {
    const of = new Map<string, string[] | null>([["a", ["t1", "t2"]], ["b", ["t1", "t1"]], ["c", [FACET_NONE]], ["d", ["t1", FACET_NONE]], ["e", null]]);
    const items = teacherItems(["a", "b", "c", "d", "e"], (k) => of.get(k) ?? null, (id) => ({ t1: "김선생", t2: "이선생" })[id] ?? null);
    expect(items).toEqual([
      { value: "t1", label: "김선생", count: 3 },
      { value: "t2", label: "이선생", count: 1 },
      { value: FACET_NONE, label: "담당 미반영", count: 2 },
    ]);
  });

  it("강사 판정 과목 — 걸린 과목·프로그램에 드는 과목만(수학만 보는데 함께 끊은 영어 선생님이 서지 않게)", () => {
    const group = (s: string) => (s === "math" ? "math" : s === "english" ? "english" : s);
    expect(judgeSubjects({ subjects: ["math", "english"] }, { subject: null, programGroup: "math" }, group)).toEqual(["math"]);
    expect(judgeSubjects({ subjects: ["math", "english"] }, { subject: "english", programGroup: null }, group)).toEqual(["english"]);
    expect(judgeSubjects({ subjects: ["math", "english"] }, { subject: null, programGroup: null }, group)).toEqual(["math", "english"]);
    // 🔴 걸린 과목이 프로그램 밖이면 null(어느 강사 칸에도 안 선다) — '담당 미반영'으로 세면 영어 선생님이 센 줄이 미반영이 된다.
    expect(judgeSubjects({ subjects: ["math", "english"] }, { subject: "english", programGroup: "math" }, group)).toBeNull();
    // 과목 미상 줄은 빈 배열(담당 미반영).
    expect(judgeSubjects({ subjects: [] }, { subject: null, programGroup: "math" }, group)).toEqual([]);
  });
});

describe("강사 가리기 — 시간표 X와 같은 순서(과목마다 퇴원율이 센 달 → 그 달 그 학생을 센 선생님)", () => {
  const row = (key: string, over: Partial<{ date: string | null; subjects: string[]; systemBulk: boolean; cleanup: boolean }> = {}) => ({
    key, studentId: `s-${key}`, date: "2026-09-10", subjects: ["math"], systemBulk: false, cleanup: false, ...over,
  });
  const calls: string[] = [];
  const judge = {
    endedOf: (studentId: string, subject: string, date: string) => {
      calls.push(`${studentId}|${subject}|${date}`);
      // 수강종료로 남았다 늦게 퇴원 처리된 학생 — 퇴원율은 수강이 끝난 6월에 셌다.
      return { endMonth: studentId === "s-late" ? "2026-06" : date.slice(0, 7) };
    },
    teachersOf: (studentId: string, subject: string, month: string) =>
      month === "2026-06" ? ["june"] : subject === "math" ? ["kim"] : subject === "english" ? ["lee"] : [],
  };
  const opts = { from: "2025-10-01", today: "2026-10-15" };
  it("🔴 줄의 모든 과목을 과목마다 판정해 둔다 — 걸린 과목은 읽는 쪽이 고른다(과목 카드가 과목마다 다시 물어도 같은 답)", () => {
    const out = attributeTeachers([row("a", { subjects: ["math", "english"] }), row("late")], judge, opts);
    expect([...out.get("a")!]).toEqual([["math", ["kim"]], ["english", ["lee"]]]);
    expect(teacherFacetsIn(out.get("a")!, ["math", "english"])).toEqual(["kim", "lee"]);
    expect(teacherFacetsIn(out.get("a")!, ["math"])).toEqual(["kim"]);
    // 과목 미상(빈 배열) = 담당 미반영 · 걸린 범위 밖(null) = 어느 칸에도 없음.
    expect(teacherFacetsIn(out.get("a")!, [])).toEqual([FACET_NONE]);
    expect(teacherFacetsIn(out.get("a")!, null)).toBeNull();
    // 퇴원율이 센 달(줄의 달과 다를 수 있다)로 찾는다.
    expect(teacherFacetsIn(out.get("late")!, ["math"])).toEqual(["june"]);
  });
  it("🔴 한 과목만 센 줄 = 그 선생님 + 담당 미반영 — 과목마다 물은 답(과목 카드)과 합친 답(명단)이 같다", () => {
    const per = new Map([["math", ["kim"]], ["english", []]]);
    expect(teacherFacetsIn(per, ["math", "english"])).toEqual(["kim", FACET_NONE]);
    expect(teacherFacetsIn(per, ["math"])).toEqual(["kim"]);
    expect(teacherFacetsIn(per, ["english"])).toEqual([FACET_NONE]);
  });
  it("🔴 장부 정리 · 날짜 미상 · 날짜 없는 줄 = 모든 과목 담당 미반영 — 판정하지 않는다", () => {
    calls.length = 0;
    const out = attributeTeachers([row("c", { cleanup: true }), row("b", { systemBulk: true }), row("n", { date: null })], judge, opts);
    expect(["c", "b", "n"].map((k) => teacherFacetsIn(out.get(k)!, ["math"]))).toEqual([[FACET_NONE], [FACET_NONE], [FACET_NONE]]);
    expect(calls).toEqual([]);
  });
  it("판정 폭 밖(가장 이른 날 앞 · 오늘 뒤) 줄은 결과에 없다 — 화면이 '가리지 않은 줄'로 따로 센다", () => {
    const out = attributeTeachers([row("old", { date: "2024-01-05" }), row("future", { date: "2026-11-01" })], judge, opts);
    expect(out.has("old")).toBe(false);
    expect(out.has("future")).toBe(false);
  });
});
