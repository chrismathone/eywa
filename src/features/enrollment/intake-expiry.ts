import { addDays, isValidYmd, kstToday } from "@/lib/date-kst";

/** 날짜를 안 고르면 이만큼 뒤에 끝난다(방치된 공개 링크 방지). */
export const INTAKE_DEFAULT_DAYS = 90;

/**
 * 공개 QR 접수 링크의 만료 시각 — **그날 KST 23:59:59**(감사 F14, 2026-09-23).
 * 🔴 `new Date("2026-10-01")`은 UTC 자정 = **KST 오전 9시**라 만료일 아침부터 학부모 접수가 끊겼다.
 * 날짜가 없거나 형식이 틀리면 오늘부터 기본 90일째 되는 날의 끝.
 */
export function intakeExpiryIso(dateYmd: string | null | undefined, today: string = kstToday()): string {
  const ymd = dateYmd && isValidYmd(dateYmd) ? dateYmd : addDays(today, INTAKE_DEFAULT_DAYS);
  return new Date(`${ymd}T23:59:59+09:00`).toISOString();
}

/**
 * 실제 마감 시각(ms). 🔴 이 수정 전에 만든 링크는 `YYYY-MM-DDT00:00:00Z`(= KST 09:00)로 저장돼 있다 — 화면은
 * "~그날까지"라고 말하므로 **UTC 자정 정각인 값은 그 날짜의 KST 23:59:59로 읽는다**(데이터 백필 없이 약속을 지킨다).
 */
export function intakeCutoffMs(expiresAt: string): number {
  const d = new Date(expiresAt);
  const t = d.getTime();
  if (!Number.isFinite(t)) return NaN;
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0) {
    return new Date(`${d.toISOString().slice(0, 10)}T23:59:59+09:00`).getTime();
  }
  return t;
}

/** 만료 지남 여부 — 만료가 없으면 영구 유효. 공개 접수 화면·제출 액션·관리 패널이 모두 이 함수로 판정한다. */
export function isIntakeExpired(expiresAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  const t = intakeCutoffMs(expiresAt);
  return Number.isFinite(t) && t < now.getTime();
}
