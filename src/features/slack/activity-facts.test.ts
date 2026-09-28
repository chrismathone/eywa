import { describe, expect, it } from "vitest";
import { activityFacts, factIds, shortDate, type FactLookups } from "./activity-facts";

const lk: FactLookups = {
  student: new Map([
    ["s1", { name: "김하늘", school: "칠성중", grade: "중1" }],
    ["s2", { name: "이서준", school: null, grade: null }],
  ]),
  klass: new Map([["c1", { name: "중등M 중1 A", subject: "math" }]]),
  subjectLabel: (k) => (k === "math" ? "수학" : ""),
};

describe("슬랙 활동 facts — 허용 키만 이름으로(원장 2026-09-28)", () => {
  it("출결 = 학생 · 반 · 날짜 교시 · 출결 한글", () => {
    const f = activityFacts("attendance_cell", { studentId: "s1", classId: "c1", date: "2026-09-28", slotStart: "17:15:00", status: "late", memo: "비밀 메모" }, lk);
    expect(f.brief).toEqual(["김하늘", "중등M 중1 A", "9/28(월) 17:15", "지각"]);
    expect(f.rows.map((r) => r.value)).toEqual(["김하늘 (칠성중1)", "중등M 중1 A · 수학", "9/28(월) 17:15 교시", "지각"]);
    expect(JSON.stringify(f)).not.toContain("비밀");
    expect(f.href).toBe("/students/s1");
  });
  it("출결이 아닌 액션의 status(발송 상태 원문)는 싣지 않는다", () => {
    const f = activityFacts("classnote_send", { studentId: "s1", status: "sent" }, lk);
    expect(JSON.stringify(f)).not.toContain("sent");
  });
  it("이름을 못 찾은 id는 버린다 — 원문 id 노출 금지", () => {
    const f = activityFacts("lesson_report_save", { studentId: "zzz-uuid", classId: "nope", subject: "physics" }, lk);
    expect(f).toEqual({ brief: [], rows: [], href: null });
  });
  it("여러 학생 = N명 + 앞 이름들", () => {
    const f = activityFacts("attendance_bulk", { studentIds: ["s1", "s2", "x"], count: 3 }, lk);
    expect(f.brief).toEqual(["학생 3명"]);
    expect(f.rows[0]).toEqual({ label: "학생", value: "김하늘, 이서준 외 1명" });
  });
  it("모양이 틀린 날짜·metadata는 무시", () => {
    expect(shortDate("어제")).toBeNull();
    expect(activityFacts("x", null, lk).brief).toEqual([]);
    expect(factIds(["s1"])).toEqual({ students: [], classes: [] });
  });
});
