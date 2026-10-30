/**
 * 녹음 중단 진단 — 순수 판정(브라우저·서버 공용).
 *
 * 원장 2026-10-29 *"회의록이 최근 강제로 종료된건에 대해 이유 체크 가능한지 분석. 만약 자주 발생한다면 로그를 남겨놔야겠어
 * 분석가능하게."* — 중단은 브라우저 안에서만 판정되고 서버에는 흔적이 없었다(60일 녹음 회의 39건 모두 완료 · 오류 0).
 * 녹음 하나(백업 id)마다 **대표 사유 하나**를 감사로그 `recording_interrupted`에 남긴다(Codex 협의 2026-10-29).
 *
 * 🔴 보내는 것은 사유·코드·초·화면 상태·브라우저 계열뿐 — 제목·대상 이름은 싣지 않는다(상담 녹음 이름에 학생·보호자 이름).
 * ⚠️ 집계는 **관측된 건수**다 — 브라우저 백업(IndexedDB)이 막혔거나 그 계정으로 다시 들어오지 않으면 남지 않는다.
 */
import type { RecordingMeta, RecoveryKind } from "./recording-recovery";

/** 즉시 보고하는 중단(그 문서가 살아 있을 때 본 것). 한 녹음에 여럿이 이어지면 **처음 것**이 대표다. */
export const LIVE_INTERRUPTS = ["track_ended", "recorder_error", "unexpected_stop"] as const;
/**
 * 다음 접속 때 찾는 끝.
 * - page_closed = 녹음 중 탭 닫기·새로고침·주소 이동
 * - unclean_end = 끝 기록 없이 사라짐(탭·브라우저 강제 종료, 절전 중 정리, 충돌)
 * - signed_out = 로그인 화면을 벗어나거나 계정이 바뀌어 녹음을 버림
 */
export const LEFTOVER_ENDS = ["page_closed", "unclean_end", "signed_out"] as const;
export type InterruptReason = (typeof LIVE_INTERRUPTS)[number] | (typeof LEFTOVER_ENDS)[number];
export const INTERRUPT_REASONS: readonly InterruptReason[] = [...LIVE_INTERRUPTS, ...LEFTOVER_ENDS];

export const INTERRUPT_REASON_LABEL: Record<InterruptReason, string> = {
  track_ended: "마이크 연결 끊김",
  recorder_error: "녹음기 오류",
  unexpected_stop: "누르지 않았는데 멈춤",
  page_closed: "녹음 중 탭 닫기·새로고침",
  unclean_end: "끝 기록 없이 사라짐(강제 종료·절전·충돌)",
  signed_out: "로그인 화면을 벗어나 녹음 버림",
};

const KINDS: readonly RecoveryKind[] = ["meeting", "consultation", "student-consultation"];
const BROWSERS = ["whale", "edge", "samsung", "chrome", "safari", "firefox", "other"] as const;
export type BrowserFamily = (typeof BROWSERS)[number];

