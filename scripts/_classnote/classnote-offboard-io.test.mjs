// 퇴소 명부 읽기(퇴원처리 확인용) — 끝까지 읽는다(봉투 `next` 주소를 따라감) · 꽉 찬 배열이면 모른다(throw → 확인 실패 → 멈춤 · 리뷰 R5·F9).
// page.evaluate에 넘긴 함수를 그대로 돌리고 fetch·location만 갈아 끼운다(2026-11-03 실측: DRF 봉투 count·next · page_size 1000에 169건).
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPostComments, leftIds } from "./classnote-offboard-io.mjs";

const page = { evaluate: (fn, arg) => fn(arg) };
const rows = (from, n, out = true) => Array.from({ length: n }, (_, i) => ({ child_id: from + i, out_date: out ? "2026-11-03" : null }));
afterEach(() => vi.unstubAllGlobals());

describe("leftIds — 그 해 퇴소 명부", () => {
  it("🔴 봉투면 `next` 주소를 그대로 따라간다(쪽 번호를 직접 만들지 않는다 · F9) · 캐시 없이 · out_date 있는 줄만", async () => {
    vi.stubGlobal("location", { origin: "https://www.classnote.com" });
    const urls = [];
    vi.stubGlobal("fetch", async (url, init) => {
      urls.push(url);
      expect(init.cache).toBe("no-store");
      if (url.includes("cursor=abc")) return { ok: true, json: async () => ({ count: 3, next: null, results: rows(3, 1) }) };
      return { ok: true, json: async () => ({ count: 3, next: "https://www.classnote.com/api/v1_2/centers/1/admissioninfos?cursor=abc&year_left=2026", results: [...rows(1, 2), ...rows(50, 1, false)] }) };
    });
    expect([...(await leftIds(page, 1, 2026))]).toEqual([1, 2, 3]);
    expect(urls).toEqual([
      "/api/v1_2/centers/1/admissioninfos?name=&page=1&page_size=1000&year_left=2026&tz=Asia/Seoul",
      "/api/v1_2/centers/1/admissioninfos?cursor=abc&year_left=2026",
    ]);
  });
  it("🔴 배열 응답이 1,000건으로 꽉 차면 끝까지 읽었는지 몰라 throw · 조회 실패도 throw · 20쪽 넘으면 throw", async () => {
    vi.stubGlobal("location", { origin: "https://x" });
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => rows(1, 1000) }));
    await expect(leftIds(page, 1, 2026)).rejects.toThrow("꽉 차");
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 502, json: async () => ({}) }));
    await expect(leftIds(page, 1, 2026)).rejects.toThrow("HTTP 502");
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ next: "https://x/again", results: [] }) }));
    await expect(leftIds(page, 1, 2026)).rejects.toThrow("20쪽");
  });
});

describe("fetchPostComments — 글마다 댓글 전부 · 요청 수", () => {
  it("next를 따라 끝까지 받은 글만 complete · 요청 수를 센다(비용 점검 F14)", async () => {
    vi.stubGlobal("location", { origin: "https://x" });
    vi.stubGlobal("fetch", async (url) => {
      if (url.includes("page=2")) return { ok: true, json: async () => ({ next: null, results: [{ id: 12 }] }) };
      if (url.startsWith("/api/v1/reports/1/")) return { ok: true, json: async () => ({ next: "https://x/api/v1/reports/1/comments/?page=2", results: [{ id: 11 }] }) };
      return { ok: false, status: 500, json: async () => ({}) };
    });
    const r = await fetchPostComments(page, [1, 2]);
    expect([...r.complete]).toEqual([1]);
    expect(r.byPost.get(1).map((c) => c.id)).toEqual([11, 12]);
    expect(r.requests).toBe(3);
  });
});
