import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { explainDbError } from "@/lib/supabase/db-error";

/**
 * 직원 완전 삭제 — **한 거래로**(DB 함수 `delete_staff_account` · s2_0082) · 2026-11-11 Claude·Codex 검토 H1.
 *
 * 전에는 로그인 계정(auth)을 지운 뒤 직원 행(public.users)을 지웠다. 직원 행 삭제가 FK에 막히면 로그인 계정만 사라졌다(되돌릴 수 없다).
 * 순서만 뒤집으면(직원 행 → 로그인 계정) 로그인 계정 삭제가 실패했을 때 계정이 남고, auth → public 미러 트리거가 그 계정의 다음 갱신
 * (로그인만 해도 일어난다) 때 직원 행을 원래 역할로 되살린다. 그래서 둘을 같은 거래에서 지운다 — 막히면 아무것도 지워지지 않는다.
 *
 * 함수가 하는 일: 로그인 계정·직원 행 잠금 → 이 직원을 가리켜 삭제를 막는 기록 검사(`staff_delete_blockers` · s2_0080 —
 * 표 이름을 코드에 적지 않고 DB 카탈로그의 FK를 전부 본다. 새 표가 생겨도 빠지지 않고, 아직 없는 표 때문에 죽지 않는다) → 직원 행 → 로그인 계정.
 * 🔴 검사에 실패해도(함수 없음 포함) 지우지 않는다 — 모르는 채로 지우지 않는다. 기록이 있으면 '퇴사(비활성)'를 안내한다.
 * 🔴 삭제 경로에서 Auth 서버(`auth.admin.deleteUser`)를 따로 부르지 말 것 — 두 번에 나눠 지우면 위의 중간 상태가 다시 생긴다(가드 delete-blockers.test.ts).
 */
const LABELS: Record<string, string> = {
  attendance_records: "출결 기록",
  academy_work_records: "업무 문서", academy_work_record_events: "업무 문서",
  academy_knowledge_records: "관찰·후속 조치 기록(작성·담당)", academy_model_versions: "스키마 스튜디오 변경 기록",
  organization_okr: "조직·OKR 목표", organization_okr_revisions: "조직·OKR 목표",
  student_onboarding_feedback: "신규생 적응 피드백", student_onboarding_followup_events: "신규생 적응 피드백",
  student_onboarding_manager_defaults: "신규생 관리 담당", student_onboarding_subject_assignments: "신규생 관리 담당",
  enrollment_journey_records: "콜&상담 여정 기록", enrollment_journey_revisions: "콜&상담 여정 기록",
  management_accounting_reports: "경영 회계 자료", management_accounting_versions: "경영 회계 자료", management_source_batches: "경영 회계 자료",
  management_review_events: "경영 검토 기록", management_ai_reviews: "경영 검토 기록",
  management_collection_devices: "자료 수집 PC 설정", management_collection_settings: "자료 수집 PC 설정",
  teacher_capacity_plans: "강사 배정 상한", teacher_capacity_events: "강사 배정 상한",
  withdrawal_reports: "퇴원보고서", withdrawal_report_groups: "퇴원보고서", withdrawal_report_events: "퇴원보고서", withdrawal_report_archive_mappings: "퇴원보고서",
  help_posts: "도움말 글", help_answers: "도움말 글", support_requests: "고객센터 문의",
  student_care_commitments: "상담 약속", lesson_reports: "수업보고서", invoice_session_terms: "회차 확정 기록",
  homework_video_assignments: "영상 숙제 기록", homework_video_assignment_history: "영상 숙제 기록",
};
const OTHER = "그 밖의 업무 기록";
const DEACTIVATE = "'퇴사(비활성)' 처리를 권장합니다.";
const REFUSED_BY_RECORDS: ReadonlySet<string> = new Set(["23503", "23502", "23514", "42501", "P0001"]);

export type StaffDeleteResult = { ok: true; loginDeleted: boolean } | { ok: false; error: string };

/** 직원 행과 로그인 계정을 한 거래로 지운다. 막히면 화면에 그대로 낼 한글 안내를 돌려준다(이때 지워진 것은 없다). */
export async function deleteStaffAccount(tenantId: string, userId: string): Promise<StaffDeleteResult> {
  const { data, error } = await createAdminClient().rpc("delete_staff_account", { p_tenant: tenantId, p_user: userId });
  if (error) {
    const why = explainDbError(error, { scope: "staff.delete-account", op: "delete", fallback: "직원을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.", context: { staffId: userId } });
    // 검사가 못 본 갈래로 DB가 거절한 경우 — 지움 규칙이 다른 FK·NOT NULL(23503·23502), 그리고 따라 고쳐지는 표의 '고치지 마라' 트리거
    // (42501·P0001·23514 — 예: 덧붙이기만 되는 이력 표의 담당자 칸을 비우려다 거절). 다시 눌러도 같으므로 '잠시 후 다시'가 아니라
    // 비활성 처리를 안내한다(트리거의 문장은 그 표의 사정이라 여기서는 엉뚱하다). 보호 계정 거절만 그 문장 그대로 보여 준다.
    // (함수 실행권이 빠진 42501 "permission denied for function"은 기록 탓이 아니다 — 일반 안내로 둔다.)
    if (REFUSED_BY_RECORDS.has(error.code ?? "") && !/보호된 계정|permission denied for function/i.test(error.message ?? "")) {
      return { ok: false, error: `이 직원 앞으로 남은 기록이 있어 완전 삭제할 수 없습니다. ${DEACTIVATE}` };
    }
    return { ok: false, error: why.message };
  }
  const result = (data ?? {}) as { status?: string; tables?: string[]; login?: boolean };
  if (result.status === "deleted") return { ok: true, loginDeleted: result.login === true };
  if (result.status === "blocked") return { ok: false, error: staffDeleteBlockedMessage(result.tables ?? []) };
  if (result.status === "not_found") return { ok: false, error: "대상 직원을 찾을 수 없습니다" };
  return { ok: false, error: "직원을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요." };
}

/** 막힌 표 이름 → 안내 문구(표 이름 원문은 화면에 내지 않는다 · 같은 종류는 한 번 · 최대 4종류). */
export function staffDeleteBlockedMessage(tables: string[]): string {
  const kinds = [...new Set(tables.map((t) => LABELS[t] ?? OTHER))];
  const named = kinds.filter((k) => k !== OTHER), shown = named.slice(0, 4);
  const rest = kinds.length - shown.length;
  const list = shown.length ? `${shown.join(" · ")}${rest > 0 ? ` 외 ${rest}종` : ""}` : OTHER;
  return `이 직원이 남긴 기록(${list})이 있어 완전 삭제할 수 없습니다. ${DEACTIVATE}`;
}
