/**
 * 반 단체 공지(ClassNote 공지사항, 반 보드에 1건) — 화면·서버 공용 상수와 목록 모양.
 * ⚠️ `"use server"` 파일은 async 함수만 내보낼 수 있어([[#119]]) 상수·타입은 여기 둔다.
 */

/** ClassNote 공지 작성 화면 한도(본문 0/5000 — 2026-09-29 화면 실측). 제목은 짧게. */
export const CLASS_NOTICE_BODY_MAX = 5000;
export const CLASS_NOTICE_TITLE_MAX = 100;

export type ClassNoticeRow = {
  id: string;
  title: string;
  classNames: string[];
  isTest: boolean;
  /** queued | processing | success | partial | failed */
  status: string;
  /** 실패한 반과 사유(한글, 워커가 적는다). */
  failures: string[];
  error: string | null;
  createdAt: string;
};

/** 상태 → 한글(raw 코드 노출 금지). */
export function classNoticeStatusLabel(status: string): string {
  switch (status) {
    case "queued":
      return "발송 대기";
    case "processing":
      return "발송 중";
    case "success":
      return "발송 완료";
    case "partial":
      return "일부 실패";
    case "failed":
      return "실패";
    default:
      return "확인 필요";
  }
}
