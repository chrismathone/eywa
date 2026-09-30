// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ feed: vi.fn(), comments: vi.fn(), enqueue: vi.fn() }));
vi.mock("./video-feed-pages.mjs", () => ({ videoFeedPage: mock.feed, allVideoComments: mock.comments }));
vi.mock("./video-inbox.mjs", () => ({ enqueueParentVideos: mock.enqueue }));
import { scanVideoHistory } from "./video-history.mjs";
function db(initial = {}) {
  let row = { state: structuredClone(initial), revision: 0 };
  let writes = 0;
  const sql = async (parts, ...args) => {
    const query = parts.join("?");
    if (query.includes("select state")) return [structuredClone(row)];
    if (query.includes("update classnote_video_history")) {
      if (args.at(-1) !== row.revision) return [];
      row = { state: structuredClone(args[0]), revision: row.revision + 1 };
      writes++;
      return [{ revision: row.revision }];
    }
    return [];
  };
  sql.json = (v) => v;
  return { sql, state: () => structuredClone(row.state), writes: () => writes };
}
const quiet = { log: () => {} };
const plain = (id) => ({ id }); // 영상도 댓글도 없는 글
const commented = (id, n = 1) => ({ id, num_comments: n });
beforeEach(() => { vi.resetAllMocks(); mock.enqueue.mockResolvedValue(1); mock.comments.mockResolvedValue([]); });
describe("과거 영상 수집 재개", () => {
  it("중간 재시작과 새 글 삽입에도 고정한 페이지의 남은 글을 먼저 처리한다", async () => {
    const store = db();
    mock.feed.mockResolvedValueOnce({ list: [commented(3), commented(2)], next: "older" }).mockResolvedValueOnce({ list: [plain(1)], next: null });
    await scanVideoHistory(store.sql, {}, "tenant", "12", { limit: 1, ...quiet });
    expect(store.state().pending.map((p) => p.id)).toEqual([2]);
    expect(mock.feed).toHaveBeenCalledTimes(1);
    const result = await scanVideoHistory(store.sql, {}, "tenant", "12", { limit: 1, ...quiet });
    // 첫 쪽을 다시 읽지 않고 남은 글(2)을 끝낸 뒤에야 다음 쪽("older")으로 간다.
    expect(mock.feed).toHaveBeenCalledTimes(2);
    expect(mock.feed.mock.calls[1][2]).toBe("older");
    expect(mock.comments.mock.calls.map((c) => c[1])).toEqual([3, 2]);
    expect(result).toMatchObject({ scanned: 3, complete: true });
  });
  it("댓글 수집 실패 시 글을 건너뛰지 않고 같은 위치에서 재시도한다", async () => {
    const store = db();
    mock.feed.mockResolvedValue({ list: [{ id: 1, num_comments: 101 }], next: null });
    mock.comments.mockRejectedValueOnce(new Error("network"));
    await expect(scanVideoHistory(store.sql, {}, "tenant", "12", quiet)).rejects.toThrow("network");
    expect(store.state().pending).toHaveLength(1);
    const result = await scanVideoHistory(store.sql, {}, "tenant", "12", quiet);
    expect(result.complete).toBe(true);
    expect(store.state().pending).toBeUndefined();
  });
  it("이미 삭제된 원글의 404 때문에 전체 이력이 영구 정지하지 않는다", async () => {
    const store = db();
    mock.feed.mockResolvedValue({ list: [{ id: 1, num_comments: 1 }], next: null });
    // Playwright가 실제로 던지는 모양 — 문구 뒤에 스택이 붙는다.
    mock.comments.mockRejectedValue(new Error("page.evaluate: Error: 영상 기록 조회 HTTP 404\n    at eval (eval at evaluate (:290:30), <anonymous>:6:34)"));
    expect((await scanVideoHistory(store.sql, {}, "tenant", "12", quiet)).complete).toBe(true);
  });
  it("삭제가 아닌 실패(5xx·다른 번호)는 넘기지 않는다", async () => {
    for (const message of ["page.evaluate: Error: 영상 기록 조회 HTTP 500\n    at eval", "page.evaluate: Error: 영상 기록 조회 HTTP 4040\n    at eval"]) {
      const store = db();
      mock.feed.mockResolvedValue({ list: [{ id: 1, num_comments: 1 }], next: null });
      mock.comments.mockRejectedValue(new Error(message));
      await expect(scanVideoHistory(store.sql, {}, "tenant", "12", quiet)).rejects.toThrow("영상 기록 조회");
      expect(store.state().pending).toHaveLength(1);
    }
  });
});
describe("과거 영상 수집 속도 — 볼 것이 없는 글은 예산 없이 넘긴다", () => {
  it("영상도 댓글도 없는 글은 예산을 쓰지 않고, 손이 가는 글만 limit로 센다", async () => {
    const store = db();
    const list = [...Array.from({ length: 40 }, (_, i) => plain(100 - i)), commented(60), ...Array.from({ length: 30 }, (_, i) => plain(59 - i)),
      { id: 29, author: { type: "parent" }, attached_video: { id: 7, high: "https://v/high", low: null } }, plain(28)];
    mock.feed.mockResolvedValue({ list, next: "older" });
    await scanVideoHistory(store.sql, {}, "tenant", "12", { limit: 1, ...quiet });
    // 앞의 40건을 넘기고 댓글 글(60) 하나를 처리한 뒤, 뒤의 30건도 넘기고 영상 글(29)에서 멈춘다.
    expect(store.state().pending.map((p) => p.id)).toEqual([29, 28]);
    expect(store.state().scanned).toBe(71);
    expect(mock.comments).toHaveBeenCalledTimes(1);
    expect(mock.enqueue).toHaveBeenCalledTimes(2); // 글(60) + 그 댓글 — 넘긴 글에는 큐 저장을 부르지 않는다
    expect(store.writes()).toBe(3); // 글마다 쓰지 않는다(목록 고정 · 글 60(앞의 40건 포함) · 예산 소진 시 넘긴 30건)
    await scanVideoHistory(store.sql, {}, "tenant", "12", { limit: 1, maxPages: 0, ...quiet });
    expect(store.state()).toEqual({ cursor: "older", scanned: 73 }); // 영상 글(29)을 큐에 넣고 나머지도 끝
    expect(mock.enqueue.mock.calls.at(-1)[3][0].attached_video).toEqual({ id: 7, high: "https://v/high", low: null });
  });
  it("넘긴 뒤 다음 글이 실패해도 위치를 잃지 않고 글 수를 두 번 세지 않는다", async () => {
    const store = db();
    mock.feed.mockResolvedValue({ list: [plain(5), plain(4), commented(3), plain(2)], next: null });
    mock.comments.mockRejectedValueOnce(new Error("network"));
    await expect(scanVideoHistory(store.sql, {}, "tenant", "12", quiet)).rejects.toThrow("network");
    expect(store.state().pending.map((p) => p.id)).toEqual([5, 4, 3, 2]); // 넘긴 글은 다시 넘기면 된다(요청·저장 없음)
    expect((await scanVideoHistory(store.sql, {}, "tenant", "12", quiet))).toMatchObject({ scanned: 4, complete: true });
    expect(mock.feed).toHaveBeenCalledTimes(1);
  });
  it("댓글 수가 글자·빈 값이어도, 교사가 올린 영상 글이어도 판정이 같다", async () => {
    const store = db();
    const video = { id: 9, high: "https://v/high", low: null };
    mock.feed.mockResolvedValue({ next: null, list: [
      { id: 9, num_comments: "0" }, { id: 8, num_comments: null }, { id: 7, author: { type: "teacher" }, attached_video: video }, // 볼 것 없음
      { id: 6, num_comments: "3" }, { id: 5, author: { type: "parent" }, attached_video: video }, { id: 4, author: { type: "teacher" }, attached_video: video, num_comments: 1 },
    ] });
    expect(await scanVideoHistory(store.sql, {}, "tenant", "12", { limit: 3, ...quiet })).toMatchObject({ scanned: 6, complete: true });
    expect(mock.comments.mock.calls.map((c) => c[1])).toEqual([6, 4]);
    expect(mock.enqueue.mock.calls.filter((c) => !c[4]).map((c) => c[3][0].id)).toEqual([6, 5, 4]); // 글 자체를 큐 판정에 넘긴 것
  });
  it("옛 버전이 남긴 중간 상태(고정한 목록)를 그대로 이어받는다", async () => {
    const store = db({ pending: [plain(3), commented(2), plain(1)], next: "older", scanned: 40 });
    await scanVideoHistory(store.sql, {}, "tenant", "12", { maxPages: 0, ...quiet });
    expect(mock.feed).not.toHaveBeenCalled();
    expect(store.state()).toEqual({ cursor: "older", scanned: 43 });
  });
  it("예산이 0이면 아무것도 읽지도 쓰지도 않는다", async () => {
    const store = db();
    await scanVideoHistory(store.sql, {}, "tenant", "12", { maxPages: 0, ...quiet });
    expect(mock.feed).not.toHaveBeenCalled();
    expect(store.writes()).toBe(0);
  });
  it("한 번에 새로 읽는 목록은 maxPages 쪽까지다", async () => {
    const store = db();
    let n = 0;
    mock.feed.mockImplementation(async () => { const k = ++n; return { list: Array.from({ length: 100 }, (_, i) => plain(k * 1000 - i)), next: `c${k}` }; });
    const result = await scanVideoHistory(store.sql, {}, "tenant", "12", quiet);
    expect(mock.feed).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ scanned: 300, added: 0, complete: false });
    expect(store.state()).toEqual({ cursor: "c3", scanned: 300 });
    expect(mock.feed.mock.calls.map((c) => c[2])).toEqual([undefined, "c1", "c2"]);
  });
  it("마지막 쪽까지 읽으면 완료로 적고, 하루 안에는 다시 돌지 않는다", async () => {
    const store = db();
    mock.feed.mockResolvedValueOnce({ list: [plain(2)], next: "c1" }).mockResolvedValueOnce({ list: [plain(1)], next: null });
    expect(await scanVideoHistory(store.sql, {}, "tenant", "12", quiet)).toMatchObject({ scanned: 2, complete: true });
    expect(await scanVideoHistory(store.sql, {}, "tenant", "12", quiet)).toBeUndefined();
    expect(mock.feed).toHaveBeenCalledTimes(2);
  });
});
