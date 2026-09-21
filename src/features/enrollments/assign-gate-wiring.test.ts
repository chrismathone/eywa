import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 구조 가드 — "판정 함수는 만들었는데 아무도 안 부른다"(write-only-orphan)를 막는다.
 *
 * 이 영역의 유일한 실패 모드가 그거다: 순수 함수와 테스트는 초록인데 정작 **서버 액션이 안 불러서**
 * 휴원 학생에게 반이 그대로 배정된다. 화면 숨김은 게이트가 아니므로([[#77]]) 서버 쪽 배선이 진짜다.
 */
const ROOT = join(__dirname, "..", "..", "..");
// ⚠️ 체크아웃이 CRLF일 수 있다(Windows) — 줄바꿈을 정규화해야 여러 줄 패턴이 헛돌지 않는다.
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

describe("반 배정 게이트 배선", () => {
  const actions = read("src/features/enrollments/server/actions.ts");

  it("createEnrollment가 학생 상태를 읽고 enrollmentAssignBlockReason으로 거절한다", () => {
    expect(actions).toContain("enrollmentAssignBlockReason");
    // 상태를 실제로 조회하는지 — 판정 함수만 import하고 안 쓰면 게이트가 아니다.
    expect(actions).toContain('.from("students").select("status")');
  });

  it("거절이 createEnrollment 안(insert 앞)에서 일어난다 — 넣고 나서 판정하면 늦다", () => {
    const gate = actions.indexOf("enrollmentAssignBlockReason(stu.status");
    const insert = actions.indexOf('.from("enrollments")\n    .insert(');
    expect(gate).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(insert);
  });

  it("학생 상세 '수업' 탭도 같은 판정을 보여준다 — 버튼만 감추면 왜 못 하는지 모른다", () => {
    const tab = read("src/app/(shell)/students/[id]/_tabs/classes-tab.tsx");
    expect(tab).toContain("enrollmentAssignBlockReason");
    expect(tab).toContain("blockedReason=");
  });
});

describe("반 이동이 휴원 표식을 승계한다(0228a)", () => {
  const sql = read("supabase/migrations/0228a_move_enrollments_inherit_on_hold.sql");

  it("옛 수강의 on_hold를 읽어 새 행 insert에 싣는다", () => {
    expect(sql).toContain("move_enrollments_batch");
    expect(sql).toContain("select student_id, tenant_id, on_hold");
    expect(sql).toContain("attendance_days, on_hold)");
    expect(sql).toContain("coalesce(v_on_hold, false)");
  });

  it("0063a(대체 대상)는 손대지 않았다 — 옛 정의는 그대로 남는다", () => {
    const old = read("supabase/migrations/0063a_move_enrollments_attendance_days.sql");
    expect(old).not.toContain("on_hold");
  });
});

describe("단체 배정도 같은 게이트를 지난다(원장 2026-09-18)", () => {
  const actions = read("src/features/enrollments/server/actions.ts");
  const bulk = read("src/features/enrollments/server/bulk-assign-actions.ts");

  it("권한·재원생 판정을 한 명 배정과 같게 — 판정이 insert 앞에 있다", () => {
    expect(bulk).toContain('canManageTenant(user.systemRole, "classes")');
    expect(bulk).toContain('canManageTenant(user.systemRole, "students")');
    const gate = bulk.indexOf("enrollmentAssignBlockReason(statusOf.get(studentId)");
    const insert = bulk.indexOf('.from("enrollments")\n      .insert(');
    expect(gate).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(insert);
  });

  it("학생 상태는 청크로 읽는다(B3) · 등원 요일·겹침 안내는 한 명 배정과 같은 도우미", () => {
    expect(bulk).toContain("fetchInChunks(studentIds");
    expect(bulk).toContain("normalizeAttendanceDays(supabase, classId, pickedDays)");
    expect(bulk).toContain("describeOverlapConflict(supabase, studentId, classId, startDate, endDate)");
    expect(actions).toContain('from "./assign-helpers"');
  });

  it("들어간 학생마다 감사로그 — 한 명 배정과 같은 키", () => {
    expect(bulk).toContain('action: "enrollment_assign"');
    expect(bulk).toContain("done.map((r) =>\n        logAction(");
  });
});
