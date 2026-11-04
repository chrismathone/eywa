import { describe, expect, it } from "vitest";
import type { Sections } from "@/features/dashboard/overview/model";
import { narrowBySubject } from "./narrow";

const ok = <T,>(data: T) => ({ data, at: 1, error: false });
const groupOf = (key: string | null | undefined) => (key === "math" || key === "subject_1" ? "math" : key === "english" ? "english" : key ?? null);

const sections = {
  students: ok({
    enrolled: 300,
    subjects: [{ label: "math", value: 200 }, { label: "english", value: 150 }, { label: "korean", value: 20 }],
    levels: [{ label: "초등", value: 100 }],
    schools: [{ label: "침산중", value: 40 }],
    concurrent: 60,
    subjectCombinations: [{ subjects: ["math"], value: 140 }, { subjects: ["english"], value: 90 }, { subjects: ["korean"], value: 20 }],
    programs: { eie: 80, injaewon: 90, math: 200, both: 60, noEnrollment: 4, otherOnly: 3 },
    gradeSplit: { rows: [{ label: "중1", englishOnly: 1, both: 1, mathOnly: 1 }], neither: 0 },
  }),
  firstClass: ok([
    { studentId: "a", name: "가", kind: "first", subjects: ["math", "english"] },
    { studentId: "b", name: "나", kind: "first", subjects: ["english"] },
  ]),
  absent: ok({
    from: "2026-09-23",
    to: "2026-09-29",
    students: [
      { studentId: "b", name: "나", count: 3, unnotified: 0, absences: [
        { date: "2026-09-24", classId: "e2", className: "E2", subject: "english", preNotified: true, teachers: [] },
        { date: "2026-09-25", classId: "e2", className: "E2", subject: "english", preNotified: true, teachers: [] },
        { date: "2026-09-26", classId: "e2", className: "E2", subject: "english", preNotified: true, teachers: [] },
      ] },
      { studentId: "a", name: "가", count: 2, unnotified: 2, absences: [
        { date: "2026-09-24", classId: "e1", className: "E1", subject: "english", preNotified: false, teachers: [] },
        { date: "2026-09-24", classId: "m1", className: "M1", subject: "math", preNotified: false, teachers: [] },
      ] },
      { studentId: "c", name: "다", count: 3, unnotified: 1, absences: [
        { date: "2026-09-24", classId: "e3", className: "E3", subject: "english", preNotified: false, teachers: [] },
        { date: "2026-09-25", classId: "m3", className: "M3", subject: "math", preNotified: true, teachers: [] },
        { date: "2026-09-26", classId: "m3", className: "M3", subject: "math", preNotified: true, teachers: [] },
      ] },
    ],
  }),
  withdrawals: ok({ month: "2026-10", rows: [{ id: "w1", program: "math" }, { id: "w2", program: "eie" }, { id: "w3", program: null }],
    carried: [{ id: "c1", program: "math", subject: "math", countMonth: "2026-09" }, { id: "c2", program: "eie", subject: "english", countMonth: "2026-09" }] }),
  englishSheet: ok({ period: "", classes: 1, filled: 1, total: 2 }),
  mathSheet: ok({ period: "", classes: 1, filled: 1, total: 2 }),
} as unknown as Sections;

