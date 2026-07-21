import { describe, expect, it } from "vitest";
import { extractWorkerEnv, formatWorkerResults } from "./worker-results";

// KST 12:30 = 03:30 UTC
const AT = "2026-07-19T03:30:00.000Z";

describe("formatWorkerResults", () => {
  it("폴러별 한글 라벨 + KST 시각 + 숫자 요약", () => {
    const rows = formatWorkerResults({
      reads: { at: AT, matched: 3, read: 1733, unread: 575, noToken: 1444 },
      queue: { at: AT, success: 2, failed: 1, requeued: 0 },
    });
    expect(rows.map((r) => r.label)).toEqual(["발송", "읽음"]); // 선언 순서(발송 먼저)
    expect(rows[0]).toMatchObject({ error: false });
    expect(rows[0].text).toBe("12:30 · 성공 2 · 실패 1");
    expect(rows[1].text).toBe("12:30 · 매칭 3 · 읽음 1733 · 미읽음 575"); // noToken은 대표값 아님 — 미표시
  });

  it("오류 항목은 '오류' + error=true", () => {
    const rows = formatWorkerResults({ comments: { at: AT, error: "피드 조회 실패 HTTP 500" } });
    expect(rows).toEqual([{ key: "comments", label: "댓글", text: "12:30 오류", error: true }]);
  });

  it("0값 필드는 생략, 숫자 없으면 시각만", () => {
    const rows = formatWorkerResults({ provision: { at: AT, created: 0, assigned: 0 } });
    expect(rows[0].text).toBe("12:30");
  });

  it("알 수 없는 폴러 키·시각 없는 항목은 건너뛴다(raw 키 누출 방지)", () => {
    expect(formatWorkerResults({ unknown_poller: { at: AT, x: 1 } })).toEqual([]);
    expect(formatWorkerResults({ reads: { matched: 3 } })).toEqual([]);
    expect(formatWorkerResults({ reads: { at: "이상한값", matched: 3 } })).toEqual([]);
  });

  it("비객체·null·배열 입력은 빈 배열(구워커 하위호환)", () => {
    expect(formatWorkerResults(null)).toEqual([]);
    expect(formatWorkerResults(undefined)).toEqual([]);
    expect(formatWorkerResults("문자열")).toEqual([]);
    expect(formatWorkerResults([1, 2])).toEqual([]);
  });
});

describe("extractWorkerEnv", () => {
  it("워커가 보낸 로그 폴더·최근 경고를 뽑는다", () => {
    expect(
      extractWorkerEnv({ env: { logDir: "C:/eywa-sync-pc/scripts/_classnote/_logs (폴백)", recent: ["a", "b"] } }),
    ).toEqual({ logDir: "C:/eywa-sync-pc/scripts/_classnote/_logs (폴백)", recent: ["a", "b"] });
  });

  it("최근 경고는 5줄까지만(카드가 시끄러워지지 않게)", () => {
    const many = ["1", "2", "3", "4", "5", "6", "7"];
    expect(extractWorkerEnv({ env: { logDir: "x", recent: many } }).recent).toEqual(["3", "4", "5", "6", "7"]);
  });

  it("구워커(env 키 없음)·비정상 입력은 빈 값 — 카드에 아무것도 안 뜬다", () => {
    const empty = { logDir: null, recent: [] };
    expect(extractWorkerEnv({ queue: { at: "2026-07-21T00:00:00Z" } })).toEqual(empty);
    expect(extractWorkerEnv(null)).toEqual(empty);
    expect(extractWorkerEnv({ env: "문자열" })).toEqual(empty);
    expect(extractWorkerEnv({ env: { logDir: 3, recent: [1, "ok"] } })).toEqual({ logDir: null, recent: ["ok"] });
  });
});
