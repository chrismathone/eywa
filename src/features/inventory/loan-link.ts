/**
 * **대여 장부 ↔ 자산 상태의 연결 규약** — 순수 함수(Vitest).
 *
 * 원장 2026-09-08 제보: *"이력에는 3개가 대여중인데 상태는 대여가 4개네"* → *"연동 가능하게 배선해야할듯"*.
 *
 * 🔑 두 숫자는 **원래 다른 축**이다 — 면 탭 `대여 N`은 **이력 장부 전체 건수**(나간 것·반납·확인필요·회수불가),
 *    자산 표의 `대여중` 칩은 **지금 자산 상태**가 대여중인 자산 수다. 그래서 7 vs 4는 그 자체로 버그가 아니다.
 *    진짜 버그는 **열린 대여(out)가 없는데 자산만 '대여중'**인 경우다(실측 NB-012 한 대).
 *
 * 🔴 **자동으로 고치지 않는다**(재고관리 상위 결정: *"자동 쓰기 없음"*) — 어긋난 것을 화면에 드러내고
 *    사람이 [맞추기]를 누를 때만 바꾼다. 대신 **무엇으로 맞출지는 여기서 결정론으로** 정한다.
 *
 * 쓰기 경로는 이미 이 규약을 지키고 있다(`setAssetStatus`가 `on_loan` 요청을 거절하고, 열린 대여가 있으면
 * 상태 변경 자체를 거절한다) — 그래서 지금 어긋난 행은 **가져오기가 남긴 것**이고, 앞으로 새로 생기지 않는다.
 */
import type { InventoryAsset, InventoryLoan } from "./types";

/**
 * 대여 기록 상태 → 그 자산이 있어야 할 상태.
 * · `out`(대여중) → 자산도 대여중
 * · `check`(확인필요) → 자산도 확인필요 — 누가 갖고 있는지 모르는 것이지 빌려준 게 아니다
 * · `unreturnable`(회수불가) → 분실 (실측 NB-006이 이미 그렇게 들어와 있다 — 가져오기가 세운 관행)
 * · `returned`(반납완료) → **null**: 되돌릴 상태는 `prev_status`가 정한다(여기서 추측하지 않는다)
 */
export function assetStatusForLoan(loanStatus: string): string | null {
  if (loanStatus === "out") return "on_loan";
  if (loanStatus === "check") return "check";
  if (loanStatus === "unreturnable") return "lost";
  return null;
}

export type LoanMismatch = {
  /** 지금 자산 상태. */
  current: string;
  /** 이 자산이 있어야 할 상태. */
  expected: string;
  /** 근거가 된 대여 기록(있으면). 없으면 "열린 대여가 하나도 없다"가 근거다. */
  loanCode: string | null;
  reason: string;
};

/**
 * 이 자산의 상태가 대여 장부와 어긋났나 — 어긋났으면 무엇으로 맞출지까지 돌려준다.
 *
 * ⚠️ **판정은 '대여중'에서만** 한다. 자산이 다른 상태인데 장부에 확인필요·회수불가 기록이 남아 있는 건
 *    흔한 정상(그 뒤에 사람이 상태를 정리한 것)이라, 그것까지 어긋남이라 부르면 경고가 노이즈가 된다.
 * 🔑 반납된 기록은 근거가 되지 않는다 — 반납 시점에 `prev_status`로 이미 되돌렸다.
 */
export function loanMismatchOf(
  asset: Pick<InventoryAsset, "status">,
  loans: readonly Pick<InventoryLoan, "loanCode" | "status">[],
): LoanMismatch | null {
  if (asset.status !== "on_loan") return null;
  if (loans.some((l) => l.status === "out")) return null; // 정상 — 열린 대여가 받치고 있다
  // 열린 대여가 없다. 장부에 남은 기록에서 있어야 할 상태를 뽑는다(확인필요 > 회수불가 순으로 최근 것).
  const anchor = loans.find((l) => l.status === "check") ?? loans.find((l) => l.status === "unreturnable") ?? null;
  const expected = anchor ? (assetStatusForLoan(anchor.status) ?? "in_use") : "in_use";
  return {
    current: "on_loan",
    expected,
    loanCode: anchor?.loanCode ?? null,
    reason: anchor
      ? `대여 기록 ${anchor.loanCode}이(가) 열린 대여가 아닙니다`
      : "이 자산에 열린 대여 기록이 없습니다",
  };
}

