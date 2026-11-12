import { round1 } from "@/lib/guards";
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

/**
 * 시수 원문이 **'기본'**인가 — 안 보냈거나(undefined·null) 공백. 서버가 수학 자동 시수를 넣을 수 있는
 * 유일한 입력이다([`auto-units.ts`](./auto-units.ts), 원장 2026-09-11 *"그날 수업 길이로 자동"*).
 * 🔴 **"1"은 명시다** — 저장값은 똑같이 null(=1)이지만, 사람이 1을 쳤으면 자동값으로 바꾸지 않는다
 *    (원장 2026-09-01 *"입력된 숫자가 입력되도록"* 불변). 격자 타이핑이 1을 ""로 넘기던 것을 그래서 고쳤다.
 */
export function isDefaultUnitsRaw(raw: string | null | undefined): boolean {
  return raw == null || raw.trim() === "";
}

/** 표시용 — 정수는 소수점 없이("2"), 소수는 한 자리("1.5"). */
export function formatSessionUnits(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** DB 값(null=기본 1) → 실제 배수. */
export function effectiveUnits(sessionUnits: number | null | undefined): number {
  return sessionUnits ?? 1;
}

/**
 * 0.1 단위 반올림 — 1.5를 여러 번 더할 때 생기는 부동소수 꼬리를 자른다(cell-display와 같은 규약).
 * ⚠️ 합을 **화면·감사로그에 적는 쪽**은 반드시 이걸 통과시킬 것 — `1.1+1.1+1.1`은 3.3000000000000003이라
 *    비교가 어긋나고(안 바뀐 저장에도 로그가 남는다) 그 숫자가 그대로 화면에 찍힌다(적대 리뷰 2026-09-14).
 */
export { round1 } from "@/lib/guards";

/**
 * **그날 합계 시수 → 교시별 시수**(합이 정확히 total).
 *
 * 원장 2026-09-01: *"출석부에서 5를 적으면 시수가 곱하기되서 … 입력된 숫자가 입력되도록 해야해"* +
 * 출석부 격자는 **학생×날짜** 한 칸이라 거기 친 숫자는
 * 그날 전체의 사실이다 — 그런데 그 칸 뒤에는 교시가 여럿일 수 있고, 화면 숫자는 교시 합
 * ([`rollupDay`](./cell-display.ts))이다. 그래서 같은 값을 교시마다 쓰면 **교시 수만큼 부풀었다**
 * (실측 2026-09-01: 3교시 반에 4를 친 칸이 12로 저장·표시, 급여로 흘러감).
 *
 * 🔴 나머지는 **첫 교시**가 갖는다 — 균등 분배가 소수 한 자리로 안 떨어져도(4÷3) 합은 정확히 total.
 * 🔴 교시당 최소 0.1 — 더 잘게 못 나누면 null(호출부가 거절하고 사유를 띄운다). 값을 지어내지 않는다.
 * 숫자를 입력하지 않은 기본값만 분배하지 않는다. 명시한 "1"은 합계 1로 나눈다(2026-09-17).
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
