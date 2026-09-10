/**
 * 등록상담 수정 감사 요약 — 순수 함수(Vitest). 상세 폼 저장(updateEnrollmentConsultation)과 목록 칸 수정
 * (patchConsultationCells)이 **같은 규칙**으로 "무엇이 바뀌었나"를 남긴다.
 *
 * 왜(2026-09-10 김근우 건): QR 접수가 이름·학교·학년 일치로 **다른 아이(동명이인)** 에 자동 연결됐는데,
 * 등록상담은 접수·상태 변경·이름 수정 어느 것도 감사로그가 없어 "누가 언제 무엇을 바꿨나"를 되짚을 수 없었다.
 * 🔑 이름·학교·학년·보호자는 **자동 연결의 키**라 전후 값까지 남긴다 — 이름을 바꿔도 이미 붙은 연결은
 *    풀리지 않는데(그날 실제로 그랬다), 그 사실을 로그로 읽을 수 있어야 한다.
 * 🔴 연락처·상담 내용은 **값을 남기지 않고** 바뀌었다는 사실만 — 감사로그가 개인정보 사본이 되지 않게
 *    (학원 설정 변경 요약이 시트 ID를 안 남기는 것과 같은 규약).
 */
export type ConsultationAuditField = { col: string; label: string; withValues: boolean };

export const CONSULTATION_AUDIT_FIELDS: readonly ConsultationAuditField[] = [
  { col: "prospect_name", label: "이름", withValues: true },
  { col: "prospect_school", label: "학교", withValues: true },
  { col: "prospect_grade", label: "학년", withValues: true },
  { col: "parent_name", label: "보호자", withValues: true },
  { col: "parent_phone", label: "보호자 연락처", withValues: false },
  { col: "student_phone", label: "학생 연락처", withValues: false },
  { col: "subject", label: "과목", withValues: false },
  { col: "consultant_id", label: "상담사", withValues: false },
  { col: "parent_request", label: "상담 내용", withValues: false },
];

export type ConsultationChangeSummary = {
  /** 바뀐 항목의 한글 이름(값을 안 남기는 칸 포함). */
  changed: string[];
  /** 전후 값을 함께 남기는 칸만. */
  changes: { field: string; from: string | null; to: string | null }[];
};

const norm = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};

/**
 * 저장 전(before) ↔ 이번 저장이 쓴 값(after) 비교.
 * - **after에 없는 칸은 이번 저장이 안 건드린 칸**이라 건너뛴다(목록 칸 수정은 준 칸만 쓴다).
 * - 빈 문자열과 null은 같은 값으로 본다(폼은 빈 칸을 null로 저장한다 — 안 바뀐 칸이 "바뀜"으로 뜨면 소음).
 * - before가 없으면(조회 실패) 바뀐 항목을 **추측하지 않고** 빈 요약을 돌려준다.
 */
export function summarizeConsultationChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
): ConsultationChangeSummary {
  const out: ConsultationChangeSummary = { changed: [], changes: [] };
  if (!before) return out;
  for (const f of CONSULTATION_AUDIT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(after, f.col)) continue;
    const from = norm(before[f.col]);
    const to = norm(after[f.col]);
    if (from === to) continue;
    out.changed.push(f.label);
    if (f.withValues) out.changes.push({ field: f.label, from, to });
  }
  return out;
}
