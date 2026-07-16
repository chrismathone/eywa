// 시수(정규 수업 1회 기준 배수) 파싱·정규화 — 순수 함수(Vitest).
// 구 출석부(D:\attendance) 관행: 2시간 수업 기준 정규 출석 1, 3시간 1.5, 보강 4시간 2 (0.5 단위 관행, 0.1 허용).
// 저장 규칙: null = 기본 배수 1(대부분의 셀). 1을 입력해도 null로 정규화해 노이즈를 줄인다.

export const MAX_SESSION_UNITS = 20;

// 시수(배수)가 소비로 집계되는 상태 — 시수 검증 RPC(0115a)와 동일 기준. 결석(absent·excused)은 제외.
export const COUNTABLE_STATUSES: ReadonlySet<string> = new Set(["present", "late", "early_leave", "makeup"]);

export type ParsedUnits = { ok: true; value: number | null } | { ok: false; error: string };

/**
 * 사용자 입력 문자열 → 시수 값.
 * - 빈 문자열 = 기본(1) → null 저장.
 * - 소수 한 자리까지(쉼표 소수점 허용), 0 초과 ~ 20 이하. 1은 null로 정규화.
 */
export function parseSessionUnits(raw: string | null | undefined): ParsedUnits {
  const s = (raw ?? "").trim();
  if (!s) return { ok: true, value: null };
  if (!/^\d{1,2}([.,]\d)?$/.test(s)) {
    return { ok: false, error: "시수는 소수 한 자리 숫자로 입력하세요 (예: 1, 1.5, 2)" };
  }
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: "시수는 0보다 커야 합니다 (결석은 상태로 표시)" };
  if (n > MAX_SESSION_UNITS) return { ok: false, error: `시수는 ${MAX_SESSION_UNITS} 이하로 입력하세요` };
  const rounded = Math.round(n * 10) / 10;
  return { ok: true, value: rounded === 1 ? null : rounded };
}

/** 표시용 — 정수는 소수점 없이("2"), 소수는 한 자리("1.5"). */
export function formatSessionUnits(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** DB 값(null=기본 1) → 실제 배수. */
export function effectiveUnits(sessionUnits: number | null | undefined): number {
  return sessionUnits ?? 1;
}
