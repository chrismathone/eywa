/** 직원 포트폴리오 계산의 입력 — DB 행 모양 그대로(snake_case). `types.ts`가 다시 내보낸다. */

/**
 * `employment_type` = 계약구분(정규직·아르바이트·프리랜서·혼합) — 프리랜서는 근태 만점(원장 2026-10-16). 옛 스냅샷엔 없다.
 * `work_days` = 혼합 계약(근로 + 용역)의 근로 요일(`mon`…) — 근태는 이 요일만 센다(출석부 비율표 `workDays`, 혼합인 직원만 싣는다).
 */
export type SnapshotUser = {
  id: string; display_name: string; status: string; subjects: string[] | null; employment_type?: string | null; work_days?: string[] | null;
  /** 재직 기간(2026-11-11) — 입사일 · 퇴사일(퇴사 상태일 때 퇴사 메모 → 퇴사 처리 기록). 이 밖의 날은 담임·교시 담당이 아니다. 옛 스냅숏엔 없다. */
  hire_date?: string | null; resign_date?: string | null;
};
export type SnapshotClass = {
  id: string; class_name: string; subject: string; english_track: string | null; teacher_id: string | null;
  is_active: boolean; closed_at: string | null; report_optout: boolean | null; is_makeup_pool: boolean | null;
  /** 특강 반 — 끝난 특강은 퇴원율에서 빼므로(퇴원관리와 같은 규칙) 읽는다. 옛 스냅샷엔 없다. */
  is_special?: boolean | null;
};
export type SnapshotSchedule = {
  id: string; class_id: string; day_of_week: string; start_time: string; end_time: string | null;
  teacher_id: string | null; slot_teacher_label: string | null; lab_separate: boolean | null;
  valid_from: string; valid_to: string | null;
};
export type SnapshotEnrollment = {
  id: string; student_id: string; class_id: string; start_date: string; end_date: string | null;
  on_hold: boolean; attendance_days: string[] | null; is_transferred: boolean; is_transferred_in: boolean;
  /** 종료 사유 — 퇴원 사유 코드(`graduated`…) 또는 자유 글('반 이동'·'반 폐지'·'종강' …). 옛 스냅샷엔 없다. */
  withdrawal_reason?: string | null;
};
export type SnapshotAttendance = {
  id: string; class_id: string; student_id: string; session_date: string; slot_start: string | null;
  status: string; recorded_at: string; supersedes_id: string | null; seat_label: string | null;
  recorded_via: string | null; taught_by: string | null; note: string | null;
  /** 넣은 사람(키오스크 셀프 체크인은 null) — 출결 점수는 본인이 넣은 것만 센다. 옛 스냅샷엔 없다. */
  recorded_by?: string | null;
};
export type SnapshotReport = {
  id: string; student_id: string; class_id: string | null; report_date: string; created_by: string | null;
  created_at: string | null; covers_date: string | null; makeup: boolean | null;
};
/**
 * 출결 행을 누가 언제 넣거나 고쳤나 — 활동 기록(`activity_log`, DB 트리거)의 출결 입력·수정 한 줄(한국 날짜).
 * 출결은 고칠 때 같은 행을 덮어써 입력자·시각이 바뀌므로, '본인이 그날 넣었나'는 이 기록으로 본다(원장 2026-10-14 당일·본인 규칙).
 */
export type SnapshotAttendanceTouch = { row_id: string; actor_id: string; day: string };
/**
 * 소개한 사람이 이어진 콜&상담(0362a) — 강사평가 원생 소개. 같은 사람 판정은 이어진 원생, 없으면 이름·학교·학년(원생 자연키와 같은 축)
 * — 연락처는 읽지 않는다(이 파일의 원칙).
 */
export type SnapshotReferral = {
  id: string; referrer_student_id: string | null; referrer_staff_id: string | null;
  consultation_date: string | null; received_date: string | null; created_at: string;
  subject: string | null; student_id: string | null; prospect_name: string | null; prospect_school: string | null; prospect_grade: string | null;
};
export type SnapshotConsultation = {
  id: string; student_id: string; counselor_id: string | null; follow_up_date: string | null;
  follow_up_done: boolean | null; consulted_at: string; updated_at: string | null;
};
export type SnapshotReviewSheet = { scores?: unknown; submittedAt?: string | null; completedAt?: string | null; byId?: string | null };
export type SnapshotReview = {
  id: string; staff_user_id: string | null; header: { teacherId?: string | null } | null; areas: unknown;
  template_name: string | null; submissions: Record<string, SnapshotReviewSheet>;
};
export type SnapshotTransition = {
  class_id: string | null; target_label: string | null; teacher_id: string; previous_teacher_id: string | null; date: string;
};
/** activity_log의 담임 변경 한 줄(감사로그에 안 남는 경로까지 — `homeroom-history.ts`). */
export type { ActivityTeacherChange } from "./homeroom-history";
export type SnapshotDelegation = { class_id: string; delegate_user_id: string; from_date: string; to_date: string };
export type SnapshotInvoice = {
  id: string; student_id: string; period: string; amount_total: number | string; amount_discount: number | string | null;
  line_items: unknown;
};
export type SnapshotTerm = {
  id: string; invoice_id: string; class_id: string; amount: number | string | null; confirmed_sessions: number | string | null;
  allocation_line_index: number | null; allocation_amount: number | string | null; allocation_source: unknown;
  allocation_base_amount: number | string | null;
};
export type SnapshotMakeup = {
  id: string; student_id: string; class_id: string; absence_date: string | null; makeup_date: string | null;
  status: string; done_at: string | null;
};