/** 자산별 어긋남 표 — 화면이 행마다 한 번씩 되묻지 않도록 한 번에 만든다. */
export function loanMismatchMap(
  assets: readonly InventoryAsset[],
  loans: readonly InventoryLoan[],
): Map<string, LoanMismatch> {
  const byAsset = new Map<string, InventoryLoan[]>();
  for (const l of loans) {
    const list = byAsset.get(l.assetId) ?? [];
    list.push(l);
    byAsset.set(l.assetId, list);
  }
  const out = new Map<string, LoanMismatch>();
  for (const a of assets) {
    const m = loanMismatchOf(a, byAsset.get(a.id) ?? []);
    if (m) out.set(a.id, m);
  }
  return out;
}

/**
 * 자산의 '사용자'를 손으로 고칠 수 있나 — **열린 대여가 있으면 안 된다**.
 * 🔑 대여 중인 자산의 사용자는 **대여자에서 파생된 값**이다. 여기서 따로 고치면 두 화면이 다른 이름을
 *    말하게 된다(지금 고치고 있는 종류의 버그). 그 경우엔 대여 면에서 대여자를 고치라고 안내한다.
 */
export function holderEditBlockReason(
  asset: Pick<InventoryAsset, "status">,
  loans: readonly Pick<InventoryLoan, "status">[],
): string | null {
  if (loans.some((l) => l.status === "out")) {
    return "대여 중인 자산입니다 — 사용자는 대여 면에서 대여자를 고치면 함께 바뀝니다";
  }
  if (asset.status === "on_loan") {
    return "상태가 '대여중'인데 열린 대여 기록이 없습니다 — 대여 면에서 먼저 맞춰 주세요";
  }
  return null;
}

/**
 * 반납하면 자산이 돌아갈 상태 — 대여 전 상태(`prev_status`). 대여중·폐기로는 되돌리지 않고, 없으면(가져온 기록) 사용중.
 * 🔑 화면(반납 창의 안내 문장)과 서버(`returnLoan`)가 **같은 함수**를 쓴다 — 갈리면 "사용중으로 돌아갑니다"라고
 *    말해 놓고 수리중으로 되돌린다.
 */
export function restoredStatusAfterReturn(prevStatus: string | null | undefined): string {
  return prevStatus && prevStatus !== "on_loan" && prevStatus !== "disposed" ? prevStatus : "in_use";
}

/**
 * 이 자산의 **열린 대여**(out) — 자산 표에서 상태를 바꾸거나 사용자를 비우면 이 대여를 반납 처리로 잇는다
 * (원장 2026-09-18 *"굳이 대여중으로 가지않고 자산에서 바로 상태 변경이나 사용자를 비우면 반납할 수 있게"*).
 * DB 부분 유니크(`inventory_loans_open_uniq`)가 자산당 하나를 보장한다.
 */
export function openLoanOf<T extends Pick<InventoryLoan, "status">>(loans: readonly T[]): T | null {
  return loans.find((l) => l.status === "out") ?? null;
}

/**
 * 자산 표에서 **상태를 골라** 반납할 때 대여 기록이 남을 상태 — `assetStatusForLoan`의 거꾸로.
 * · 분실 → **회수불가**(돌려받지 못했다 — 가져오기가 세운 관행 NB-006과 같은 짝)
 * · 확인필요 → **확인필요**(누가 갖고 있는지 모른다 — 돌려받은 게 아니다)
 * · 그 밖(사용중·수리중·미등록·폐기 등) → **반납완료**
 * 🔴 분실을 고르고 대여 기록을 '반납완료'로 남기면 대여 면은 "돌려받았다"고, 자산 표는 "잃어버렸다"고 말한다.
 */
export function loanStatusForReturnTarget(nextStatus: string | null | undefined): "returned" | "unreturnable" | "check" {
  if (nextStatus === "lost") return "unreturnable";
  if (nextStatus === "check") return "check";
  return "returned";
}
