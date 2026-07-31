import { describe, it, expect } from "vitest";
import {
  isOverdue,
  isOutsideSyncWindow,
  isMissingFromMakeedu,
  lastTouchedAt,
  overdueLinesOnly,
  SYNC_STALE_MS,
} from "./sync-window";

// 화면(billing-content)과 엑셀 라우트가 같은 집합을 말하는지는 이 판정에 달려 있다 —
// 예전엔 isOverdue가 두 곳에 복제돼 있어 한쪽만 고치면 조용히 어긋났다(gotchas #77).

const T = (iso: string) => new Date(iso).toISOString();
const SYNCED = T("2026-07-30T09:00:00Z");
const hoursBefore = (h: number) => T(new Date(Date.parse(SYNCED) - h * 3_600_000).toISOString());

/** 잔액이 남은 청구서(청구 10만 · 할인 0 · 수납 0) — 금액을 안 따지는 테스트의 기본 재료. */
const 미납 = { amountTotal: 100_000, amountDiscount: 0, amountPaid: 0 };

describe("isOverdue", () => {
  it("미완납 + 기한 경과 + 잔액 있음만 true", () => {
    expect(isOverdue({ ...미납, status: "unpaid", dueDate: "2026-07-01" }, "2026-07-30")).toBe(true);
    expect(isOverdue({ ...미납, status: "partial", dueDate: "2026-07-01" }, "2026-07-30")).toBe(true);
  });
  it("완납·환불·무효는 기한이 지나도 false(돈 받은 기록)", () => {
    for (const status of ["paid", "refunded", "void"])
      expect(isOverdue({ ...미납, status, dueDate: "2026-07-01" }, "2026-07-30")).toBe(false);
  });
  it("기한이 오늘이면 아직 경과가 아니다(경계)", () => {
    expect(isOverdue({ ...미납, status: "unpaid", dueDate: "2026-07-30" }, "2026-07-30")).toBe(false);
    expect(isOverdue({ ...미납, status: "unpaid", dueDate: "2026-07-29" }, "2026-07-30")).toBe(true);
  });
  it("기한이 없으면 판정하지 않는다", () => {
    expect(isOverdue({ ...미납, status: "unpaid", dueDate: null }, "2026-07-30")).toBe(false);
  });

  // 🔴 실데이터 회귀 — 임포터가 상태를 `수납 < 청구`로 잡으면 **할인액만큼 항상 모자라** 완납 행이
  // partial로 굳는다(이승민 2026-03~06 4건). 배너가 "기한 경과 미수금 1건 0원"이라 말했다.
  it("상태는 미완납인데 잔액이 0이면 false — 받을 돈이 없으면 미수가 아니다", () => {
    expect(
      isOverdue(
        { status: "partial", dueDate: "2026-05-01", amountTotal: 694_875, amountDiscount: 10_000, amountPaid: 684_875 },
        "2026-07-30",
      ),
    ).toBe(false);
  });
});

describe("overdueLinesOnly — '기한 경과만'에서 표에 남길 라인", () => {
  it("완납(0) 라인은 숨기고 미납 라인만 남긴다", () => {
    const lines = [{ unpaid: 288_000 }, { unpaid: 0 }, { unpaid: 0 }, { unpaid: 0 }];
    expect(overdueLinesOnly(lines)).toEqual([{ unpaid: 288_000 }]);
  });
  // 미상(undefined)은 완납이라는 근거가 없다 — 숨기면 "안 밀렸다"는 거짓말이 된다.
  it("라인별 미납이 미상이면 남긴다(구형 3-key 인보이스)", () => {
    const lines = [{ unpaid: 330_000 }, {}, {}];
    expect(overdueLinesOnly(lines)).toHaveLength(3);
  });
  // 배너가 "N건"이라 말한 청구서가 표에서 통째로 증발하는 게 더 나쁘다.
  it("전부 걸러지면 원본을 그대로 — 청구서가 목록에서 사라지지 않게", () => {
    const lines = [{ unpaid: 0 }, { unpaid: 0 }];
    expect(overdueLinesOnly(lines)).toEqual(lines);
  });
});

