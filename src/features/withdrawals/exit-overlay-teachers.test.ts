import { describe, expect, it } from "vitest";
import { churnMonthOf, churnTeachersOf, churnZeroIds, currentHomeroomIds, teacherTints, TEACHER_TINTS, type ChurnView, type OverlayClass } from "./exit-overlay-teachers";

// 9월 퇴원율: 박(수학 담임)은 s1 수학 퇴원 · 오(수학 교시 담당)도 s1을 맡아 같이 · 윤(수학)은 분모만 · 리(영어)는 다른 과목.
const view: ChurnView = new Map([
  ["2026-09", {
    detail: new Map([
      ["park", [{ studentId: "s1", subjects: ["math"] }]],
      ["oh", [{ studentId: "s1", subjects: ["math"] }]],
      ["lee", [{ studentId: "s2", subjects: ["english"] }]],
    ]),
    eligible: new Map<string, ReadonlySet<string>>([
      ["park", new Set(["math"])],
      ["oh", new Set(["math"])],
      ["yoon", new Set(["math"])],
      ["lee", new Set(["english"])],
      ["both", new Set(["math", "english"])],
    ]),
  }],
]);

describe("퇴원 담당 = 강사평가 퇴원율이 낸 값", () => {
  it("🔴 줄의 선생님 = 그 달 퇴원율에 이 학생·이 과목 퇴원을 넣은 선생님 전부(담임 + 교시 담당)", () => {
    expect(churnTeachersOf(view, "s1", "math", "2026-09").sort()).toEqual(["oh", "park"]);
    // 다른 과목 줄 · 다른 달 · 퇴원율에 없는 학생 = 빈 배열('선생님 미반영').
    expect(churnTeachersOf(view, "s1", "english", "2026-09")).toEqual([]);
    expect(churnTeachersOf(view, "s1", "math", "2026-10")).toEqual([]);
    expect(churnTeachersOf(view, "s9", "math", "2026-09")).toEqual([]);
  });

  it("🔴 '퇴원 0' = 이 과목 분모가 있고 이 과목 분자가 없는 선생님 — 분모 없는 사람(학생 없는 반의 담임)은 서지 않는다", () => {
    expect(churnZeroIds(view, "math", "2026-09").sort()).toEqual(["both", "yoon"]);
    expect(churnZeroIds(view, "english", "2026-09").sort()).toEqual(["both"]);
    expect(churnZeroIds(view, "math", "2026-08")).toEqual([]);
  });
});

describe("선생님 색", () => {
  const cls = (p: Partial<OverlayClass> & Pick<OverlayClass, "id" | "teacherId">): OverlayClass => ({ active: true, closedOn: null, special: false, ...p });

  it("색 기준 = 오늘 담임(그날 담임 판정을 그대로) — 종강·폐지·특강 제외", () => {
    const list = [
      cls({ id: "A", teacherId: "park" }),
      cls({ id: "B", teacherId: "oh" }),
      cls({ id: "done", teacherId: "gone", closedOn: "2026-09-01" }),
      cls({ id: "arch", teacherId: "arch", active: false }),
      cls({ id: "sp", teacherId: "sp", special: true }),
    ];
    // B는 기록상 오늘 담임이 한 — owner가 이긴다.
    const owner = (c: OverlayClass) => (c.id === "B" ? "han" : c.teacherId);
    expect(currentHomeroomIds(list, owner, "2026-10-14").sort()).toEqual(["han", "park"]);
  });

  it("지금 담임 가나다순이 먼저, 나머지는 뒤에 — 16명을 넘으면 되풀이", () => {
    const tints = teacherTints(["박도윤", "김하늘"], ["오세린", "김하늘"]);
    expect(Object.keys(tints)).toEqual(["김하늘", "박도윤", "오세린"]);
    expect(tints["김하늘"]).toBe(TEACHER_TINTS[0]);
    const many = teacherTints(Array.from({ length: 17 }, (_, i) => `t${String(i).padStart(2, "0")}`), []);
    expect(many.t16).toBe(TEACHER_TINTS[0]);
  });
});

describe("퇴원율에서 찾을 달 — 퇴원율이 그만둔 날로 보는 날(buildStudentTracking과 같은 규칙)", () => {
  const classOf = (id: string) => ({ A: { closedAt: null, regular: true }, B: { closedAt: null, regular: true }, SP: { closedAt: null, regular: false }, C: { closedAt: "2026-09-20", regular: true } } as Record<string, { closedAt: string | null; regular: boolean }>)[id];
  it("🔴 퇴원하며 함께 닫힌 다음 달 반(시작일 = 종료일)은 다닌 적이 없다 — 원래 반이 끝난 달", () => {
    const ended = [
      { classId: "B", startDate: "2026-10-01", endDate: "2026-10-01" },
      { classId: "A", startDate: "2026-03-01", endDate: "2026-09-25" },
    ];
    expect(churnMonthOf(ended, "2026-09-25", classOf)).toBe("2026-09");
    // 원래 반이 14일 밖이라 함께 끝난 줄에 없으면 줄의 달(퇴원일).
    expect(churnMonthOf([ended[0]!], "2026-09-10", classOf)).toBe("2026-09");
  });
  it("반이 먼저 닫혔으면 닫힌 날 · 특강 반은 안 본다 · 정규 반이 없으면 줄의 달", () => {
    expect(churnMonthOf([{ classId: "C", startDate: "2026-03-01", endDate: "2026-10-02" }], "2026-10-02", classOf)).toBe("2026-09");
    expect(churnMonthOf([{ classId: "SP", startDate: "2026-07-01", endDate: "2026-10-05" }, { classId: "A", startDate: "2026-03-01", endDate: "2026-09-30" }], "2026-10-05", classOf)).toBe("2026-09");
    expect(churnMonthOf([{ classId: "SP", startDate: "2026-07-01", endDate: "2026-10-05" }], "2026-10-05", classOf)).toBe("2026-10");
  });
});
