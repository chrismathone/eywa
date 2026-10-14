/**
 * **값 목록 필터**(엑셀·구글 시트의 '값별 필터링') — 열 머리 체크 목록([`HeaderValueFilter`](@/components/header-value-filter))과
 * 서버의 실제 거르기가 같은 풀이를 쓴다. 원장 2026-10-14 *"오름차순/내림차순 필요없는 제목 행에 대해서는 엑셀처럼 필터"*.
 *
 * 주소 값(쉼표로 잇는다):
 * - 없음 = 전부 보임(필터 안 걸림)
 * - `a,b` = **이것만** 보인다
 * - `!a,b` = **이것만 뺀다** — 체크를 몇 개만 끈 경우(구글 시트가 '숨긴 값'으로 적는 것과 같다). 반 100개 중 하나만 끄면
 *   남은 99개 id를 주소에 싣는 대신 뺀 하나만 싣는다. 나중에 새로 생긴 값(기간을 넓혀 새 반이 섞임)은 보인다.
 * 빈 칸(반이 없는 줄·담임이 없는 줄)은 `BLANK_VALUE` 하나로 센다 — 목록에선 '(공백)'.
 * 한 줄에 값이 여럿이면(두 반을 다니는 학생) **하나라도 고른 값이면** 보인다.
 * 값 안의 쉼표·역슬래시와 맨 앞 느낌표는 역슬래시로 감싼다(담임 이름·학교는 자유 입력이라 쉼표가 들어올 수 있다).
 * 값은 다듬지 않는다(trim 금지) — 앞뒤 공백이 있는 이름이 목록 값과 어긋나면 그 줄이 사라진다.
 *
 * 서버·클라 공용 순수 모듈 — `"use client"`도 `server-only`도 붙이지 말 것.
 */

export const BLANK_VALUE = "__blank";
export const BLANK_LABEL = "(공백)";

export type ValueFilter = { mode: "in" | "out"; values: string[] };

const escapeValue = (v: string) => v.replace(/[\\,]/g, (c) => `\\${c}`).replace(/^!/, "\\!");

function splitValues(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "\\" && i + 1 < s.length) cur += s[++i];
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * 주소 값 → 필터. 비었거나 고른 값이 하나도 없으면 null(안 걸림).
 * 문자열이 아니면(같은 키가 주소에 두 번 → Next가 배열로 준다) 안 걸린 것으로 본다 — 화면이 죽지 않게.
 */
export function parseValueFilter(raw: unknown): ValueFilter | null {
  if (typeof raw !== "string" || !raw) return null;
  const out = raw.startsWith("!");
  const values = [...new Set(splitValues(out ? raw.slice(1) : raw).filter(Boolean))];
  if (values.length === 0) return null;
  return { mode: out ? "out" : "in", values };
}

/**
 * 체크된 값 → 주소 값. 전부 체크면 null(필터 해제). 체크가 절반 이하면 '이것만', 넘으면 '이것만 뺀다'로 짧게 적는다.
 * `all` 밖의 체크(선택지에서 사라진 옛 값)는 '이것만' 쪽에만 실린다.
 */
export function encodeValueFilter(checked: readonly string[], all: readonly string[]): string | null {
  const on = new Set(checked);
  const off = all.filter((v) => !on.has(v));
  if (off.length === 0) return null;
  const kept = [...new Set(checked)];
  return kept.length <= off.length ? kept.map(escapeValue).join(",") : `!${off.map(escapeValue).join(",")}`;
}

/** 목록을 열 때의 체크 상태 — 안 걸림이면 전부, '이것만'이면 그 값, '이것만 뺀다'면 나머지. */
export function checkedOf(filter: ValueFilter | null | undefined, all: readonly string[]): string[] {
  if (!filter) return [...all];
  if (filter.mode === "in") return [...filter.values];
  return all.filter((v) => !filter.values.includes(v));
}

/** 이 줄이 보이나 — 값이 없으면 '(공백)'으로 본다. 값이 여럿이면 하나라도 통과하면 보인다. */
export function passesValueFilter(filter: ValueFilter | null | undefined, rowValues: readonly string[]): boolean {
  if (!filter) return true;
  const values = rowValues.length ? rowValues : [BLANK_VALUE];
  return filter.mode === "in" ? values.some((v) => filter.values.includes(v)) : values.some((v) => !filter.values.includes(v));
}
