import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fitWithdrawalRows,
  WITHDRAWAL_PAGE_MIN,
  withdrawalPage,
  withdrawalPageSize,
} from "./list-pagination";

describe("퇴원 목록 페이지", () => {
  it("남는 높이에서 제목·페이지 바를 뺀 만큼만 행을 배치한다", () => {
    expect(fitWithdrawalRows(540, 145, 45)).toBe(8);
    expect(fitWithdrawalRows(400, 145, 45)).toBe(5);
    expect(fitWithdrawalRows(100, 145, 45)).toBe(1);
    expect(fitWithdrawalRows(10000, 145, 45)).toBe(50);
    expect(fitWithdrawalRows(0, 0, 0)).toBe(8);
  });
  it("URL의 잘못된 크기와 페이지를 유효 범위로 제한한다", () => {
    for (const value of [undefined, "no", "0", "-2", "Infinity"]) expect(withdrawalPageSize(value)).toBe(8);
    expect(withdrawalPageSize("1000")).toBe(50);
    expect(withdrawalPageSize("3.7")).toBe(3);
    expect(withdrawalPage("999", 19, 8)).toEqual({ page: 3, totalPages: 3, start: 16, end: 19 });
    expect(withdrawalPage("-1", 19, 8)).toEqual({ page: 1, totalPages: 3, start: 0, end: 8 });
    expect(withdrawalPage("2", 0, 8)).toEqual({ page: 1, totalPages: 1, start: 0, end: 0 });
  });

  /**
   * 🔴 자는 **창**이지 옆 카드가 아니다(원장 2026-09-16: *"하단 여백이 너무 많이 남으니까 …
   * 자동으로 확장되는건가?"*). 종전엔 오른쪽 '사유 분석' 카드 높이를 넘겨서, 그 카드가 짧으면
   * 창을 아무리 키워도 4행에서 멎고 화면 아래 절반이 비었다.
   */
  it("실측 재현 — 창에 남는 높이로 재면 4행이 아니라 열 행 남짓이 선다", () => {
    // 2026-09-16 캡처(최대화 창): 행 영역 위로 KPI·툴바·차트가 ~520px, 아래로 쪽 넘김 64 + 바닥 여백 40.
    const avail = 1030 - 520 - (64 + 40) - 4;
    expect(fitWithdrawalRows(avail, 0, 39)).toBe(10);
    // 옛 자(오른쪽 카드 ~280px)로는 같은 창에서 4행이 한계였다.
    expect(fitWithdrawalRows(280, 145 - 64, 39)).toBe(5);
  });

  it("최소 창에서도 1행으로 떨어지지 않는다 — 하한이 쪽 넘김을 무의미하게 만들지 않는다", () => {
    // 1040×720 창: 목록 위 ~520px + 아래 ~104px → 남는 자리는 한 행도 안 된다.
    expect(fitWithdrawalRows(660 - 520 - 104, 0, 39)).toBe(1);
    expect(Math.max(WITHDRAWAL_PAGE_MIN, fitWithdrawalRows(36, 0, 39))).toBe(5);
  });
});

describe("🔴 명단 행 수의 자 = 창(스크롤러)", () => {
  const src = readFileSync(
    join(process.cwd(), "src/app/(shell)/withdrawals/_components/list-layout.tsx"),
    "utf8",
  );

  it("스크롤러(main)에서 남는 높이를 재고, scrollHeight로 재지 않는다", () => {
    expect(src).toContain('closest("main")');
    expect(src).toContain("clientHeight");
    // scrollHeight는 내용이 짧을 때 빈 공간까지 '아래'로 잡아 행이 최소로 떨어진다(AutoPageSize 주석).
    // ⚠️ 문자열이 아니라 **읽는 코드**를 막는다(같은 주의를 적은 주석까지 걸리면 안 된다).
    expect(src).not.toMatch(/\w\.scrollHeight/);
  });

  it("옆 카드(사유 분석) 높이를 재지 않는다 — 두 카드 높이 = 창에 맞춘 명단 높이, 사유 카드는 그 안에서 스크롤(원장 2026-10-15)", () => {
    // 옆 카드 높이로 명단을 늘리면 아래가 비고(원장 캡처), 행 수를 늘리면 사유 막대가 바뀔 때마다 다시 불러온다(적대 리뷰).
    expect(src).not.toMatch(/aside\.getBoundingClientRect/);
    expect(src).toContain("const stableHeight = sideBySide ? chrome + fit * rowHeight");
    const css = readFileSync(join(process.cwd(), "src/app/(shell)/withdrawals/_components/list-layout.module.css"), "utf8");
    const rule = css.slice(css.indexOf("[data-withdrawal-reasons]"));
    expect(rule).toMatch(/max-height:\s*var\(--withdrawal-list-height/);
    expect(rule).toMatch(/overflow-y:\s*auto/);
  });

  it("하한을 적용한다 — 최소 창에서 1행 목록이 되지 않게", () => {
    expect(src).toContain("const windowFit = fitWithdrawalRows(avail, 0, rowHeight);");
    // 남는 자리로 하한이 안 나오면 한 화면 높이(screenFit)로 재되, 그때도 하한 아래로는 안 내려간다(원장 2026-11-11).
    expect(src).toContain("windowFit >= WITHDRAWAL_PAGE_MIN ? windowFit : Math.max(WITHDRAWAL_PAGE_MIN, screenFit)");
  });

  it("창(iframe) 크기 변화도 듣는다 — 내용 높이가 그대로면 ResizeObserver가 안 깨어난다", () => {
    expect(src).toContain('window.addEventListener("resize"');
    expect(src).toContain('window.removeEventListener("resize"');
  });
});
