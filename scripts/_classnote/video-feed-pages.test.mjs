import { describe, expect, it, vi } from "vitest";
import { allVideoComments, nextVideoCursor } from "./video-feed-pages.mjs";
describe("과거 영상 전체 페이지", () => {
  it("100개 다음의 오래된 댓글까지 읽는다", async () => {
    const page = { evaluate: vi.fn().mockResolvedValueOnce({ results: Array.from({ length: 100 }, (_, id) => ({ id })), next: "next-token" })
      .mockResolvedValueOnce({ results: [{ id: 101, attached_video: { id: 9 } }], next: null }) };
    expect(await allVideoComments(page, "12")).toHaveLength(101);
    expect(page.evaluate.mock.calls[1][1].cursor).toBe("next-token");
  });
  it("진행하지 않는 cursor는 끝으로 위장하지 않는다", async () => {
    const page = { evaluate: vi.fn().mockResolvedValue({ results: [{ id: 1 }], next: "same" }) };
    await expect(allVideoComments(page, "12")).rejects.toThrow("진행되지");
  });
  it("다음 URL에서 토큰만 읽고 다른 게시물 경로는 거절한다", () => {
    expect(nextVideoCursor("https://classnote.com/api/v1/reports/12/comments/?page=abc", "/api/v1/reports/12/comments/")).toBe("abc");
    expect(() => nextVideoCursor("/api/v1/reports/13/comments/?page=abc", "/api/v1/reports/12/comments/")).toThrow("경로");
  });
});