/** UA 문자열 전체는 보내지 않는다 — 계열만. 순서가 중요하다(Whale·Edge·삼성도 Chrome을 품는다). */
export function browserFamily(ua: string): BrowserFamily {
  if (/Whale\//.test(ua)) return "whale";
  if (/Edg\//.test(ua)) return "edge";
  if (/SamsungBrowser\//.test(ua)) return "samsung";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Chrome\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua)) return "safari";
  return "other";
}

export type InterruptReport = {
  sessionId: string;
  /** 그 녹음의 계정 — 서버가 지금 로그인한 사람과 대조한다(보낸 사이 계정이 바뀌면 남의 이름으로 적지 않는다). */
  ownerTenantId: string;
  ownerUserId: string;
  kind: RecoveryKind;
  reason: InterruptReason;
  errorCode: string | null;
  seconds: number | null;
  startedAt: number;
  endedAt: number | null;
  /** 보고 시점의 화면 — 즉시 보고에서만 뜻이 있다(다음 접속 보고는 null). */
  visibility: "visible" | "hidden" | null;
  online: boolean | null;
  browser: BrowserFamily;
  /** 다음 접속 때 보낸 것인가(사건 시각과 보고 시각이 다르다). */
  late: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const intIn = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

/** 서버가 받는 모양 — 모르는 값은 거절(null)한다. 서버 액션은 UI 밖에서 직접 불릴 수 있다. */
export function parseInterruptReport(input: unknown): InterruptReport | null {
  if (!input || typeof input !== "object") return null;
  const v = input as Record<string, unknown>;
  if (typeof v.sessionId !== "string" || !UUID.test(v.sessionId)) return null;
  if (typeof v.ownerTenantId !== "string" || typeof v.ownerUserId !== "string" || !v.ownerTenantId || !v.ownerUserId) return null;
  if (!KINDS.includes(v.kind as RecoveryKind)) return null;
  if (!INTERRUPT_REASONS.includes(v.reason as InterruptReason)) return null;
  const now = Date.now();
  // 오래 묵은 백업을 늦게 발견해도 받는다(거절하면 브라우저는 보낸 것으로 여겨 기록 없이 끝난다 · Codex 2차).
  const startedAt = intIn(v.startedAt, Date.UTC(2020, 0, 1), now + 60_000);
  if (startedAt === null) return null;
  const endedAt = v.endedAt == null ? null : intIn(v.endedAt, startedAt, now + 60_000);
  if (v.endedAt != null && endedAt === null) return null;
  const errorCode = typeof v.errorCode === "string" && /^[A-Za-z]{1,40}$/.test(v.errorCode) ? v.errorCode : null;
  return {
    sessionId: v.sessionId.toLowerCase(),
    ownerTenantId: v.ownerTenantId,
    ownerUserId: v.ownerUserId,
    kind: v.kind as RecoveryKind,
    reason: v.reason as InterruptReason,
    errorCode,
    seconds: intIn(v.seconds, 0, 86400),
    startedAt,
    endedAt,
    visibility: v.visibility === "visible" || v.visibility === "hidden" ? v.visibility : null,
    online: typeof v.online === "boolean" ? v.online : null,
    browser: BROWSERS.includes(v.browser as BrowserFamily) ? (v.browser as BrowserFamily) : "other",
    late: v.late === true,
  };
}

/**
 * 남은 백업 하나를 무엇으로 보고할지 — null이면 보고하지 않는다.
 * - lockHeld = 그 대상의 녹음 잠금을 어느 탭이 쥐고 있다(살아 있는 녹음 — 절전 중인 탭도 쥔다) → 판정하지 않는다.
 * - pageClosed = 녹음 중 그 문서가 내려가며 남긴 표시(localStorage — 끝 처리 전에 문서가 사라져도 남는다).
 */
export function classifyLeftover(meta: RecordingMeta, lockHeld: boolean, pageClosed: boolean, localInterrupt: InterruptReason | null = null, stopRequested = false): InterruptReason | null {
  if (meta.diag !== 1 || meta.reportedAt || meta.chunkCount < 1) return null;
  // 끝 시각이 없고 어느 탭이 잠금을 쥐고 있으면 아직 녹음 중이다(중단 사유를 적은 직후 · 다른 탭에서 지운 백업 포함) — 건드리지 않는다.
  if (!meta.endedAt && lockHeld) return null;
  // 동기 저장소에 적은 처음 사유 — 탭이 바로 닫혀 백업 쓰기가 못 끝나도 남는다(Codex 4차). 백업에 적힌 끝보다 먼저 본 것이다.
  const end = (!meta.endReason || meta.endReason === "page_closed") && localInterrupt ? localInterrupt : meta.endReason;
  if (end === "stopped") return null;
  if (end && (INTERRUPT_REASONS as readonly string[]).includes(end)) return end as InterruptReason; // 즉시 보고가 실패한 것 · 버린 녹음
  if (meta.endedAt) return null;
  // 끝내기를 누른 뒤 끝 기록 전에 탭이 닫혔다 — 직접 끝낸 녹음이다(Codex 5차).
  if (stopRequested) return null;
  return pageClosed ? "page_closed" : "unclean_end";
}
