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
  /** 붙인 이미지 장수(없으면 0) — 이력에서 "이미지 N장"으로 보인다. */
  imageCount: number;
  isTest: boolean;
  /** queued | processing | success | partial | failed */
  status: string;
  /** 실패한 반과 사유(한글, 워커가 적는다). */
  failures: string[];
  error: string | null;
  createdAt: string;
};

/** 테스트 발송의 대상 이름(워커 `TEST_NOTICE_BOARD`와 같은 반). */
export const CLASS_NOTICE_TEST_NAME = "[수학] 테스트반";

/**
 * 반 공지 큐 행의 **이미지 첨부**(원장 2026-10-03 *"반공지 이미지 가능하게"*) — 새 칸 없이 `targets[].attachments`에 싣는다
 * (원생 개별 공지의 학생별 첨부와 같은 자리 · SQL 없이 간다, [[#95]]). 반 공지의 이미지는 **전 반 공통**이라 대상마다 같은 목록이
 * 들어 있다 — 경로 기준으로 합쳐 한 벌로 돌려준다. 워커 `classNoticeAttachments`(class-notice-guard.mjs)와 같은 규칙.
 */
export function classNoticeAttachmentsOf(targets: unknown): { path: string; name: string }[] {
  const out: { path: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const t of Array.isArray(targets) ? targets : []) {
    const list = (t as { attachments?: unknown } | null)?.attachments;
    for (const a of Array.isArray(list) ? list : []) {
      const path = typeof (a as { path?: unknown })?.path === "string" ? ((a as { path: string }).path).trim() : "";
      if (!path || seen.has(path)) continue;
      seen.add(path);
      const name = (a as { name?: unknown })?.name;
      out.push({ path, name: (typeof name === "string" && name.trim()) || "이미지" });
    }
  }
  return out;
}

/** 큐 행 `targets` → 이력에 보일 반 이름(테스트 발송은 테스트반). 이름 없는 대상(테스트용 자리)은 뺀다. */
export function classNoticeClassNames(targets: unknown, isTest: boolean): string[] {
  if (isTest) return [CLASS_NOTICE_TEST_NAME];
  return (Array.isArray(targets) ? targets : [])
    .map((t) => (t as { className?: unknown } | null)?.className)
    .filter((n): n is string => typeof n === "string" && n.length > 0);
}

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
