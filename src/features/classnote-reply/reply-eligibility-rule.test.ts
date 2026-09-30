import { describe, expect, it } from "vitest";
import { candidatePeople, classReplyTeachers, currentClassIds, studentReplyTeachers, type ClassRow, type SlotRow, type UserRow } from "./reply-eligibility-rule";

/**
 * 답글 자격 = 벨 수신자 판정(notify-recipients.mjs) 그대로 — 여기선 DB 행 → 입력 변환이 판정을 비틀지 않는지 잠근다.
 * (판정 규칙 자체는 tests/unit/classnote-notify-recipients.test.ts가 잠근다.)
 */
const T = "tenant-1";
const TODAY = "2026-09-30";
const KEYS = ["math", "subject_1"];
const classes: ClassRow[] = [
  { id: "a", subject: "math", is_active: true, teacher_id: "hr" },
  { id: "eng", subject: "english", is_active: true, teacher_id: "engT" },
  { id: "old", subject: "math", is_active: false, teacher_id: "oldT" },
];
const slots: SlotRow[] = [
  { class_id: "a", day_of_week: "mon", start_time: "16:00:00", teacher_id: "sub", slot_teacher_label: null, valid_from: "2026-03-01", valid_to: null },
  { class_id: "a", day_of_week: "tue", start_time: "16:00:00", teacher_id: "ended", slot_teacher_label: null, valid_from: "2026-03-01", valid_to: "2026-09-01" },
];
const user = (id: string, over: Partial<UserRow> = {}): UserRow => ({ id, tenant_id: T, status: "active", system_role: "teacher", ...over });
const users = ["hr", "sub", "ended", "engT", "oldT", "dlg"].map((id) => user(id));
const base = { studentId: "s", classes, slots, delegations: [], users, keys: KEYS, tenant: T, today: TODAY };
const enr = (class_id: string, start_date: string | null, end_date: string | null = null, is_transferred = false) => ({ class_id, start_date, end_date, is_transferred });

describe("답글 자격 = 그 학생의 지금 담당(벨 수신자 판정 그대로)", () => {
  it("지금 다니는 수학 반의 담임·유효 교시 담당 — 끝난 교시 담당·영어 반·비활성 반은 아니다", () => {
    const got = studentReplyTeachers({ ...base, enrollments: [enr("a", "2026-03-02"), enr("eng", "2026-03-02"), enr("old", "2026-03-02")] });
    expect(got.sort()).toEqual(["hr", "sub"]);
  });

  it("미래 시작 수강은 아니다 · 반이동 당일 옛 반은 아니다 · 퇴원 예약(미래 종료)은 아직 다닌다", () => {
    expect(studentReplyTeachers({ ...base, enrollments: [enr("a", "2026-10-01")] })).toEqual([]);
    expect(studentReplyTeachers({ ...base, enrollments: [enr("a", "2026-03-02", TODAY, true)] })).toEqual([]);
    expect(studentReplyTeachers({ ...base, enrollments: [enr("a", "2026-03-02", "2026-10-15")] }).sort()).toEqual(["hr", "sub"]);
  });

  it("다른 지점·퇴사·학생 계정은 받지 않는다", () => {
    const u = [user("hr", { status: "inactive" }), user("sub", { tenant_id: "other" })];
    expect(studentReplyTeachers({ ...base, users: u, enrollments: [enr("a", "2026-03-02")] })).toEqual([]);
  });

  it("오늘 위임받은 사람은 받는다", () => {
    const delegations = [{ class_id: "a", delegate_user_id: "dlg", from_date: TODAY, to_date: TODAY, revoked_at: null }];
    expect(studentReplyTeachers({ ...base, delegations, enrollments: [enr("a", "2026-03-02")] }).sort()).toEqual(["dlg", "hr", "sub"]);
  });

  it("학생을 모르는 반 보드 글 = 그 반 지금 담당(과목이 다르면 없음)", () => {
    expect(classReplyTeachers({ ...base, classId: "a" }).sort()).toEqual(["hr", "sub"]);
    expect(classReplyTeachers({ ...base, classId: "eng" })).toEqual([]);
  });

  it("게시 명의의 반 이름은 오늘 다니는 반에서만 고른다(미래 시작·끝난 반·반이동 당일 옛 반 제외, 퇴원 예약은 포함)", () => {
    const got = currentClassIds(
      [enr("a", "2026-03-02"), enr("a", "2026-03-02"), enr("future", "2026-10-01"), enr("ended", "2026-03-02", "2026-09-29"), enr("moved", "2026-03-02", TODAY, true), enr("leaving", "2026-03-02", "2026-10-15"), enr("nodate", null)],
      TODAY,
    );
    expect(got.sort()).toEqual(["a", "leaving"]);
  });

  it("계정 상태는 판정에 나오는 사람만 읽는다", () => {
    expect(candidatePeople(classes, slots, [{ class_id: "a", delegate_user_id: "dlg", from_date: TODAY, to_date: TODAY, revoked_at: null }]).sort()).toEqual(
      ["dlg", "ended", "engT", "hr", "oldT", "sub"],
    );
  });
});
