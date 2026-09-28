/**
 * 슬랙 발송 시각 계산 — 방해금지·주말 조용히·요약 시각(전부 KST). 순수 함수, 서버·테스트 공용.
 * KST는 서머타임이 없어 +9시간 고정으로 계산한다.
 *
 * 규칙(codex·grok 합의): 방해금지 중 생긴 '즉시' 알림은 해제 시각에 **낱개로 몰아 보내지 않고 한 통으로 묶는다**
 * (digest_item) — 아침 출근 직후 채널이 수십 통으로 도배되지 않게.
 */
export type QuietConfig = {
  dndEnabled: boolean;
  dndStart: string; // "HH:MM"
  dndEnd: string; // "HH:MM"
  weekendQuiet: boolean;
};

const KST_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** KST 요일(0=일)·자정부터 분·그날 KST 자정의 UTC 시각. */
function kst(at: Date): { dow: number; minutes: number; midnight: number } {
  const shifted = new Date(at.getTime() + KST_MS);
  const midnightShifted = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return {
    dow: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    midnight: midnightShifted - KST_MS,
  };
}

export function isQuietAt(at: Date, cfg: QuietConfig): boolean {
  const { dow, minutes } = kst(at);
  if (cfg.weekendQuiet && (dow === 0 || dow === 6)) return true;
  if (!cfg.dndEnabled) return false;
  const start = toMinutes(cfg.dndStart);
  const end = toMinutes(cfg.dndEnd);
  if (start === end) return false;
  // 22:00~08:00처럼 자정을 넘는 구간과 13:00~14:00처럼 안 넘는 구간 둘 다.
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/**
 * `at` 이후 처음으로 조용하지 않은 시각. 후보 = 앞으로 9일 동안 매일 방해금지 끝 시각과 자정 —
 * 방해금지가 풀리는 순간은 반드시 둘 중 하나다(주말이 끝나는 월요일 0시 포함).
 */
export function nextAwakeAt(at: Date, cfg: QuietConfig): Date {
  if (!isQuietAt(at, cfg)) return at;
  const base = kst(at).midnight;
  const end = toMinutes(cfg.dndEnd) * 60_000;
  const candidates: number[] = [];
  for (let d = 0; d <= 9; d++) candidates.push(base + d * DAY_MS, base + d * DAY_MS + end);
  const hit = candidates.filter((t) => t > at.getTime()).sort((a, b) => a - b).find((t) => !isQuietAt(new Date(t), cfg));
  return new Date(hit ?? at.getTime() + DAY_MS);
}

/** 다음 요약 시각 — 오늘 그 시각이 아직이면 오늘, 지났으면 내일(KST). */
export function nextDigestAt(at: Date, hhmm: string): Date {
  const { midnight } = kst(at);
  const today = midnight + toMinutes(hhmm) * 60_000;
  return new Date(today > at.getTime() ? today : today + DAY_MS);
}

export type Delivery = { kind: "message" | "digest_item"; dueAt: Date };

/** 규칙 하나가 지금 생긴 사건을 언제 어떤 모양으로 보낼지. */
export function planDelivery(
  now: Date,
  rule: { timing: "immediate" | "digest"; digestAt: string | null; honorDnd: boolean },
  cfg: QuietConfig & { digestAt: string },
): Delivery {
  if (rule.timing === "digest") return { kind: "digest_item", dueAt: nextDigestAt(now, rule.digestAt ?? cfg.digestAt) };
  if (rule.honorDnd && isQuietAt(now, cfg)) return { kind: "digest_item", dueAt: nextAwakeAt(now, cfg) };
  return { kind: "message", dueAt: now };
}

/** KST "HH:MM" 표시. */
export function kstClock(at: Date): string {
  const { minutes } = kst(at);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** KST "M/D HH:MM" 표시(요약에서 날짜가 섞일 때). */
export function kstStamp(at: Date): string {
  const shifted = new Date(at.getTime() + KST_MS);
  return `${shifted.getUTCMonth() + 1}/${shifted.getUTCDate()} ${kstClock(at)}`;
}
