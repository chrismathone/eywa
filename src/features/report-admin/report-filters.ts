/**
 * 보고서 목록 필터 — 타입 + 상수(순수, 클라·서버 공용). "use server"(actions.ts)에서 비-async 값을
 * export할 수 없어(런타임 상수 IMPORT_FILTER) 여기로 분리. 5단계-2 Part C.
 */

export type ReportListRow = {
  id: string;
  studentName: string;
  subject: string | null;
  reportDate: string;
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
