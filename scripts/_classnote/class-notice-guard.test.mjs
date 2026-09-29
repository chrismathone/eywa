import { describe, expect, it } from "vitest";
import { buildClassNoticePayload, evaluateClassNoticeBoard, isTestOnlyBoard } from "./class-notice-guard.mjs";

describe("evaluateClassNoticeBoard", () => {
  it("보드 원아가 전부 그 반 재원생(매칭 확인)이면 통과", () => {
    expect(evaluateClassNoticeBoard({ live: [{ id: 1 }, { id: 2 }], allowed: [1, 2, 3] })).toEqual({ ok: true });
  });
  it("🔴 반을 옮긴 학생이 보드에 남아 있으면 막는다(반 공지가 그 집에도 간다)", () => {
    const v = evaluateClassNoticeBoard({ live: [{ id: 1, name: "김가" }, { id: 9, name: "옛반학생" }], allowed: new Set([1]) });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("옛반학생");
  });
  it("원아 0명·조회 실패도 막는다", () => {
    expect(evaluateClassNoticeBoard({ live: [], allowed: [1] }).ok).toBe(false);
    expect(evaluateClassNoticeBoard({ live: null, allowed: [1] }).ok).toBe(false);
  });
});

describe("isTestOnlyBoard", () => {
  it("학원* 원아만이면 테스트 보드", () => {
    expect(isTestOnlyBoard([{ name: "학원이" }, { name: "학원삼" }])).toBe(true);
    expect(isTestOnlyBoard([{ name: "학원이" }, { name: "김가" }])).toBe(false);
    expect(isTestOnlyBoard([])).toBe(false);
  });
});

describe("buildClassNoticePayload", () => {
  it("대상 반은 정확히 하나", () => {
    const p = buildClassNoticePayload({ boardId: 5, title: "t", body: "b", centerId: 96575, authorName: "인재원 학원" });
    expect(p.classes_to).toEqual([5]);
    expect(p.center).toBe(96575);
  });
  it("🔴 반 번호가 없거나 이상하면 던진다(기관 전체 공지 차단)", () => {
    for (const boardId of [null, undefined, 0, -1, "x", 1.5])
      expect(() => buildClassNoticePayload({ boardId, title: "t", body: "b", centerId: 1, authorName: "a" })).toThrow();
  });
  it("제목·내용이 비면 던진다", () => {
    expect(() => buildClassNoticePayload({ boardId: 5, title: " ", body: "b", centerId: 1, authorName: "a" })).toThrow();
  });
});
