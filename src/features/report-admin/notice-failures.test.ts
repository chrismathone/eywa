import { describe, expect, it } from "vitest";
import { noticeFailures } from "./notice-failures";

describe("noticeFailures", () => {
  it("게시 결과 — ok:false만 실패", () => {
    const rows = [
      { board: "(수학)김덕현", ok: true, reports: [{ id: 1 }] },
      { board: "(수학)박라임A", ok: false, note: "학부모 미가입 또는 보드 미배정" },
    ];
    expect(noticeFailures(rows).map((r) => r.board)).toEqual(["(수학)박라임A"]);
  });

  it("🔴 수정 결과(`ok` 없음)는 실패가 아니다 — 08-25 '발송 완료 · 실패 7' 실사고", () => {
    // editNotice가 다시 쓴 모양: ok가 사라지고 reports만 남는다(글은 실제로 게시돼 있다).
    const edited = [
      { board: "(수학)박라임A", reports: [{ id: 1440761659, url: "https://…" }] },
      { board: "(수학)박서준C", reports: [{ id: 1440761666, url: "https://…" }] },
    ];
    expect(noticeFailures(edited)).toEqual([]);
  });

  it("🔴 회수 결과(`ok` 없음)도 실패가 아니다 — 2026-07-23 오탐", () => {
    const revoked = [{ board: "(수학)김덕현", revoked: [{ id: 1, revoked: true }] }];
    expect(noticeFailures(revoked)).toEqual([]);
  });

  it("ok가 명시적으로 false/누락값이면 실패 — undefined 값은 키가 있으니 실패로 본다", () => {
    expect(noticeFailures([{ board: "a", ok: undefined }])).toHaveLength(1);
    expect(noticeFailures([{ board: "a", ok: false }])).toHaveLength(1);
  });

  it("배열이 아니면 빈 목록", () => {
    expect(noticeFailures(null)).toEqual([]);
    expect(noticeFailures(undefined)).toEqual([]);
  });

  it("jsonb라 원소가 객체가 아닐 수도 있다 — 던지지 않는다(화면 전체가 죽는다)", () => {
    const junk = ["문자열", 3, null, undefined] as unknown as object[];
    expect(() => noticeFailures(junk)).not.toThrow();
    expect(noticeFailures(junk)).toEqual([]);
  });
});
