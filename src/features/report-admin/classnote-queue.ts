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

/** 워커가 살아 있어 실제로 발송이 진행되는 동안 — 빠르게 따라간다(워커 데몬 폴이 15초라 그보다 촘촘할 이유 없음). */
export const QUEUE_POLL_MS = 10_000;
/** 발송 PC가 꺼져 있는 동안 — 큐는 안 움직이므로 "PC가 켜졌나"만 느리게 지켜본다(켜지면 자동으로 빠른 주기로 복귀). */
export const QUEUE_WATCH_MS = 60_000;

/**
 * 큐 카드를 자동 갱신(폴링)할까 — ① 진행 중(대기·처리중)이 남아 있고 ② 상한에 안 걸렸을 때.
 * ⚠️ 진행 중이 0이면 절대 안 돈다(다 끝난 화면을 계속 조회하지 않는다). 워커가 꺼져 있어도 **주기만 늦춰**
 * 계속 지켜본다 — 아예 멈추면 원장이 발송 PC를 켜도 화면이 영영 안 살아나는 막다른 길이 되기 때문
 * (사람에게 새로고침을 시키지 않는다).
 */
export function shouldAutoRefreshQueue(a: { pendingCount: number; stalled: boolean }): boolean {
  return a.pendingCount > 0 && !a.stalled;
}

/** 폴링 주기 — 워커 온라인이면 빠르게(발송 추적), 오프라인이면 느리게(PC 복귀 감시). */
export function queuePollIntervalMs(workerOnline: boolean): number {
  return workerOnline ? QUEUE_POLL_MS : QUEUE_WATCH_MS;
}

/** '주의'(사람이 손대야 하는) 합계 — 카드의 빅스탯과 완료 알림이 같은 정의를 쓰도록 한 곳에서 센다. */
export function attentionCount(s: QueueSummary): number {
  return s.failed + s.tooOld + s.nameConflict + s.blockedShared + s.stuck;
}

/**
 * **사람이 조치해야만 풀리는** 상태 — 큐 조회에서 **날짜 창을 적용하지 않는다**.
 *
 * ⚠️ 다른 상태는 워커가 스스로 끝을 본다(failed = 3회 자동재시도 후 확정, queued → 곧 처리). 그런데 이 둘은
 * 밖에서 사람이 뭔가를 해야 풀린다: `blocked_shared` = 원장이 클래스노트 운영관리에서 연락처를 대조하고 발송 예외에
 * 등재 / `name_conflict` = 동명이인 `classnote_name` 지정. 대조에 며칠 걸릴 수 있는데(주말 끼면 더),
 * 큐 카드가 3일 창이라 그 사이 **행이 목록에서 사라지고 재발송 버튼도 함께 사라졌다**(재발송 UI는 이 카드가 유일).
 * 조치가 가장 오래 걸리는 상태에 가장 짧은 창이 걸려 있던 셈 — 해소를 못 하는 막다른 길이었다.
 */
export const HUMAN_RESOLVED_STATUSES = ["blocked_shared", "name_conflict"] as const;
