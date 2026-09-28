import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { activityCategoryOf, activityGradeOf, buildActivityOptions } from "./activity-catalog";

/** log.ts는 server-only라 import 대신 텍스트로 읽는다(actions-registry.test와 같은 방식). */
function auditActions(): Record<string, string> {
  const src = readFileSync(join(process.cwd(), "src/features/audit/server/log.ts"), "utf8");
  const start = src.indexOf("export const AUDIT_ACTIONS = {");
  const end = src.indexOf("} as const;", start);
  const body = src.slice(start, end);
  return Object.fromEntries([...body.matchAll(/^\s{2}([a-z][a-z0-9_]*):\s*"([^"]*)"/gm)].map((m) => [m[1], m[2]]));
}

describe("슬랙 활동 분류", () => {
  it("🔴 모든 감사로그 액션이 분류돼 있다(새 액션은 activity-catalog.ts RULES에 한 줄)", () => {
    const keys = Object.keys(auditActions());
    expect(keys.length).toBeGreaterThan(300);
    expect(keys.filter((k) => activityCategoryOf(k) === null)).toEqual([]);
  });

  it("급여·이력서·근로계약·비밀번호·토큰은 고를 수 없다", () => {
    for (const k of [
      "payroll_upsert",
      "payslip_issue",
      "class_salary_update",
      "resume_view_unlock",
      "staff_create_from_resume",
      "staff_contract_update",
      "staff_password_reset",
      "self_password_change",
      "slack_connection_token",
    ]) {
      expect(activityGradeOf(k), k).toBe("forbid");
    }
  });

  it("돈 계열은 대상 없이(opaque), 일반 활동은 safe", () => {
    expect(activityGradeOf("invoice_create")).toBe("opaque");
    expect(activityGradeOf("session_terms_refresh")).toBe("opaque");
    expect(activityGradeOf("refund_request_create")).toBe("opaque");
    expect(activityGradeOf("leave_adjust")).toBe("opaque");
    expect(activityGradeOf("student_create")).toBe("safe");
    expect(activityGradeOf("enrollment_consultation_intake")).toBe("safe");
    expect(activityGradeOf("attendance_cell")).toBe("safe");
  });

  it("좁은 접두어가 먼저 — 상담은 원생이 아니라 상담으로", () => {
    expect(activityCategoryOf("student_consultation_create")).toBe("consult");
    expect(activityCategoryOf("enrollment_consultation_create")).toBe("consult");
    expect(activityCategoryOf("enrollment_assign")).toBe("students");
    expect(activityCategoryOf("class_review_submit")).toBe("staff");
    expect(activityCategoryOf("seat_jj_mark_edit")).toBe("sheets");
  });

  it("분류 안 된 키는 나가지 않는다", () => {
    expect(activityGradeOf("totally_new_thing")).toBe("forbid");
  });

  it("옵션은 라벨을 달고 분류 순서로", () => {
    const opts = buildActivityOptions({ inventory_asset_create: "자산 등록", student_create: "학생 등록" });
    expect(opts.map((o) => o.key)).toEqual(["student_create", "inventory_asset_create"]);
    expect(opts[0]).toEqual({ key: "student_create", label: "학생 등록", category: "students", grade: "safe" });
  });
});
