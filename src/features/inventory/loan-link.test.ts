import { describe, expect, it } from "vitest";
import {
  assetStatusForLoan,
  holderEditBlockReason,
  loanMismatchMap,
  loanMismatchOf,
  loanStatusForReturnTarget,
  openLoanOf,
  restoredStatusAfterReturn,
} from "./loan-link";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { InventoryAsset, InventoryLoan } from "./types";

const asset = (id: string, status: string): InventoryAsset => ({
  id,
  assetCode: id,
  category: "notebook",
  maker: null,
  model: null,
  serialNo: null,
  acquiredOn: null,
  status,
  location: null,
  holderUserId: null,
  holderName: null,
  lastAuditedOn: null,
  disposedOn: null,
  note: null,
  sortOrder: 1,
});

const loan = (assetId: string, status: string, loanCode = "L-0001"): InventoryLoan => ({
  id: `${loanCode}-id`,
  assetId,
  assetCode: assetId,
  assetModel: null,
  loanCode,
  borrowerUserId: null,
  borrowerName: "김태건",
  dept: null,
  lentOn: null,
  dueOn: null,
  dueNote: null,
  returnedOn: null,
  status,
  prevStatus: null,
  note: null,
});

describe("assetStatusForLoan", () => {
  it("대여중은 대여중, 확인필요는 확인필요, 회수불가는 분실", () => {
    expect(assetStatusForLoan("out")).toBe("on_loan");
    expect(assetStatusForLoan("check")).toBe("check");
    // 실측 NB-006이 이미 이렇게 들어와 있다 — 가져오기가 세운 관행을 그대로 따른다.
    expect(assetStatusForLoan("unreturnable")).toBe("lost");
  });

  it("🔴 반납완료는 null — 되돌릴 상태는 prev_status가 정한다(여기서 추측하지 않는다)", () => {
    expect(assetStatusForLoan("returned")).toBeNull();
  });
});

describe("loanMismatchOf", () => {
  it("열린 대여가 받치고 있으면 정상", () => {
    expect(loanMismatchOf(asset("NB-008", "on_loan"), [loan("NB-008", "out")])).toBeNull();
  });

  it("🔴 실측 NB-012 — 자산은 대여중인데 장부는 '확인필요'", () => {
    const m = loanMismatchOf(asset("NB-012", "on_loan"), [loan("NB-012", "check", "L-0035")]);
    expect(m).toEqual({
      current: "on_loan",
      expected: "check",
      loanCode: "L-0035",
      reason: "대여 기록 L-0035이(가) 열린 대여가 아닙니다",
    });
  });

  it("대여 기록이 아예 없는데 대여중이면 사용중으로 되돌릴 것을 제안한다", () => {
    const m = loanMismatchOf(asset("NB-020", "on_loan"), []);
    expect(m?.expected).toBe("in_use");
    expect(m?.loanCode).toBeNull();
  });

  it("⚠️ 판정은 '대여중'에서만 — 다른 상태에 남은 옛 기록은 어긋남이 아니다(경고 노이즈 금지)", () => {
    expect(loanMismatchOf(asset("NB-006", "lost"), [loan("NB-006", "unreturnable")])).toBeNull();
    expect(loanMismatchOf(asset("NB-003", "in_use"), [loan("NB-003", "returned")])).toBeNull();
  });

  it("반납된 기록은 근거가 되지 않는다 — 대여중인데 반납만 남았으면 사용중 제안", () => {
    const m = loanMismatchOf(asset("NB-003", "on_loan"), [loan("NB-003", "returned")]);
    expect(m?.expected).toBe("in_use");
  });
});

describe("loanMismatchMap", () => {
  it("실측 모양 — 열린 대여 3건 + 어긋난 1건", () => {
    const assets = [
      asset("NB-005", "on_loan"),
      asset("NB-008", "on_loan"),
      asset("MN-005", "on_loan"),
      asset("NB-012", "on_loan"),
      asset("NB-006", "lost"),
    ];
    const loans = [
      loan("NB-005", "out", "L-0031"),
      loan("NB-008", "out", "L-0032"),
      loan("MN-005", "out", "L-0034"),
      loan("NB-012", "check", "L-0035"),
      loan("NB-006", "unreturnable", "L-0033"),
    ];
    const m = loanMismatchMap(assets, loans);
    expect([...m.keys()]).toEqual(["NB-012"]);
    expect(m.get("NB-012")?.expected).toBe("check");
  });
});

