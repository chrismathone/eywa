// 출석부 시트 타이핑 — 순수 함수(Vitest). 칸에 숫자를 치면 그대로 출결이 된다(구 출석부 관행).
//
// 🔴 eywa의 칸은 숫자가 아니라 **(상태, 시수)** 두 값이다. 구 출석부는 숫자 하나였다.
//    그래서 타이핑을 그대로 저장하면 안 되고, 이 파일이 **유일한 변환 자리**다:
//      0 = 결석(시수 없음) · 그 외 양수 = 출석 + 그 숫자가 시수(1은 기본값이라 저장 안 함)
//    지각·조퇴·보강은 숫자로 표현할 수 없다(같은 1시수여도 상태가 다르다) → 팝오버가 담당한다.
//    ⚠️ 숫자에 지각·조퇴를 끼워 넣지 말 것(예 "2=지각") — 그 숫자는 시수로 급여에 흘러간다.

import { isDefaultUnitsRaw, MAX_SESSION_UNITS, parseSessionUnits } from "../session-units";

/** 버퍼 최대 길이 — "12.5"(4자)까지. 더 길면 시수 상한을 넘어 어차피 거절된다. */
const MAX_BUFFER = 4;

/** 숫자 한 글자·소수점을 버퍼에 누적. 받을 수 없는 입력이면 **버퍼를 그대로** 돌려준다(무시). */
export function appendChar(buf: string | null, key: string): string | null {
  const isDot = key === "." || key === ",";
  const isDigit = key.length === 1 && key >= "0" && key <= "9";
  if (!isDot && !isDigit) return buf;
  if (isDot) {
    // 소수점은 한 번만. 빈 버퍼에서 시작하면 "0."으로 열어 준다(".5" → 0.5를 자연스럽게).
    if (buf?.includes(".")) return buf;
    return buf === null || buf === "" ? "0." : `${buf}.`;
  }
  const next = (buf ?? "") + key;
  return next.length > MAX_BUFFER ? buf : next;
}

/** 한 글자 지우기. 빈 문자열이 되면 null(=입력 모드 해제). */
export function backspace(buf: string): string | null {
  const next = buf.slice(0, -1);
  return next.length === 0 ? null : next;
}

/** 타이핑 결과 → 저장할 값. `units`는 서버 액션이 받는 raw 문자열(""=기본 1). */
export type TypedValue = { status: "present" | "absent"; units: string };

/**
 * 버퍼를 확정 값으로. 확정할 수 없으면 null(아무 일도 일어나지 않는다 — 값을 지어내지 않는다).
 *
 * ⚠️ 시수 검증은 `parseSessionUnits`를 **그대로 재사용**한다. 여기서 따로 검사하면 팝오버 입력과
 *    타이핑 입력이 서로 다른 값을 허용하게 되고, 그 차이가 급여로 흘러간다.
 */
export function commitBuffer(buf: string | null): TypedValue | null {
  const s = (buf ?? "").trim().replace(",", ".");
  if (!s || s === "." || s === "0.") return null;
  if (!/^\d{1,2}(\.\d)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  // 0 = 결석. 시수는 비운다(결석은 시수를 소비하지 않는다 — markNumber도 언제나 "0"으로 그린다).
  if (n === 0) return { status: "absent", units: "" };
  if (n > MAX_SESSION_UNITS) return null;
  // 원문 정규화는 팝오버와 **같은 함수**(`canonicalUnitsRaw`) — 두 경로가 서버·낙관값에 같은 원문을 넘긴다.
  const units = canonicalUnitsRaw(s);
  if (units === null) return null;
  return { status: "present", units };
}

/**
 * 시수 **원문 정규화** — 격자 타이핑(`commitBuffer`)과 팝오버가 칠할 값(`optimisticGridValue`)에 같은 원문을 넘기는 한 곳.
 * · 비움(공백 포함) → "" = 기본(빈 칸이면 수학 자동 시수, 있는 행이면 1 — 서버 규약)
 * · 그 밖 → `parseSessionUnits` 값의 표준 표기(쉼표 소수점 → 점)
 * · 서버가 받지 않을 원문(형식 오류·0·상한 초과) → null(호출부가 막는다)
 * 🔴 팝오버가 원문을 그대로 넘겼더니 `Number("1,5")`가 NaN이라 칸이 NaN을 칠하고 렌더가 무한히 돌아 화면이 통째로
 *    오류로 떨어졌다(재리뷰 2026-09-11).
 */
export function canonicalUnitsRaw(raw: string): string | null {
  if (isDefaultUnitsRaw(raw)) return "";
  const parsed = parseSessionUnits(raw);
  if (!parsed.ok) return null;
  // 🔴 1은 **명시값 "1"**로 넘긴다(2026-09-11) — 저장값은 여전히 null(서버 parseSessionUnits가 1을 접는다)이지만,
  //    ""(=기본)로 넘기면 서버가 **수학 자동 시수**(수업 길이, auto-units.ts)를 넣는다. 사람이 친 1은 1이다
  //    (원장 2026-09-01 *"입력된 숫자가 입력되도록"*). ⚠️ 교시가 여럿인 날의 "교시마다 1" 의미도 불변 —
  //    서버 분배는 명시 숫자가 1이 아닐 때만(unitsVal !== null) 돈다.
  return parsed.value === null ? "1" : String(parsed.value);
}

/** 칸의 현재 값(`s`=상태, `u`=시수) → 복사 버퍼에 담을 값(붙여넣기·Ctrl+Enter용). 빈 칸은 null. */
export type CellValue = { s: string; u: number | null; g?: true } | null;

export function copyValueOf(v: CellValue): TypedValue | null {
  // 빗금 칸의 표시 값(`g`)은 이 표의 값이 아니다 — 복사·채우기 씨앗으로 쓰면 남의 교시 값이 내 칸에 붙는다(빈 칸과 같다).
  if (!v || v.g) return null;
  if (v.s === "absent" || v.s === "excused") return { status: "absent", units: "" };
  if (v.s !== "present") return null; // 지각·조퇴·보강은 숫자로 복사되지 않는다(상태가 사라진다)
  return { status: "present", units: v.u === null || v.u === 1 ? "" : String(v.u) };
}
