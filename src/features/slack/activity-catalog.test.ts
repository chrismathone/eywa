import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { activityCategoryOf, activityGradeOf, availableActivityOptions, buildActivityOptions } from "./activity-catalog";

/** log.ts는 server-only라 import 대신 텍스트로 읽는다(actions-registry.test와 같은 방식). */
function auditActions(): Record<string, string> {
  const src = readFileSync(join(process.cwd(), "src/features/audit/server/log.ts"), "utf8");
  const start = src.indexOf("export const AUDIT_ACTIONS = {");
  const end = src.indexOf("} as const;", start);
  const body = src.slice(start, end);
  return Object.fromEntries([...body.matchAll(/^\s{2}([a-z][a-z0-9_]*):\s*"([^"]*)"/gm)].map((m) => [m[1], m[2]]));
}

describe("슬랙 활동 분류", () => {
  it("모든 스위치가 켜진 지점은 기존 선택지를 유지하고, 꺼진 기능의 활동만 숨긴다", () => {
    const labels = {
      student_create: "학생 등록",
      approval_request: "결재 요청",
      classnote_send: "ClassNote 발송",
      todays_math_exam_upload: "오늘 수학 성적표",
      video_homework_submit: "영상 숙제 제출",
      management_collector_run: "경영 수집",
    };
    const allOn = { moduleOn: () => true, todaysMath: true, videoReview: true, collector: true };
    expect(availableActivityOptions(labels, allOn)).toEqual(buildActivityOptions(labels));

    const visible = availableActivityOptions(labels, {
      moduleOn: () => false,
      todaysMath: false,
      videoReview: false,
      collector: false,
    });
    expect(visible.map((option) => option.key)).toEqual(["student_create"]);
  });

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
      // 감사로그 빈틈 메우기(2026-10-15) — 이력서 삭제(대상 = 이력서 성명) · 강사 급여 정책.
      "staff_resume_delete",
      "teacher_comp_update",
    ]) {
      expect(activityGradeOf(k), k).toBe("forbid");
    }
  });

  it("돈 계열은 대상 없이(opaque), 일반 활동은 safe", () => {
    expect(activityGradeOf("invoice_create")).toBe("opaque");
    expect(activityGradeOf("session_terms_refresh")).toBe("opaque");
    expect(activityGradeOf("refund_request_create")).toBe("opaque");
    expect(activityGradeOf("leave_adjust")).toBe("opaque");
    // 직원 휴가 · 수강료 견적(대상 = 학생 이름)도 대상 없이.
    expect(activityGradeOf("staff_leave_request")).toBe("opaque");
    expect(activityGradeOf("tuition_quote_save")).toBe("opaque");
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

  it("시간표 연습본 저장은 개인 사본이라 고를 수 없다 — 같은 분류의 가져오기 반영은 그대로 고를 수 있다", () => {
    expect(activityCategoryOf("timetable_lab_draft_save")).toBe("classes");
    expect(activityGradeOf("timetable_lab_draft_save")).toBe("forbid");
    expect(activityGradeOf("timetable_lab_draft_overwrite")).toBe("forbid");
    expect(activityGradeOf("timetable_lab_draft_delete")).toBe("forbid");
    expect(activityGradeOf("timetable_import_apply")).toBe("safe");
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
