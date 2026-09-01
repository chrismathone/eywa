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

/** 0.1 단위 반올림 — 1.5를 여러 번 더할 때 생기는 부동소수 꼬리를 자른다(cell-display와 같은 규약). */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * **그날 합계 시수 → 교시별 시수**(합이 정확히 total).
 *
 * 원장 2026-09-01: *"출석부에서 5를 적으면 시수가 곱하기되서 … 입력된 숫자가 입력되도록 해야해"* +
 * 확정: *"그날 합계 · '1'은 지금처럼"*. 출석부 격자는 **학생×날짜** 한 칸이라 거기 친 숫자는
 * 그날 전체의 사실이다 — 그런데 그 칸 뒤에는 교시가 여럿일 수 있고, 화면 숫자는 교시 합
 * ([`rollupDay`](./cell-display.ts))이다. 그래서 같은 값을 교시마다 쓰면 **교시 수만큼 부풀었다**
 * (실측 2026-09-01: 3교시 반에 4를 친 칸이 12로 저장·표시, 급여로 흘러감).
 *
 * 🔴 나머지는 **첫 교시**가 갖는다 — 균등 분배가 소수 한 자리로 안 떨어져도(4÷3) 합은 정확히 total.
 * 🔴 교시당 최소 0.1 — 더 잘게 못 나누면 null(호출부가 거절하고 사유를 띄운다). 값을 지어내지 않는다.
 * ⚠️ **빈칸·"1"(=기본 배수)은 이 함수를 타지 않는다** — 그건 "교시마다 정상"이라는 뜻이고 그 규약은
 *    그대로 둔다(원장 확정). 클릭으로 찍는 출석과도 같은 값이 유지된다.
 */
export function splitUnitsAcrossSlots(total: number, slots: number): number[] | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isInteger(slots) || slots < 1) return null;
  if (slots === 1) return [round1(total)];
  const per = Math.floor((total / slots) * 10) / 10;
  if (per < 0.1) return null;
  const first = round1(total - per * (slots - 1));
  if (first <= 0 || first > MAX_SESSION_UNITS) return null;
  return [first, ...Array<number>(slots - 1).fill(per)];
}

/** 저장값으로 정규화 — 1은 null(기본 배수)로 둔다(`parseSessionUnits`와 같은 규약). */
export function toStoredUnits(n: number): number | null {
  return n === 1 ? null : n;
}
