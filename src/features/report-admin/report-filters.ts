/**
 * 보고서 목록 필터 — 타입 + 상수(순수, 클라·서버 공용). "use server"(actions.ts)에서 비-async 값을
 * export할 수 없어(런타임 상수 IMPORT_FILTER) 여기로 분리. 5단계-2 Part C.
 */

export type ReportListRow = {
  id: string;
  studentName: string;
  subject: string | null;
  reportDate: string;
  createdAt: string | null; // 작성/이관 등록 시각(timestamptz) — 정렬 최종 tiebreak(이관분은 cron 배치 시각으로 동일)
  sentAt: string | null; // 실제 학부모 발송 시각(classnote_sent_at) — 목록 hh:mm 표시 + 같은 날짜 내 최신 발송 정렬 키. 없으면 createdAt 폴백
  classnoteStatus: string | null;
  teacherName: string | null;
  shareToken: string | null;
  source: string | null; // edutrix_import=이관분(발송 아님) · onescreen=eywa 네이티브
};

export type ReportListFilters = {
  from?: string;
  to?: string;
  status?: string;
  teacher?: string;
  subject?: string;
  page?: number;
};

// 상태 필터 특수값: 발송 이력 없는 이관분(edutrix_import). classnote_status가 아니라 source로 거른다.
export const IMPORT_FILTER = "__import__";

/**
 * 관리자 최초 발송 가능 행 — **미발송(발송 이력 없음)** + 이관분 아님. 목록 체크박스 활성 판정용(순수).
 * 서버 액션(sendClassnoteForUnsent)의 하드필터와 동일 조건 — 이미 발송·큐잉된 행(queued/processing/
 * success/failed/…)은 여기서도 서버에서도 거부라 **중복발송이 구조적으로 불가**(재발송은 큐 카드의 별도 버튼).
 * 취소(revoked)·과목 게이트·too_old는 목록 행에 정보가 없어 서버에서만 걸러진다(제외 건수로 안내).
 */
export function isAdminSendable(row: Pick<ReportListRow, "classnoteStatus" | "source">): boolean {
  return !row.classnoteStatus && row.source !== "edutrix_import";
}
