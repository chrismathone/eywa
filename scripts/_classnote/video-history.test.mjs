// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ feed: vi.fn(), comments: vi.fn(), enqueue: vi.fn() }));
vi.mock("./video-feed-pages.mjs", () => ({ videoFeedPage: mock.feed, allVideoComments: mock.comments }));
vi.mock("./video-inbox.mjs", () => ({ enqueueParentVideos: mock.enqueue }));
import { scanVideoHistory } from "./video-history.mjs";
function db() {
  let row = { state: {}, revision: 0 };
  const sql = async (parts, ...args) => {
    const query = parts.join("?");
    if (query.includes("select state")) return [structuredClone(row)];
    if (query.includes("update classnote_video_history")) {
      if (args.at(-1) !== row.revision) return [];
      row = { state: structuredClone(args[0]), revision: row.revision + 1 };
      return [{ revision: row.revision }];
    }
    return [];
  };
  sql.json = (v) => v;
  return { sql, state: () => structuredClone(row.state) };
}
beforeEach(() => { vi.resetAllMocks(); mock.enqueue.mockResolvedValue(1); mock.comments.mockResolvedValue([]); });
describe("과거 영상 수집 재개", () => {
  it("중간 재시작과 새 글 삽입에도 고정한 페이지의 남은 글을 먼저 처리한다", async () => {
    const store = db();
    mock.feed.mockResolvedValue({ list: [{ id: 3 }, { id: 2 }], next: "older" });
    await scanVideoHistory(store.sql, {}, "tenant", "12", { limit: 1, log: () => {} });
    expect(store.state().pending.map((p) => p.id)).toEqual([2]);
    await scanVideoHistory(store.sql, {}, "tenant", "12", { limit: 1, log: () => {} });
    expect(mock.feed).toHaveBeenCalledTimes(1);
    expect(store.state()).toEqual({ cursor: "older", scanned: 2 });
  });
  it("댓글 수집 실패 시 글을 건너뛰지 않고 같은 위치에서 재시도한다", async () => {
    const store = db();
    mock.feed.mockResolvedValue({ list: [{ id: 1, num_comments: 101 }], next: null });
    mock.comments.mockRejectedValueOnce(new Error("network"));
    await expect(scanVideoHistory(store.sql, {}, "tenant", "12", { log: () => {} })).rejects.toThrow("network");
    expect(store.state().pending).toHaveLength(1);
    const result = await scanVideoHistory(store.sql, {}, "tenant", "12", { log: () => {} });
    expect(result.complete).toBe(true);
    expect(store.state().pending).toBeUndefined();
  });
  it("이미 삭제된 원글의 404 때문에 전체 이력이 영구 정지하지 않는다", async () => {
    const store = db();
    mock.feed.mockResolvedValue({ list: [{ id: 1, num_comments: 1 }], next: null });
    mock.comments.mockRejectedValue(new Error("page.evaluate: 영상 기록 조회 HTTP 404"));
    expect((await scanVideoHistory(store.sql, {}, "tenant", "12", { log: () => {} })).complete).toBe(true);
  });
});
