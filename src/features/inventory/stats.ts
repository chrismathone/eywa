/**
 * 상단 스탯 5개 + "지금 조치가 필요한 자산" 목록 — **같은 판정 함수**(status.ts)에서 파생(순수).
 *
 * 시안 숫자(전체 94 · 사용중 75 · 대여중 4 · 조치필요 15 · 폐기 2)는 `inventory-wiring.test.ts`가
 * 시안 데이터로 회귀 고정한다. ⚠️ 표는 96행이고 '전체 자산'은 94(폐기 2 제외)다 — 둘이 다른 게 정상.
 * ⚠️ 사용중 75 + 대여중 4 + 조치필요 15 = 94 — 세 판정이 서로 겹치지 않고 비폐기를 정확히 덮는다.
 */
import { countable, needsAction } from "./status";

export type InventoryStats = {
  /** 폐기 제외 */
  total: number;
  inUse: number;
  onLoan: number;
  /** 분실·확인필요·미등록·수리중 */
  needsAction: number;
  /** 이력 보존 */
  disposed: number;
};

export function computeAssetStats(rows: ReadonlyArray<{ status: string }>): InventoryStats {
  let total = 0;
  let inUse = 0;
  let onLoan = 0;
  let action = 0;
  let disposed = 0;
  for (const r of rows) {
    if (countable(r.status)) total += 1;
    if (r.status === "in_use") inUse += 1;
    else if (r.status === "on_loan") onLoan += 1;
    else if (r.status === "disposed") disposed += 1;
    if (needsAction(r.status)) action += 1;
  }
  return { total, inUse, onLoan, needsAction: action, disposed };
}

/**
 * 조치 목록 — 스탯 '조치필요'와 **같은 함수**로 거른다. 🔴 N은 이 배열의 길이다(상한 걸린 미리보기의
 * 배열 길이를 건수로 쓰지 말 것 — [[#89]]. 여기엔 상한이 없다).
 */
export function actionNeededAssets<T extends { status: string }>(rows: ReadonlyArray<T>): T[] {
  return rows.filter((r) => needsAction(r.status));
}
