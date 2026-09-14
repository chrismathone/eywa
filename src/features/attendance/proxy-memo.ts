/**
 * 강사 보기 빗금 칸 입력의 **`대신 입력` 메모 줄** — 붙이기(쓰기)와 걸러내기(사유 읽기)가 이 한 곳을 지난다(순수, Vitest).
 *
 * 🔴 원장 2026-09-14 *"대신 다른 사람이 출결하면 메모에 남겨."* — 다른 선생님 교시 행에 상태를 옮길 때 그 행 메모 끝에
 *    `대신 입력: 이름` 한 줄을 붙인다(`ghost-transfer.ts`·서버 액션). 그런데 메모 칸(`attendance_records.note`)은 **결석
 *    사유 칸**이기도 하다 — 사유를 읽는 곳(운영실 사유 요약·결석 사유 분류·출결 복기 AI)이 이 줄을 사유로 읽으면
 *    "대신 입력: 박소선"이 결석 사유로 뜨고 '사유 없음' 건수가 줄어든다(적대 리뷰 2026-09-14). → 사유를 읽는 곳은
 *    `stripProxyMemo`를 먼저 지난다.
 * ⚠️ 화면의 메모 **표시**(툴팁·팝오버)는 걸러내지 않는다 — 누가 대신 입력했는지 보이는 것이 이 줄의 목적이다.
 */
import { appendMemo } from "@/features/onescreen/makeup-absence-link";

/** 메모 한 줄 머리 — **저장값**이라 한국어 고정(결석 사유 프리셋과 같은 규약 — 화면 언어를 따라가지 않는다). */
export const PROXY_MEMO_PREFIX = "대신 입력: ";

/** `대신 입력: 박소선` — 표시 이름이 비었으면 빈 꼬리 대신 사실대로 적는다. */
export function proxyMemoLine(actorName: string | null | undefined): string {
  return `${PROXY_MEMO_PREFIX}${(actorName ?? "").trim() || "이름 없음"}`;
}

/** 그 행의 기존 메모 끝에 한 줄 — 이미 그 줄이 있으면 그대로(두 번 옮겨도 한 줄, `appendMemo` 줄 단위 비교). */
export function proxyNote(existing: string | null | undefined, actorName: string | null | undefined): string {
  return appendMemo(existing, proxyMemoLine(actorName));
}

/**
 * 메모를 고칠 행 = **화면이 그 칸 메모로 보여 준 행** — 월간 매트릭스 조회(`queries.ts`)와 같은 규칙: 제 몫 행 먼저, 없으면
 * 남의 교시 행 · 각각 사유가 적힌 메모 우선 → 아무 메모 → 메모가 하나도 없으면 가장 최근 행.
 * 🔴 빗금 칸 입력 뒤엔 여러 행이 같은 시각에 `대신 입력` 줄을 가져, "가장 최근 1행"에 쓰면 보이는 사유는 그대로이고 그
 *    줄만 지워졌다(적대 재리뷰 2026-09-14). 메모만 저장이 이 함수로 고른다.
 * @param rows 교시별 최신 행, 최근 입력 먼저.
 */
export function noteTargetRow<T extends { note?: string | null }>(
  rows: readonly T[],
  mine: (row: T) => boolean = () => true,
): T | undefined {
  const pick = (list: readonly T[]) => list.find((r) => stripProxyMemo(r.note) !== "") ?? list.find((r) => !!r.note);
  return pick(rows.filter(mine)) ?? pick(rows.filter((r) => !mine(r))) ?? rows[0];
}

/** 메모에서 `대신 입력` 줄을 뺀 나머지(= 사유) — 남는 게 없으면 "". 줄 순서·나머지 줄은 그대로. */
export function stripProxyMemo(note: string | null | undefined): string {
  return (note ?? "")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith(PROXY_MEMO_PREFIX))
    .join("\n")
    .trim();
}