describe("과목 관리자 — 담당 과목으로 좁히기(서버)", () => {
  const math = narrowBySubject(sections, ["math"], groupOf, false);

  it("담당 과목이 여럿이어도 동시 수강 학생은 재원생 한 명으로 센다", () => {
    const full: Sections = { ...sections, students: ok({ ...sections.students!.data!, subjectCombinations: [
      { subjects: ["math"], value: 140 }, { subjects: ["english"], value: 90 },
      { subjects: ["math", "english"], value: 60 }, { subjects: ["korean"], value: 20 },
    ] }) };
    expect(narrowBySubject(full, ["math", "english"], groupOf, false).students?.data?.enrolled).toBe(290);
    expect(narrowBySubject(full, ["english"], groupOf, false).students?.data?.enrolled).toBe(150);
  });

  it("재원생 수 = 수학 프로그램, 과목 막대·조합은 수학만, 학년·학교 구성은 놓이지 않았으면 비운다", () => {
    expect(math.students?.data?.enrolled).toBe(200);
    expect(math.students?.data?.subjects.map((r) => r.label)).toEqual(["math"]);
    expect(math.students?.data?.subjectCombinations?.map((c) => c.subjects.join("+"))).toEqual(["math"]);
    expect(math.students?.data?.programs).toMatchObject({ eie: 0, injaewon: 0, math: 200, noEnrollment: 0, otherOnly: 0 });
    expect(math.students?.data?.schools).toEqual([]);
    expect(narrowBySubject(sections, ["math"], groupOf, true).students?.data?.schools).toHaveLength(1);
    expect(math.students?.data?.academy).toBeUndefined();
  });

  it("학년·학교 구성 칸이 놓이면 재원생·미수강도 학원 전체 값을 함께 싣는다 — '(학원 전체)' 카드 한 장에 두 범위가 섞이지 않게(리뷰 2026-10-14)", () => {
    const wide = narrowBySubject(sections, ["math"], groupOf, true).students?.data;
    const all = sections.students?.data;
    expect(wide?.enrolled).toBe(200);
    expect(wide?.academy).toEqual({ enrolled: all?.enrolled, noEnrollment: all?.programs.noEnrollment });
  });

  it("오늘첫수업·최근 결석은 담당 과목 학생만 — 결석은 담당 과목 반 것만 남기고 다시 센다(횟수·연락 필요·정렬)", () => {
    expect(math.firstClass?.data?.map((r) => [r.studentId, r.subjects])).toEqual([["a", ["math"]]]);
    const rows = math.absent?.data?.students ?? [];
    // 수학 결석만: 다(2회 · 둘 다 사전 통보) → 가(1회 · 연락 필요). 나(영어만)는 빠진다.
    expect(rows.map((r) => [r.studentId, r.count, r.unnotified])).toEqual([["c", 2, 0], ["a", 1, 1]]);
    expect(rows[1]?.absences.map((a) => a.className)).toEqual(["M1"]);
  });

  it("퇴원 명단은 마지막 수강 프로그램으로 가르고(둘 다 모르면 모두에게), 강사 시트는 담당 과목 것만", () => {
    expect(math.withdrawals?.data?.rows.map((r) => r.id)).toEqual(["w1", "w3"]);
    // '앞 달로 센' 줄(원장 2026-11-03)도 같은 규칙 — 수학 관리자 팝업에 영어 줄이 서지 않는다.
    expect(math.withdrawals?.data?.carried?.map((r) => r.id)).toEqual(["c1"]);
    expect(math.mathSheet).toBeDefined();
    expect(math.englishSheet).toBeUndefined();
    const korean = narrowBySubject(sections, ["korean"], groupOf, false);
    expect(korean.withdrawals?.data?.rows.map((r) => r.id)).toEqual(["w3"]);
    expect(korean.mathSheet).toBeUndefined();
  });

  it("등록 후 3개월 내 퇴원 — 끝난 과목 중 하나라도 담당이면(두 과목은 양쪽에), 과목을 모르면 모두에게", () => {
    const withEarly = {
      ...sections,
      earlyExits: ok({
        month: "2026-10",
        rows: [
          { id: "e1", subjects: ["math"] },
          { id: "e2", subjects: ["english"] },
          { id: "e3", subjects: ["english", "math"] },
          { id: "e4", subjects: [] },
        ],
        // 지난 달들도 같은 판정으로 좁힌다(달마다 칸이 학원 전체 값으로 남지 않게).
        history: [
          { month: "2026-09", days: 10, subjects: ["math"] },
          { month: "2026-09", days: 20, subjects: ["english"] },
          { month: "2026-08", days: 30, subjects: [] },
        ],
      }),
    } as unknown as Sections;
    const math = narrowBySubject(withEarly, ["math"], groupOf, false).earlyExits?.data;
    expect(math?.rows.map((r) => r.id)).toEqual(["e1", "e3", "e4"]);
    expect(math?.history.map((h) => h.days)).toEqual([10, 30]);
    expect(narrowBySubject(withEarly, ["english"], groupOf, false).earlyExits?.data?.rows.map((r) => r.id)).toEqual(["e2", "e3", "e4"]);
  });

  it("과목을 모르는 결석·첫수업 학생은 모든 과목 관리자에게(원장 2026-10-14 결정 1)", () => {
    const unknown = { ...sections,
      absent: ok({ from: "2026-09-23", to: "2026-09-29", students: [{ studentId: "u", name: "모", count: 1, unnotified: 1, absences: [{ date: "2026-09-24", classId: "x", className: null, subject: null, preNotified: false, teachers: [] }] }] }),
      firstClass: ok([{ studentId: "u", name: "모", kind: "first", subjects: [null] }]),
    } as unknown as Sections;
    for (const g of [["math"], ["english"]]) {
      const out = narrowBySubject(unknown, g, groupOf, false);
      expect(out.absent?.data?.students.map((r) => r.studentId)).toEqual(["u"]);
      expect(out.firstClass?.data?.map((r) => r.studentId)).toEqual(["u"]);
    }
  });

  it("담당 과목을 못 정했으면(빈 묶음) 아무것도 통과시키지 않는다", () => {
    const none = narrowBySubject(sections, [], groupOf, false);
    expect(none.students?.data?.enrolled).toBe(0);
    expect(none.firstClass?.data).toEqual([]);
    expect(none.absent?.data?.students).toEqual([]);
  });
});
