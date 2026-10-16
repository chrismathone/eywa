/**
 * 학생 병합이 **옮기는 기록** — 단일 소스. 병합 액션(`mergeStudents`)이 이 차례로 옮기고, 화면 안내(중복 의심 면)가 같은 목록을 적는다.
 * 🔴 여기 없는 기록(수업 보고서 · 진도 · 레벨테스트 · 교재 요청 등)은 옮겨지지 않고 퇴원 처리된 학생에게 남는다 —
 *    화면이 "모든 기록이 옮겨진다"고 적지 않게, 안내 문구는 이 목록에서 만든다.
 * ⚠️ 표를 더하려면 그 표의 유일 제약(같은 날·같은 반 등)이 두 학생의 기록 사이에서 부딪힐 때의 처리를 먼저 정할 것.
 */
export const MERGE_TABLES = [
  { table: "enrollments", label: "수강" },
  { table: "attendance_records", label: "출결" },
  { table: "invoices", label: "청구" },
  { table: "student_consultations", label: "원생상담" },
  { table: "student_grades", label: "성적" },
  { table: "student_memos", label: "메모" },
  { table: "enrollment_consultations", label: "신규 콜&상담" },
] as const;

/** 화면 안내용 — "수강 · 출결 · …". */
export const MERGE_SCOPE_LABEL = MERGE_TABLES.map((t) => t.label).join(" · ");
