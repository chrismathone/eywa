import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readMigration } from "@/lib/db/migrations-corpus.mjs";
/**
 * 구조 가드 — **되돌릴 수 없는** 삭제라 배선이 하나만 빠져도 사고가 된다.
 * 잠그는 것: ① super_admin 통과 ② 기록 검사가 삭제보다 **먼저** ③ 감사로그 스냅샷
 * ④ 세는 표 전수 ⑤ 감사 액션 키 등록(안 하면 뷰어에 영문 키 원문 노출).
 */
const ROOT = join(__dirname, "..", "..", "..");
// ⚠️ 체크아웃이 CRLF일 수 있다(Windows) — 줄바꿈을 정규화해야 여러 줄 패턴이 헛돌지 않는다.
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const actions = read("src/features/enrollments/server/actions.ts");

describe("수업 이력 삭제 게이트", () => {
  it("미래 반 이동은 한쪽만 일반 삭제하지 못하게 한다", () => {
    expect(actions).toContain("enr.is_transferred_in && String(enr.start_date) > kstToday()");
    expect(actions).toContain("이전 반 수강도 함께 복구됩니다");
    expect(actions.indexOf("이전 반 수강도 함께 복구됩니다")).toBeLessThan(actions.indexOf('.rpc("delete_enrollment_history"'));
  });
  it("🔴 super_admin은 항상 통과한다(원장 2026-08-13 — 새 게이트에서 빼먹기 쉬운 결정)", () => {
    expect(actions).toContain("isCurrentUserSuperAdmin()");
  });

  it("원장(owner 콘솔 full)도 통과한다", () => {
    expect(actions).toContain('accessLevelTenant(user.systemRole, "owner")');
  });

  it("붙은 기록 판정이 실제 삭제보다 **먼저** 일어난다", () => {
    const check = actions.indexOf("enrollmentDeleteBlockReason({");
    const del = actions.indexOf('.rpc("delete_enrollment_history"');
    expect(check).toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(-1);
    expect(check).toBeLessThan(del);
  });

  it("확인 조회가 실패하면 삭제하지 않는다 — '못 셌으니 없나 보다'는 되돌릴 수 없다", () => {
    expect(actions).toContain("DELETE_PROBE_FAILED");
    expect(actions).toContain("if (!counts) return { error: DELETE_PROBE_FAILED }");
  });

  it("실제로 지워진 행을 확인한다 — RLS가 막으면 error 없이 0행이라 성공으로 위장한다", () => {
    expect(actions).toContain("if (!deleted || deleted.length === 0)");
  });

  it("(student_id, class_id)를 둘 다 가진 표 전수 + 청구 계열을 센다", () => {
    for (const table of [
      "attendance_records",
      "lesson_reports",
      "onescreen_daily_sessions",
      "class_sheet_student_marks",
      "attendance_followups",
      "invoice_session_terms",
      "invoice_teacher_splits",
    ]) {
      expect(actions).toContain(`"${table}"`);
    }
    // 보강 반(0171a)도 이 반을 가리킬 수 있다 — 빠지면 보강 기록이 주인을 잃는다.
    expect(actions).toContain("makeup_class_id.eq.");
  });

  it("🔴 세는 조회는 admin + tenant 필터 — 정책 0개 표(class_sheet_*)는 세션 클라로 늘 0행이다(#104)", () => {
    expect(actions).toContain("countEnrollmentRecords(createAdminClient()");
    // admin은 테넌트 격리가 없다 — 모든 세는 조회가 tenant_id로 좁혀야 한다.
    const body = actions.slice(
      actions.indexOf("async function countEnrollmentRecords"),
      actions.indexOf("export async function deleteEnrollment"),
    );
    const selects = body.split('.select("id"').length - 1;
    const tenantFilters = body.split('.eq("tenant_id", tenantId)').length - 1;
    expect(selects).toBeGreaterThan(0);
    expect(tenantFilters).toBeGreaterThanOrEqual(selects);
  });

  it("🔴 실제 삭제는 세션 클라이언트로 — RLS 우회는 '세는 데'까지다", () => {
    const del = actions.slice(actions.indexOf("export async function deleteEnrollment"));
    expect(del).toContain("await createClient()");
    expect(del).not.toContain("createAdminClient().from(\"enrollments\").delete");
  });

  it("🔴 형제 수강을 **개수만** 세지 않고 salary_tier까지 읽는다 — head 카운트로 되돌리면 정산이 조용히 줄어든다", () => {
    expect(actions).toContain('.select("id, salary_tier")');
    expect(actions).toContain("siblingHasTier");
    expect(actions).toContain("thisRowHasTier");
  });

  it("지운 행을 통째로 스냅샷해 감사로그에 남긴다(원장 지시 '대신 감사 로그에는 남겨')", () => {
    const sql = readMigration("0429a_enrollment_history_delete.sql");
    expect(sql).toContain("'enrollment_delete'");
    expect(sql).toContain("'snapshot',jsonb_build_object");
    // 손으로 되살릴 수 있을 만큼 — 기간·요일·휴원 표식까지.
    for (const key of ["startDate", "endDate", "attendanceDays", "onHold", "withdrawalReason"]) {
      expect(sql).toContain(`'${key}'`);
    }
  });
});

describe("감사 액션 키 등록", () => {
  it("AUDIT_ACTIONS + describe 양쪽에 등록됐다(안 하면 뷰어에 영문 키 원문 노출)", () => {
    expect(read("src/features/audit/server/log.ts")).toContain("enrollment_delete:");
    expect(read("src/features/audit/describe.ts")).toContain('case "enrollment_delete"');
  });
});
