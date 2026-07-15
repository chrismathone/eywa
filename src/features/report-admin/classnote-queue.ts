/**
 * 원장 보고서 관리 — ClassNote 발송 큐 순수 헬퍼(5단계-2 Part A).
 * lesson_reports.classnote_status 집계 + "멈춤"(processing인데 오래됨) 판정. edutrix /admin/activity 큐 집계 이식.
 * CLAUDE.md: 계산 함수 분리 + Vitest. 시각은 nowMs 인자로 주입(결정적 테스트).
 */

// processing인데 이 분(minutes)을 넘게 안 끝나면 멈춤(워커 크래시·PC 꺼짐 등) → 멈춤복구 대상.
export const STUCK_MINUTES = 10;

/** processing 상태인데 처리 시작 후 STUCK_MINUTES 경과 = 멈춤. */
export function isStuck(status: string | null, processingAtIso: string | null, nowMs: number): boolean {
  if (status !== "processing" || !processingAtIso) return false;
  const started = Date.parse(processingAtIso);
  if (Number.isNaN(started)) return false;
  return nowMs - started >= STUCK_MINUTES * 60_000;
}

export type QueueRow = { status: string | null; processingAt: string | null };

export type QueueSummary = {
  queued: number;
  processing: number; // 진행 중(멈춤 포함)
  stuck: number; // processing 중 멈춘 것(하위집합)
  success: number;
  failed: number;
  tooOld: number;
  nameConflict: number;
  blockedShared: number; // 워커 프리플라이트 게이트가 오발송 위험으로 보류(공유 보드·보드 없음/중복)
  total: number; // classnote 요청된 전체(status non-null)
};

/** 상태별 집계 — processing의 stuck는 별도 카운트(멈춤복구 노출용). */
export function summarizeQueue(rows: QueueRow[], nowMs: number): QueueSummary {
  const s: QueueSummary = {
    queued: 0,
    processing: 0,
    stuck: 0,
    success: 0,
    failed: 0,
    tooOld: 0,
    nameConflict: 0,
    blockedShared: 0,
    total: rows.length,
  };
  for (const r of rows) {
    switch (r.status) {
      case "queued":
        s.queued++;
        break;
      case "processing":
        s.processing++;
        if (isStuck(r.status, r.processingAt, nowMs)) s.stuck++;
        break;
      case "success":
        s.success++;
        break;
      case "failed":
        s.failed++;
        break;
      case "too_old":
        s.tooOld++;
        break;
      case "name_conflict":
        s.nameConflict++;
        break;
      case "blocked_shared":
        s.blockedShared++;
        break;
      default:
        break; // revoked·기타
    }
  }
  return s;
}

/** 주의 필요(관리 액션 대상) 상태인가 — 실패·오래됨·동명이인·공유보드차단·멈춤. */
export function needsAttention(status: string | null, processingAtIso: string | null, nowMs: number): boolean {
  return (
    status === "failed" ||
    status === "too_old" ||
    status === "name_conflict" ||
    status === "blocked_shared" ||
    isStuck(status, processingAtIso, nowMs)
  );
}
