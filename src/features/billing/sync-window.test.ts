import { describe, it, expect } from "vitest";
import {
  isOverdue,
  isOutsideSyncWindow,
  isMissingFromMakeedu,
  lastTouchedAt,
  SYNC_STALE_MS,
} from "./sync-window";

// 화면(billing-content)과 엑셀 라우트가 같은 집합을 말하는지는 이 판정에 달려 있다 —
// 예전엔 isOverdue가 두 곳에 복제돼 있어 한쪽만 고치면 조용히 어긋났다(gotchas #77).

const T = (iso: string) => new Date(iso).toISOString();
const SYNCED = T("2026-07-30T09:00:00Z");
const hoursBefore = (h: number) => T(new Date(Date.parse(SYNCED) - h * 3_600_000).toISOString());

describe("isOverdue", () => {
  it("미완납 + 기한 경과만 true", () => {
    expect(isOverdue({ status: "unpaid", dueDate: "2026-07-01" }, "2026-07-30")).toBe(true);
    expect(isOverdue({ status: "partial", dueDate: "2026-07-01" }, "2026-07-30")).toBe(true);
  });
  it("완납·환불·무효는 기한이 지나도 false(돈 받은 기록)", () => {
    for (const status of ["paid", "refunded", "void"])
      expect(isOverdue({ status, dueDate: "2026-07-01" }, "2026-07-30")).toBe(false);
  });
  it("기한이 오늘이면 아직 경과가 아니다(경계)", () => {
    expect(isOverdue({ status: "unpaid", dueDate: "2026-07-30" }, "2026-07-30")).toBe(false);
    expect(isOverdue({ status: "unpaid", dueDate: "2026-07-29" }, "2026-07-30")).toBe(true);
  });
  it("기한이 없으면 판정하지 않는다", () => {
    expect(isOverdue({ status: "unpaid", dueDate: null }, "2026-07-30")).toBe(false);
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
