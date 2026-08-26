/**
 * 공지 `results[]`에서 **진짜 실패만** 골라낸다 — 순수 규칙(클라·서버 공용, `server-only`/`use client` 금지).
 *
 * 🔴 왜 필요한가(2026-08-25 실사고): `classnote_notices.results[]`는 **용도가 셋이고 모양이 다르다**.
 *    · 게시 = `{ ok, board, reports[] }`  ← `ok`가 있다
 *    · 수정 = `{ board, reports[] }`      ← `ok`가 **없다**(워커 `editNotice`가 다시 쓴다)
 *    · 회수 = `{ board, revoked[] }`      ← `ok`가 **없다**(워커 `revokeNotice`)
 *    그래서 `!x.ok`로 세면 **수정·회수한 공지가 전건 실패로 뒤집힌다.** 실제로 7명에게 정상 게시된 공지를
 *    제자리 수정하자 화면이 "발송 완료 · 실패 7 · 사유 없음"이 됐고, 발송자는 **안 갔다고 알고 재발송**
 *    직전이었다(학부모 알림장에 같은 글 2개 = 되돌릴 수 없다).
 *
 * 🔑 규약은 **`ok` 키가 있고 그 값이 true가 아닌 것만 실패**다 — DB 알림 트리거(0144a)가 2026-07-23
 *    회수 오탐을 겪고 이미 정한 규칙(`r ? 'ok' and (r->>'ok')::boolean is not true`)과 **같은 판정**이다.
 *    화면과 트리거가 다른 규칙을 쓰면 "벨은 조용한데 화면은 실패"처럼 서로 다른 말을 한다.
 *
 * ⚠️ 새 표면에서 실패를 셀 때 `!x.ok`를 다시 쓰지 말 것 — 이 함수를 쓴다.
 */
// ⚠️ 제약을 `{ ok?: boolean }`으로 두면 TS의 weak-type 검사가 **`ok`가 없는 실제 모양**(수정·회수 결과)을
//    거부한다 — 이 함수가 존재하는 이유가 바로 그 모양들이라 제약은 `object`로 넓히고 안에서 좁힌다.
export function noticeFailures<T extends object>(results: readonly T[] | null | undefined): T[] {
  if (!Array.isArray(results)) return [];
  // ⚠️ `results`는 jsonb라 타입이 계약일 뿐이다 — 원소가 객체가 아니면 `"ok" in x`가 **throw**한다
  //    (그 한 줄이 공지 이력 화면 전체를 죽인다). typeof로 먼저 좁힌다.
  return results.filter(
    (x): x is T =>
      typeof x === "object" && x !== null && "ok" in x && (x as { ok?: unknown }).ok !== true,
  );
}
