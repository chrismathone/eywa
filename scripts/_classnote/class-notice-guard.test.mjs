import { describe, expect, it } from "vitest";
import { buildClassNoticePayload, classNoticeAttachments, evaluateClassNoticeBoard, isTestOnlyBoard } from "./class-notice-guard.mjs";

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

describe("반 공지 이미지", () => {
  const img = (k) => ({ access_key: k, original_file_name: `${k}.png`, file_size: 10, width: 1, height: 1 });
  it("올린 이미지를 그대로 싣는다 · 없으면 빈 목록(글만)", () => {
    const base = { boardId: 5, title: "t", body: "b", centerId: 1, authorName: "a" };
    expect(buildClassNoticePayload(base).attached_images).toEqual([]);
    expect(buildClassNoticePayload({ ...base, attachedImages: [img("k1"), img("k2")] }).attached_images.map((x) => x.access_key)).toEqual(["k1", "k2"]);
  });
  it("🔴 키가 없는 이미지·상한(10장) 초과는 던진다 — 이미지가 조용히 빠진 공지를 올리지 않는다", () => {
    const base = { boardId: 5, title: "t", body: "b", centerId: 1, authorName: "a" };
    expect(() => buildClassNoticePayload({ ...base, attachedImages: [img("k1"), { original_file_name: "x.png" }] })).toThrow("올리지 못한 이미지");
    expect(() => buildClassNoticePayload({ ...base, attachedImages: Array.from({ length: 11 }, (_, i) => img(`k${i}`)) })).toThrow("최대 10장");
  });
  it("큐 행의 이미지 — 대상마다 같은 목록이 들어 있어 경로 기준으로 한 벌로 합친다 · 없으면 빈 목록", () => {
    const a = { path: "t/report-attachments/a.png", name: "표.png" };
    const b = { path: "t/report-attachments/b.png", name: "" };
    expect(classNoticeAttachments({ targets: [{ classId: "c1", attachments: [a, b] }, { classId: "c2", attachments: [a, b] }] })).toEqual([a, { path: b.path, name: "이미지" }]);
    expect(classNoticeAttachments({ targets: [{ classId: "c1", className: "가반" }] })).toEqual([]);
    expect(classNoticeAttachments({ targets: null })).toEqual([]);
    expect(classNoticeAttachments({ targets: [{ attachments: [{ path: "  " }, null, { name: "x" }] }] })).toEqual([]);
  });
});
