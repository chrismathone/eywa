/**
 * **연동 PC 신호 끊김 알림** — 원장 2026-11-09 *"제안 바로 적용"*. 판정·문구는 순수 함수(Vitest) · 조회·발송은 `server/heartbeat-alert.ts`.
 *
 * 배경: 2026-11-06 17:37~19:17 연동 PC의 ClassNote 발송이 1시간 40분 멈췄는데(SQL이 거둔 실행권 → 42501 → 워커 신호 끊김)
 * 원장이 물어보기 전까지 아무도 몰랐다. 보고서가 안 나가는 것은 "아무도 모르는" 계열이라 벨 배지가 아니라 중요 알림(화면 중앙·OS 알림)이다.
 *
 * 규칙: 실제 발송 PC(시험용 dry-run PC 제외)의 마지막 워커 신호가 **15분** 넘게 없고 · 지금이 **KST 09~24시**(발송은 20~22시에 가장 몰린다 —
 * 최근 30일 요청의 54%)이고 · 원장이 일부러 끈 게 아니면(서버 쪽이 판정) → 그 지점 원장에게 **끊김 한 번에 한 번**(중복 방지 = 마지막 신호 시각).
 * 자정 넘어 끊기면 아침 9시 점검에서 알린다. 워커 신호가 한 번도 없는 지점은 대상이 아니다.
 * ⚠️ 신호는 '워커가 살아 있음'이지 '발송이 진행 중'은 아니다 — 발송 질의만 막히는 경우는 이 알림으로 못 잡는다(발송 실패 알림이 따로 있다).
 */
export const SYNC_AGENT_OFFLINE_TYPE = "sync_agent_offline" as const;
/** 이만큼 신호가 없으면 끊긴 것으로 본다 — 워커는 30초마다 신호를 남긴다(업데이트 적용 중 모듈 멈춤은 1분 안). */
export const HEARTBEAT_STALE_MS = 15 * 60_000;
/** 연동 앱(기기) 신호가 이 안이면 '앱은 켜져 있음' — 앱은 살아 있는데 작업만 멈춘 경우(11-06 사고 모양)는 문구가 다르다. */
export const APP_ALIVE_MS = 5 * 60_000;
/** 알리는 시간(KST, [from, to)) — 자정 넘어 끊기면 아침 첫 점검에서 알린다. */
export const ALERT_HOURS_KST = { from: 9, to: 24 } as const;
/** 원장이 연동 PC 상태를 보는 곳 — 학원 설정 → 연동 → 연동 PC. */
export const HEARTBEAT_ALERT_LINK = "/owner?tab=sheets&sub=agent";

export type HeartbeatDecision = "ok" | "no_worker" | "off_hours" | "alert";

export const kstHour = (now: Date): number => (now.getUTCHours() + 9) % 24;

/** 시험용(dry-run) PC인가 — 영상 첨부 게이트(`report-video-gate.ts`)와 같은 판정(`last_results.postMode === false`). */
export function isDryRunWorker(lastResults: unknown): boolean {
  return !!lastResults && typeof lastResults === "object" && !Array.isArray(lastResults) && (lastResults as Record<string, unknown>).postMode === false;
}

/** 실제 발송 PC들 중 가장 최근 신호 — 하나도 없으면 null. */
export function latestRealHeartbeat(workers: readonly { last_seen: string | null; last_results: unknown }[]): Date | null {
  const times = workers
    .filter((w) => !isDryRunWorker(w.last_results))
    .map((w) => Date.parse(String(w.last_seen ?? "")))
    .filter((t) => Number.isFinite(t));
  return times.length ? new Date(Math.max(...times)) : null;
}

export function decideHeartbeatAlert({ now, lastSeen }: { now: Date; lastSeen: Date | null }): HeartbeatDecision {
  if (!lastSeen) return "no_worker";
  if (now.getTime() - lastSeen.getTime() <= HEARTBEAT_STALE_MS) return "ok";
  const hour = kstHour(now);
  if (hour < ALERT_HOURS_KST.from || hour >= ALERT_HOURS_KST.to) return "off_hours";
  return "alert";
}

/** 연동 앱(기기)이 지금 살아 있나 — 기기 신호가 `APP_ALIVE_MS` 안. */
export function isAppAlive(deviceLastSeenAt: string | null | undefined, now: Date): boolean {
  const t = Date.parse(String(deviceLastSeenAt ?? ""));
  return Number.isFinite(t) && now.getTime() - t < APP_ALIVE_MS;
}

/**
 * 원장이 일부러 끈 것인가 — 연결 해제 요청 중이면 늘 · PC 앱 일시 중지 · ClassNote 꺼짐은 **앱이 지금 살아 있을 때만** 믿는다.
 * 🔴 앱은 업데이트로 모듈을 내릴 때 `classnote:'off'`를 마지막으로 보고하고 재시작한다 — 새 판이 안 켜지면(함정 #151 · 1.0.8·1.0.11 실제 사고)
 *    그 'off'가 그대로 남는다. 죽은 기기의 마지막 말을 '일부러 끔'으로 읽으면 가장 필요한 때 알림이 영영 안 간다(재리뷰 2026-11-09).
 */
export function isIntentionallyOff(
  device: { status: unknown; revoke_requested_at: string | null; last_seen_at: string | null },
  now: Date,
): boolean {
  if (device.revoke_requested_at) return true;
  if (!isAppAlive(device.last_seen_at, now)) return false;
  const status = (device.status && typeof device.status === "object" ? device.status : {}) as { state?: string; classnote?: string };
  return status.state === "paused" || status.classnote === "off";
}

/** 중복 방지 칸(`notification_events.bucket`) — 같은 끊김(마지막 신호가 그대로)이면 같은 값 · 신호가 돌아왔다 다시 끊기면 새 값. */
export const heartbeatAlertBucket = (lastSeen: Date): string => lastSeen.toISOString();

/** 벨 문구 — 마지막 신호 시각(KST)과 끊긴 시간을 그대로 적는다(기준이 아니라 실제 값 · 함정 #121). */
export function heartbeatAlertText(lastSeen: Date, now: Date, { appAlive = false }: { appAlive?: boolean } = {}): { title: string; body: string } {
  const minutes = Math.max(0, Math.floor((now.getTime() - lastSeen.getTime()) / 60_000));
  const span = minutes >= 120 ? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분` : `${minutes}분`;
  const at = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(lastSeen);
  const head = `마지막 신호 ${at} · ${span}째 없음`;
  return {
    title: "연동 PC 신호가 끊겼습니다",
    body: appAlive
      ? `${head} — 연동 앱은 켜져 있지만 클래스노트 작업 신호가 없어 수업보고서·공지 발송과 학부모 글 확인이 멈춰 있을 수 있습니다. 연동 PC 화면의 상태와 기록을 확인해 주세요.`
      : `${head} — 수업보고서·공지 발송과 학부모 글 확인이 멈춰 있을 수 있습니다. 연동 PC가 켜져 있고 AYWA 연동 앱이 실행 중인지 확인해 주세요.`,
  };
}
