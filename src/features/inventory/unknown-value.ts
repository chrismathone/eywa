/**
 * "미기재" 규약 — 원본 시트가 비운 칸을 어떻게 저장하고 어떻게 그리는가(순수, 서버/클라 공용).
 *
 * 원본(26.7월 전자기기관리대장)을 개편한 시안은 빈 칸을 `미기재` / `모델확인필요` / `제조사 확인필요` /
 * `—` 로 적어 두었다. 원본이 **"모르는 값"과 "해당 없음"을 구분**하고 있으므로 화면도 구분한다:
 *
 * - DB엔 **null**로 넣는다. 문자열 "미기재"를 저장하면 정렬·필터·집계가 전부 오염된다.
 * - `unknownIfEmpty(v)` = **알아야 하는데 모르는 칸**(제조사 · 모델명 · 입고일) → `미기재`
 * - `dashIfEmpty(v)`    = **비어 있는 게 정상인 칸**(사용자 · 폐기일 · 최종실사 · 현위치(폐기 자산)) → `—`
 * - `상시`(반납예정 없음, MN-005 셔틀담당) → `due_on = null` + `due_note = '상시'`. 날짜 칸에 '상시'라는
 *   문자열을 넣지 말 것.
 */

export const UNKNOWN_LABEL = "미기재";
export const DASH = "—";

/**
 * 가져오기(원본 → DB)에서 **null로 접는 표식들**. 시안 표에서 그대로 뽑은 문자열이라 여기서만 관리한다.
 * ⚠️ `확인필요`(단독)는 여기 없다 — 대여자 이름·소속 칸의 `확인필요`는 원본이 그렇게 적은 **값**이고
 *    (L-0035의 대여자·상태가 함께 '확인필요'), 지우면 "누구인지 확인해야 한다"는 사실이 사라진다.
 */
export const UNKNOWN_MARKERS: readonly string[] = ["미기재", "모델확인필요", "제조사 확인필요", "—", "-", ""];

export function isUnknownMarker(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  const s = String(v).trim();
  return UNKNOWN_MARKERS.includes(s);
}

/** 원본 문자열 → DB 값. 표식이면 null, 아니면 양끝 trim. */
export function nullIfUnknown(v: unknown): string | null {
  if (isUnknownMarker(v)) return null;
  return String(v).trim();
}

/** 알아야 하는데 모르는 칸 — `미기재`로 그린다. */
export function unknownIfEmpty(v: string | null | undefined): string {
  const s = v == null ? "" : String(v).trim();
  return s ? s : UNKNOWN_LABEL;
}

/** 비어 있는 게 정상인 칸 — `—`로 그린다. */
export function dashIfEmpty(v: string | null | undefined): string {
  const s = v == null ? "" : String(v).trim();
  return s ? s : DASH;
}
