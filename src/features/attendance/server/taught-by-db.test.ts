import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { _resetTaughtByProbeForTest, taughtByColumnReady, taughtByColumnState } from "./taught-by-db";

/** `attendance_records.taught_by` probe 한 번의 응답을 흉내 낸다. */
const adminWith = (error: { code?: string; message?: string } | null) =>
  ({ from: () => ({ select: () => ({ limit: async () => ({ error }) }) }) }) as never;

beforeEach(() => {
  _resetTaughtByProbeForTest();
});

describe("대신 보강 귀속 칸(taught_by) probe — '없음'과 '확인 못 함'을 가른다", () => {
  it("칸이 있으면 ready(이후 probe 없이 유지)", async () => {
    expect(await taughtByColumnState(adminWith(null))).toBe("ready");
    expect(await taughtByColumnState(adminWith({ code: "XX000", message: "boom" }))).toBe("ready");
  });

  it("칸이 없다고 확인되면 missing", async () => {
    expect(await taughtByColumnState(adminWith({ code: "42703", message: 'column "taught_by" does not exist' }))).toBe("missing");
    expect(await taughtByColumnReady(adminWith(null))).toBe(false); // 없음 캐시(60초) — 읽는 곳은 다시 묻지 않는다
  });

  it("🔴 일시 오류는 unknown — 읽는 화면은 없음처럼 접지만(`taughtByColumnReady` = false), 금액으로 쓰는 자리는 이 값을 보고 멈춘다", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await taughtByColumnState(adminWith({ code: "57014", message: "canceling statement due to statement timeout" }))).toBe("unknown");
    expect(await taughtByColumnReady(adminWith({ code: "57014", message: "canceling statement due to statement timeout" }))).toBe(false);
    // 일시 오류는 캐시하지 않는다 — 다음 요청이 다시 본다.
    expect(await taughtByColumnState(adminWith(null))).toBe("ready");
    spy.mockRestore();
  });
});
