/**
 * **접힌 조회 표식** — 조회가 실패해 빈 값·기본값으로 접어 돌려준 결과물에 "못 읽었다"는 사실을 남긴다.
 *
 * 🔑 왜: 화면은 조회가 일부 실패해도 살아야 해서 빈 목록·기본 설정으로 접는다(fail-soft). 그런데 같은 결과물을
 *    **금액**으로 쓰는 자리(프리랜서 명세서 = 그 강사 출석부의 실급여)는 접힌 재료가 곧 틀린 금액이다 —
 *    '없음'과 '못 읽음'을 갈라야 산정을 멈출 수 있다(적대 리뷰 2026-10-06).
 * 🔑 왜 값의 모양을 안 바꾸나: 접는 자리의 결과물은 Map·배열·학원 설정처럼 소비처가 수십 곳인 모양이라, 칸을 더하면
 *    전부가 따라 바뀐다. 표식은 **객체 참조**에 붙는다 — 같은 요청에서 캐시된 같은 객체를 받은 곳이면 어디서든 읽힌다.
 * ⚠️ `.filter()`·`.map()`처럼 **새 객체를 만드는 가공은 표식을 잃는다** — 가공한 쪽이 `carryFolded`로 옮겨 실을 것.
 * ⚠️ 화면은 이 표식을 읽지 않는다(종전 그대로 그린다). 읽는 곳은 금액 조립뿐이다.
 */
const FOLDED = new WeakMap<object, string>();

/** 접어 돌려주는 결과물에 사유(화면에 그대로 뜰 수 있는 한글 한 마디)를 붙인다. */
export function markFolded<T extends object>(value: T, reason: string): T {
  FOLDED.set(value, reason);
  return value;
}

/** 이 결과물이 접힌 것이면 그 사유, 아니면 null. */
export function foldedReason(value: object | null | undefined): string | null {
  return value ? (FOLDED.get(value) ?? null) : null;
}

/** 가공해 새로 만든 결과물로 표식을 옮긴다(원본이 접힌 게 아니면 아무것도 안 한다). */
export function carryFolded<T extends object>(from: object | null | undefined, to: T): T {
  const reason = foldedReason(from);
  return reason ? markFolded(to, reason) : to;
}