describe("holderEditBlockReason", () => {
  it("🔴 열린 대여가 있으면 사용자를 손으로 못 고친다 — 대여자에서 파생된 값이다", () => {
    expect(holderEditBlockReason(asset("NB-008", "on_loan"), [loan("NB-008", "out")])).toContain("대여 면");
  });

  it("어긋난 '대여중'도 막는다 — 먼저 맞춘 뒤에 고친다", () => {
    expect(holderEditBlockReason(asset("NB-012", "on_loan"), [loan("NB-012", "check")])).toContain("맞춰");
  });

  it("그 밖의 상태는 그냥 고친다", () => {
    expect(holderEditBlockReason(asset("DT-001", "in_use"), [])).toBeNull();
    expect(holderEditBlockReason(asset("NB-006", "lost"), [loan("NB-006", "unreturnable")])).toBeNull();
  });
});

describe("자산 표에서 바로 반납(원장 2026-09-18)", () => {
  it("반납하면 대여 전 상태로 — 대여중·폐기·없음은 사용중", () => {
    expect(restoredStatusAfterReturn("repair")).toBe("repair");
    expect(restoredStatusAfterReturn("on_loan")).toBe("in_use");
    expect(restoredStatusAfterReturn("disposed")).toBe("in_use");
    expect(restoredStatusAfterReturn(null)).toBe("in_use");
  });

  it("🔴 분실을 고르면 대여 기록은 회수불가, 확인필요면 확인필요 — '반납완료'로 남기지 않는다", () => {
    expect(loanStatusForReturnTarget("lost")).toBe("unreturnable");
    expect(loanStatusForReturnTarget("check")).toBe("check");
    expect(loanStatusForReturnTarget("repair")).toBe("returned");
    expect(loanStatusForReturnTarget(null)).toBe("returned");
    // 거꾸로 짝이 맞아야 한다 — 장부↔자산 연결 규약(assetStatusForLoan)과 같은 방향.
    expect(assetStatusForLoan(loanStatusForReturnTarget("lost"))).toBe("lost");
    expect(assetStatusForLoan(loanStatusForReturnTarget("check"))).toBe("check");
  });

  it("열린 대여는 out 한 건만 — 반납·확인필요 기록은 반납 대상이 아니다", () => {
    expect(openLoanOf([loan("a", "returned", "L-1"), loan("a", "out", "L-2")])?.loanCode).toBe("L-2");
    expect(openLoanOf([loan("a", "returned"), loan("a", "check")])).toBeNull();
    expect(openLoanOf([])).toBeNull();
  });

  it("🔴 화면(반납 창·상태 창)과 서버가 같은 규약을 쓴다 — 안내 문장과 실제 결과가 갈리지 않게", () => {
    const root = join(__dirname, "..", "..", "..");
    const read = (rel: string) => readFileSync(join(root, rel), "utf8");
    expect(read("src/features/inventory/server/loan-actions.ts")).toContain("restoredStatusAfterReturn(loan.prev_status");
    expect(read("src/app/(shell)/inventory/_components/return-dialog.tsx")).toContain("restoredStatusAfterReturn(loan.prevStatus)");
    expect(read("src/app/(shell)/inventory/_components/status-dialog.tsx")).toContain("restoredStatusAfterReturn(openLoan.prevStatus)");
    // 자산 면이 열린 대여를 두 창에 싣고, 반납 창으로 잇는다.
    const face = read("src/app/(shell)/inventory/_components/assets-face.tsx");
    expect(face).toContain("openLoan={openLoanFor(dialog.asset)}");
    expect(face).toContain('kind: "return"');
    expect(face).toContain("<ReturnDialog");
  });
});
