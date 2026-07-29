import { describe, expect, it } from "vitest";
import {
  archiveName,
  kstDate,
  kstHHmm,
  needsRotation,
  pruneList,
  uniqueArchiveName,
} from "./log-rotation.mjs";

const T = (iso) => Date.parse(iso);

describe("kstDate / kstHHmm", () => {
  it("KST 기준으로 자른다 — UTC 15:00은 이미 다음 날", () => {
    expect(kstDate(T("2026-07-28T14:59:00Z"))).toBe("2026-07-28");
    expect(kstDate(T("2026-07-28T15:00:00Z"))).toBe("2026-07-29");
  });

  it("HHmm도 KST", () => {
    expect(kstHHmm(T("2026-07-29T05:32:00Z"))).toBe("1432");
  });
});

describe("needsRotation", () => {
  it("어제 쓰인 파일이면 날짜 회전", () => {
    const r = needsRotation({
      mtimeMs: T("2026-07-28T10:00:00Z"),
      sizeBytes: 1234,
      nowMs: T("2026-07-29T02:00:00Z"),
    });
    expect(r).toMatchObject({ rotate: true, reason: "date", archiveDate: "2026-07-28" });
  });

  it("같은 날이면 회전하지 않는다", () => {
    expect(
      needsRotation({ mtimeMs: T("2026-07-29T01:00:00Z"), sizeBytes: 999, nowMs: T("2026-07-29T02:00:00Z") }).rotate,
    ).toBe(false);
  });

  it("같은 날이어도 상한을 넘으면 크기 회전", () => {
    const r = needsRotation({
      mtimeMs: T("2026-07-29T01:00:00Z"),
      sizeBytes: 21 * 1024 * 1024,
      nowMs: T("2026-07-29T02:00:00Z"),
      maxBytes: 20 * 1024 * 1024,
    });
    expect(r).toMatchObject({ rotate: true, reason: "size" });
  });

  it("빈 파일·없는 파일은 넘기지 않는다(첫 기동에서 헛돌지 않게)", () => {
    expect(needsRotation({ mtimeMs: T("2026-07-01T00:00:00Z"), sizeBytes: 0, nowMs: T("2026-07-29T02:00:00Z") }).rotate).toBe(false);
    expect(needsRotation({ mtimeMs: NaN, sizeBytes: NaN, nowMs: Date.now() }).rotate).toBe(false);
  });

  it("자정 경계 — KST 23:59에 쓰고 00:01에 판단하면 어제로 보관", () => {
    const r = needsRotation({
      mtimeMs: T("2026-07-28T14:59:00Z"), // KST 07-28 23:59
      sizeBytes: 10,
      nowMs: T("2026-07-28T15:01:00Z"), // KST 07-29 00:01
    });
    expect(r).toMatchObject({ rotate: true, archiveDate: "2026-07-28" });
  });
});

describe("archiveName / uniqueArchiveName", () => {
  it("날짜 회전은 날짜만, 크기 회전은 시각까지", () => {
    expect(archiveName({ archiveDate: "2026-07-28", reason: "date", nowMs: T("2026-07-29T02:00:00Z") })).toBe("watch-2026-07-28.log");
    expect(archiveName({ archiveDate: "2026-07-29", reason: "size", nowMs: T("2026-07-29T05:32:00Z") })).toBe("watch-2026-07-29_1432.log");
  });

  it("같은 이름이 있으면 덮어쓰지 않고 접미사를 붙인다 — 로그 소실 방지", () => {
    const existing = new Set(["watch-2026-07-28.log", "watch-2026-07-28_1432.log"]);
    const name = uniqueArchiveName("watch-2026-07-28.log", (n) => existing.has(n), T("2026-07-29T05:32:00Z"));
    expect(name).toBe("watch-2026-07-28_1432-1.log");
  });
});

describe("pruneList", () => {
  const now = T("2026-07-29T02:00:00Z");
  it("보관 기간이 지난 것만 고른다", () => {
    const names = ["watch.log", "watch-2026-07-28.log", "watch-2026-05-01.log", "watch-2026-06-29.log"];
    expect(pruneList(names, { nowMs: now, keepDays: 30 })).toEqual(["watch-2026-05-01.log"]);
  });

  it("살아 있는 watch.log와 형식이 다른 파일은 절대 건드리지 않는다", () => {
    const names = ["watch.log", "provision-last-run.txt", "board-roster-last-run.txt", "watch-2020-01-01.txt", "메모.log"];
    expect(pruneList(names, { nowMs: now, keepDays: 1 })).toEqual([]);
  });

  it("크기 회전본(_HHmm)도 대상", () => {
    expect(pruneList(["watch-2026-01-02_0930.log"], { nowMs: now, keepDays: 30 })).toEqual(["watch-2026-01-02_0930.log"]);
  });
});
