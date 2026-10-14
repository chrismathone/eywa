/** 직원 포트폴리오 계산의 입력 — DB 행 모양 그대로(snake_case). `types.ts`가 다시 내보낸다. */

export type SnapshotUser = { id: string; display_name: string; status: string; subjects: string[] | null };
export type SnapshotClass = {
  id: string; class_name: string; subject: string; english_track: string | null; teacher_id: string | null;
  is_active: boolean; closed_at: string | null; report_optout: boolean | null; is_makeup_pool: boolean | null; is_special?: boolean | null;
};
export type SnapshotSchedule = {
  id: string; class_id: string; day_of_week: string; start_time: string; end_time: string | null;
  teacher_id: string | null; slot_teacher_label: string | null; lab_separate: boolean | null;
  valid_from: string; valid_to: string | null;
};
export type SnapshotEnrollment = {
  id: string; student_id: string; class_id: string; start_date: string; end_date: string | null;
  on_hold: boolean; attendance_days: string[] | null; is_transferred: boolean; is_transferred_in: boolean; withdrawal_reason?: string | null;
};
export type SnapshotAttendance = {
  id: string; class_id: string; student_id: string; session_date: string; slot_start: string | null;
  status: string; recorded_at: string; supersedes_id: string | null; seat_label: string | null;
  recorded_via: string | null; taught_by: string | null; note: string | null;
};
export type SnapshotReport = {
  id: string; student_id: string; class_id: string | null; report_date: string; created_by: string | null;
  created_at: string | null; covers_date: string | null; makeup: boolean | null;
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