describe("lastTouchedAt", () => {
  it("가장 최근 updated_at", () => {
    expect(lastTouchedAt([{ updatedAt: hoursBefore(50) }, { updatedAt: hoursBefore(1) }])).toBe(hoursBefore(1));
  });
  it("행이 없거나 전부 null이면 null", () => {
    expect(lastTouchedAt([])).toBeNull();
    expect(lastTouchedAt([{ updatedAt: null }])).toBeNull();
  });
});

describe("isOutsideSyncWindow — 통째로 동결된 달", () => {
  it("26시간을 넘겨 미갱신이면 창 밖", () => {
    expect(isOutsideSyncWindow({ rows: [{ updatedAt: hoursBefore(27) }], syncedAt: SYNCED })).toBe(true);
  });
  it("정상 실행 간격(12시간)은 창 안 — 하루 2회 동기화에서 오탐이 없어야 한다", () => {
    expect(isOutsideSyncWindow({ rows: [{ updatedAt: hoursBefore(12) }], syncedAt: SYNCED })).toBe(false);
    expect(isOutsideSyncWindow({ rows: [{ updatedAt: hoursBefore(26) }], syncedAt: SYNCED })).toBe(false); // 경계
  });
  // 판정 재료가 없으면 **모른다고 해야 한다** — 함부로 경고를 띄우면 화면이 거짓말을 한다.
  it("동기화 기록이나 행이 없으면 false(모르면 경고하지 않는다)", () => {
    expect(isOutsideSyncWindow({ rows: [{ updatedAt: hoursBefore(99) }], syncedAt: null })).toBe(false);
    expect(isOutsideSyncWindow({ rows: [], syncedAt: SYNCED })).toBe(false);
  });

  // 🔴 호출부 함정 — 이 판정은 **그 달 전체**를 받아야 한다.
  // 검색어로 좁힌 부분집합을 넘기면(엑셀 라우트가 그럴 뻔했다) 우연히 그 몇 건만 오래된 경우
  // 살아있는 달이 '동결'로 뒤집혀 '동기화 누락' 결과가 통째로 비어 버린다.
  it("부분집합을 넘기면 판정이 뒤집힌다 — 호출부는 반드시 그 달 전체를 넘길 것", () => {
    const 전체 = [{ updatedAt: hoursBefore(1) }, { updatedAt: hoursBefore(99) }];
    const 검색으로_좁힌_집합 = [{ updatedAt: hoursBefore(99) }];
    expect(isOutsideSyncWindow({ rows: 전체, syncedAt: SYNCED })).toBe(false); // 살아있는 달
    expect(isOutsideSyncWindow({ rows: 검색으로_좁힌_집합, syncedAt: SYNCED })).toBe(true); // 뒤집힘
  });
});

describe("isMissingFromMakeedu — 마지막 동기화에 없던 행", () => {
  const base = { syncedAt: SYNCED, outsideSyncWindow: false };
  it("26시간 넘게 미갱신이면 그 스크랩에 없었던 행", () => {
    expect(isMissingFromMakeedu({ ...base, row: { updatedAt: hoursBefore(30) } })).toBe(true);
    expect(isMissingFromMakeedu({ ...base, row: { updatedAt: hoursBefore(2) } })).toBe(false);
  });

  // 🔴 이게 없으면 2026-07의 401건이 전부 '사라진 청구'로 표시된다 — 동결된 달에선 전 행이 미갱신이다.
  it("동결된 달에서는 항상 false(전 행이 미갱신이라 판정이 무의미하다)", () => {
    expect(
      isMissingFromMakeedu({ row: { updatedAt: hoursBefore(300) }, syncedAt: SYNCED, outsideSyncWindow: true }),
    ).toBe(false);
  });

  it("판정 재료가 없으면 false", () => {
    expect(isMissingFromMakeedu({ ...base, row: { updatedAt: null } })).toBe(false);
    expect(isMissingFromMakeedu({ row: { updatedAt: hoursBefore(99) }, syncedAt: null, outsideSyncWindow: false })).toBe(false);
  });
});

describe("SYNC_STALE_MS", () => {
  // 동기화가 하루 2회(06·18시)라 임계는 주기(12h)보다 커야 정상 실행에서 오탐이 안 난다.
  it("26시간 — 동기화 주기(12시간)보다 크다", () => {
    expect(SYNC_STALE_MS).toBe(26 * 60 * 60 * 1000);
    expect(SYNC_STALE_MS).toBeGreaterThan(12 * 60 * 60 * 1000);
  });
});
