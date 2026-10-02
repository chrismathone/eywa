// 담임 연결 계획 — 해제한 줄(`is_approved:false`)은 남아 있어도 연결이 아니다(자동 해제 뒤 같은 선생님을 다시 붙일 수 있어야 한다).
import { describe, expect, it } from "vitest";
import { TEACHER_MAP, isLiveEmployment, planTeacherLinks } from "./math-class-teachers.mjs";

const [name, tid] = Object.entries(TEACHER_MAP)[0];
const target = (over = {}) => ({ className: "가반", boardId: 100, teacher: name, teacherStatus: "active", ...over });

describe("담임 연결 계획", () => {
  it("살아 있는 연결이 있으면 건너뛴다", () => {
    const r = planTeacherLinks({ targets: [target()], emps: [{ id: 1, teacher_id: tid, class_in_charge: 100, is_approved: true }] });
    expect(r.todo).toEqual([]);
  });
  it("🔴 해제한 줄만 남아 있으면 다시 연결한다 — 남은 줄을 '이미 연결'로 세면 한 번 해제한 선생님을 그 반에 영영 못 붙인다", () => {
    const r = planTeacherLinks({ targets: [target()], emps: [{ id: 1, teacher_id: tid, class_in_charge: 100, is_approved: false }] });
    expect(r.todo.map((t) => t.tid)).toEqual([tid]);
  });
  it("담임 없음·퇴직·대응표에 없는 이름은 건너뛴다(사유)", () => {
    const r = planTeacherLinks({
      targets: [target({ teacher: null }), target({ className: "나반", teacherStatus: "resigned" }), target({ className: "다반", teacher: "모르는선생님" })],
      emps: [],
    });
    expect(r.todo).toEqual([]);
    expect(r.skipped).toEqual(["가반: 담임 없음", `나반: 담임 ${name} 퇴직`, "다반: 모르는선생님 — ClassNote 대응 미확인"]);
  });
  it("살아 있는 줄 판정 — 칸이 없으면(옛 응답 모양) 살아 있는 것으로 본다", () => {
    expect(isLiveEmployment({ is_approved: true })).toBe(true);
    expect(isLiveEmployment({})).toBe(true);
    expect(isLiveEmployment({ is_approved: false })).toBe(false);
  });
});
