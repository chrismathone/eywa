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
    date: "2026-09-30",
    absent: [
      { studentId: "a", name: "가", subject: "english", classes: [{ subject: "english", name: "E1" }, { subject: "math", name: "M1" }], preNotified: false, statuses: ["excused", "absent"] },
      { studentId: "c", name: "다", subject: "english", classes: [{ subject: "english", name: "E3" }, { subject: "math", name: "M3" }], preNotified: false, statuses: ["excused"] },
      { studentId: "b", name: "나", subject: "english", classes: [{ subject: "english", name: "E2" }], preNotified: true, statuses: ["absent"] },
    ],
    partial: [],
  }),
  withdrawals: ok({ month: "2026-10", rows: [{ id: "w1", program: "math" }, { id: "w2", program: "eie" }, { id: "w3", program: null }] }),
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

  it("오늘첫수업·전일 결석은 담당 과목 학생만, 다른 과목 반·상태는 지운다", () => {
    expect(math.firstClass?.data?.map((r) => [r.studentId, r.subjects])).toEqual([["a", ["math"]]]);
    const rows = math.absent?.data?.absent ?? [];
    expect(rows.map((r) => r.studentId)).toEqual(["a", "c"]);
    expect(rows[0]?.classes.map((c) => c.name)).toEqual(["M1"]);
    expect(rows[0]?.subject).toBe("math");
    expect(rows[0]?.statuses).toEqual([]); // 상태가 둘이면 어느 것이 수학 반 것인지 몰라 비운다(영어 반의 공결이 붙어 보이지 않게)
    expect(rows[1]?.statuses).toEqual(["excused"]); // 상태가 하나면 모든 칸이 그 상태 — 그대로
  });

  it("퇴원 명단은 마지막 수강 프로그램으로 가르고(둘 다 모르면 모두에게), 강사 시트는 담당 과목 것만", () => {
    expect(math.withdrawals?.data?.rows.map((r) => r.id)).toEqual(["w1", "w3"]);
    expect(math.mathSheet).toBeDefined();
    expect(math.englishSheet).toBeUndefined();
    const korean = narrowBySubject(sections, ["korean"], groupOf, false);
    expect(korean.withdrawals?.data?.rows.map((r) => r.id)).toEqual(["w3"]);
    expect(korean.mathSheet).toBeUndefined();
  });

  it("과목을 모르는 결석·첫수업 학생은 모든 과목 관리자에게(원장 2026-10-14 결정 1)", () => {
    const unknown = { ...sections,
      absent: ok({ date: "2026-09-30", absent: [{ studentId: "u", name: "모", subject: null, classes: [], preNotified: false, statuses: ["absent"] }], partial: [] }),
      firstClass: ok([{ studentId: "u", name: "모", kind: "first", subjects: [null] }]),
    } as unknown as Sections;
    for (const g of [["math"], ["english"]]) {
      const out = narrowBySubject(unknown, g, groupOf, false);
      expect(out.absent?.data?.absent.map((r) => r.studentId)).toEqual(["u"]);
      expect(out.firstClass?.data?.map((r) => r.studentId)).toEqual(["u"]);
    }
  });

  it("담당 과목을 못 정했으면(빈 묶음) 아무것도 통과시키지 않는다", () => {
    const none = narrowBySubject(sections, [], groupOf, false);
    expect(none.students?.data?.enrolled).toBe(0);
    expect(none.firstClass?.data).toEqual([]);
    expect(none.absent?.data?.absent).toEqual([]);
  });
});
