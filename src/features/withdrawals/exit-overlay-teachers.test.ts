import { describe, expect, it } from "vitest";
import { churnMonthsFor, churnTeachersOf, churnZeroIds, currentHomeroomIds, teacherTints, TEACHER_TINTS, type ChurnView, type OverlayClass } from "./exit-overlay-teachers";

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

  it("🔴 퇴원율을 돌릴 달 = 석 달 열 + 앞뒤 한 달(이번 달을 넘지 않는다) — 어느 기준 달로 열어도 열마다 그 달과 앞뒤가 들어 있다", () => {
    expect(churnMonthsFor("2026-10", "2026-10")).toEqual(["2026-10", "2026-09", "2026-08", "2026-07"]);
    expect(churnMonthsFor("2026-09", "2026-10")).toEqual(["2026-10", "2026-09", "2026-08", "2026-07", "2026-06"]);
    expect(churnMonthsFor("2026-01", "2026-10")).toEqual(["2026-02", "2026-01", "2025-12", "2025-11", "2025-10"]);
    // 퇴원 8/31 · 수강 9/1 끝(윤채민) — 8월 열이 맨 오른쪽인 묶음(기준 10월)에서도, 맨 왼쪽인 묶음(기준 8월)에서도 9월 퇴원율을 본다.
    for (const anchor of ["2026-10", "2026-09", "2026-08"]) expect(churnMonthsFor(anchor, "2026-10")).toContain("2026-09");
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
