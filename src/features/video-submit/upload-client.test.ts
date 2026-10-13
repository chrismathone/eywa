import { describe, expect, it, vi } from "vitest";
import { CHUNK_BYTES, NETWORK_RETRY_MS, nextOffsetFromRange, runResumableUpload, UploadError, wakeableSleep, type PutResult } from "./upload-client";

const blob = (n: number) => ({ size: n }) as unknown as Blob;
const noSleep = async () => {};

describe("Range 해석", () => {
  it("받은 마지막 바이트 다음이 이어 보낼 자리", () => {
    expect(nextOffsetFromRange("bytes=0-1023")).toBe(1024);
    expect(nextOffsetFromRange(null)).toBe(null);
    expect(nextOffsetFromRange("bytes=5-9")).toBe(null);
  });
});

describe("조각 업로드·이어 올리기", () => {
  it("조각마다 Content-Range를 맞게 보내고 마지막에 끝난다", async () => {
    const size = CHUNK_BYTES * 2 + 5;
    const ranges: string[] = [];
    const put = vi.fn(async (_b: Blob | null, range: string): Promise<PutResult> => {
      ranges.push(range);
      const end = Number(/-(\d+)\//.exec(range)![1]);
      return end === size - 1 ? { status: 200, range: null } : { status: 308, range: `bytes=0-${end}` };
    });
    await runResumableUpload({ size, slice: (s, e) => blob(e - s), put, sleep: noSleep });
    expect(ranges).toEqual([
      `bytes 0-${CHUNK_BYTES - 1}/${size}`,
      `bytes ${CHUNK_BYTES}-${CHUNK_BYTES * 2 - 1}/${size}`,
      `bytes ${CHUNK_BYTES * 2}-${size - 1}/${size}`,
    ]);
  });

  it("끊기면 '어디까지 받았나'를 묻고 그 자리부터 잇는다", async () => {
    const size = CHUNK_BYTES + 10;
    const calls: string[] = [];
    let first = true;
    const put = vi.fn(async (_b: Blob | null, range: string): Promise<PutResult> => {
      calls.push(range);
      if (first) { first = false; throw new Error("network"); }
      if (range === `bytes */${size}`) return { status: 308, range: "bytes=0-99" };
      return { status: 200, range: null };
    });
    await runResumableUpload({ size, slice: (s, e) => blob(e - s), put, sleep: noSleep });
    expect(calls).toEqual([`bytes 0-${CHUNK_BYTES - 1}/${size}`, `bytes */${size}`, `bytes 100-${size - 1}/${size}`]);
  });

  it("묻기에 Range가 없으면 처음부터(아무것도 못 받음)", async () => {
    const size = 50;
    const calls: string[] = [];
    let n = 0;
    const put = vi.fn(async (_b: Blob | null, range: string): Promise<PutResult> => {
      calls.push(range);
      if (n++ === 0) return { status: 503, range: null };
      if (range.startsWith("bytes */")) return { status: 308, range: null };
      return { status: 200, range: null };
    });
    await runResumableUpload({ size, slice: (s, e) => blob(e - s), put, sleep: noSleep });
    expect(calls).toEqual(["bytes 0-49/50", "bytes */50", "bytes 0-49/50"]);
  });

  it("세션이 사라지면(404) 바로 멈추고, 서버 오류가 계속되면 5번 다시 시도한 뒤 멈춘다", async () => {
    await expect(runResumableUpload({ size: 10, slice: (s, e) => blob(e - s), put: async () => ({ status: 404, range: null }), sleep: noSleep }))
      .rejects.toMatchObject({ code: "session_gone" });
    const put = vi.fn(async (): Promise<PutResult> => ({ status: 503, range: null }));
    await expect(runResumableUpload({ size: 10, slice: (s, e) => blob(e - s), put, sleep: noSleep })).rejects.toMatchObject({ reason: "server_error" });
    expect(put.mock.calls.length).toBe(6);
  });

  /** 기다림이 시계를 움직이는 가짜 시계 — 실제로 기다리지 않고 '몇 분 동안'을 잰다. */
  const fakeClock = () => {
    let t = 0;
    return { now: () => t, sleep: async (ms: number) => { t += ms; }, tick: (ms: number) => { t += ms; }, elapsed: () => t };
  };

  it("🔴 응답이 아예 없는 실패(연결 끊김)는 3분 동안 이어서 다시 시도한 뒤에야 멈춘다", async () => {
    const clock = fakeClock();
    const put = vi.fn(async (): Promise<PutResult> => { throw new Error("network"); });
    await expect(runResumableUpload({ size: 10, slice: (s, e) => blob(e - s), put, sleep: clock.sleep, now: clock.now }))
      .rejects.toMatchObject({ reason: "network" });
    expect(clock.elapsed()).toBeGreaterThanOrEqual(NETWORK_RETRY_MS);
    expect(clock.elapsed()).toBeLessThan(NETWORK_RETRY_MS + 60_000);
  });

  it("🔴 1~2분 끊겼다가 다시 잡히면 실패 없이 이어 올린다(2026-10-13 카카오톡 앱 안 브라우저 실측 모양)", async () => {
    const clock = fakeClock();
    const size = CHUNK_BYTES + 10;
    const events: string[] = [];
    const put = vi.fn(async (_b: Blob | null, range: string): Promise<PutResult> => {
      if (clock.now() < 100_000) throw new Error("network"); // 첫 조각부터 '어디까지 받았나'까지 전부 바로 실패
      if (range === `bytes */${size}`) return { status: 308, range: null };
      const end = Number(/-(\d+)\//.exec(range)![1]);
      return end === size - 1 ? { status: 200, range: null } : { status: 308, range: `bytes=0-${end}` };
    });
    await runResumableUpload({ size, slice: (s, e) => blob(e - s), put, sleep: clock.sleep, now: clock.now, onEvent: (kind) => events.push(kind) });
    expect(events.at(-1)).toBe("transferred");
    expect(events).not.toContain("failed");
  });

  it("🔴 '어디까지 받았나'는 되는데 조각만 계속 못 보내면(파일을 다시 못 읽는 폰) 그 응답으로 끊김 시계를 되돌리지 않고 3분에 끝낸다", async () => {
    const clock = fakeClock();
    const size = CHUNK_BYTES * 60; // 약 1GB — 예전 수리안이면 예산(≈190바퀴)만큼 50분 넘게 멈춰 보였다
    const attempts: number[] = [];
    const put = vi.fn(async (body: Blob | null): Promise<PutResult> => {
      clock.tick(300); // 요청 한 번에 걸리는 시간
      if (!body) return { status: 308, range: null };
      throw new Error("network");
    });
    await expect(runResumableUpload({ size, slice: (s, e) => blob(e - s), put, sleep: clock.sleep, now: clock.now,
      onEvent: (_k, d) => attempts.push(d.attempt) })).rejects.toMatchObject({ reason: "network" });
    expect(clock.elapsed()).toBeGreaterThanOrEqual(NETWORK_RETRY_MS);
    expect(clock.elapsed()).toBeLessThan(NETWORK_RETRY_MS + 60_000);
    expect(Math.max(...attempts)).toBeLessThanOrEqual(100); // 서버는 100 넘는 시도 횟수를 거절한다(마지막 실패·알림이 사라진다)
  });

  it("끊김이 지나간 뒤 서버 오류 한 번으로 끝나지 않는다 — 연결 실패와 서버 오류는 따로 센다", async () => {
    const clock = fakeClock();
    let busyOnce = true;
    const put = vi.fn(async (body: Blob | null): Promise<PutResult> => {
      if (clock.now() < 120_000) throw new Error("network");
      if (!body) return { status: 308, range: null };
      if (busyOnce) { busyOnce = false; return { status: 503, range: null }; }
      return { status: 200, range: null };
    });
    await expect(runResumableUpload({ size: 10, slice: (s, e) => blob(e - s), put, sleep: clock.sleep, now: clock.now })).resolves.toBeUndefined();
  });

  it("앱이 뒤로 가 10분 멈춰 있던 시간은 3분에 넣지 않는다 — 돌아온 뒤 첫 실패로 끝나지 않는다", async () => {
    let t = 0, calls = 0, slept = 0;
    const put = vi.fn(async (): Promise<PutResult> => { if (++calls < 10) throw new Error("network"); return { status: 200, range: null }; });
    // 일곱 번째 기다림 동안 앱이 뒤로 가 10분이 흐른다
    const sleep = async (ms: number) => { t += ++slept === 7 ? 10 * 60_000 : ms; };
    await expect(runResumableUpload({ size: 10, slice: (s, e) => blob(e - s), put, sleep, now: () => t })).resolves.toBeUndefined();
  });

  it("10분 시간 초과는 종전대로 5번 다시 시도한 뒤 멈춘다", async () => {
    const put = vi.fn(async (): Promise<PutResult> => { throw new Error("timeout"); });
    await expect(runResumableUpload({ size: 10, slice: (s, e) => blob(e - s), put, sleep: noSleep })).rejects.toMatchObject({ reason: "timeout" });
    expect(put.mock.calls.length).toBe(6);
  });

  it("시계가 안 가도(멈춘 탭) 연결 실패 다시 시도는 끝이 있다", async () => {
    const put = vi.fn(async (): Promise<PutResult> => { throw new Error("network"); });
    await expect(runResumableUpload({ size: 10, slice: (s, e) => blob(e - s), put, sleep: noSleep, now: () => 0 })).rejects.toBeInstanceOf(UploadError);
    expect(put.mock.calls.length).toBe(61); // 시계가 안 가도 60번 다시 시도한 뒤 끝난다
  });

  it("응답이 한 번 오면 끊김 시계는 처음부터 — 2분씩 두 번 끊겨도(합 4분) 각 끊김이 3분 안이면 끝까지 올린다", async () => {
    const clock = fakeClock();
    const size = CHUNK_BYTES * 2 + 10;
    let received = 0;
    let secondFrom: number | null = null; // 첫 조각을 받은 뒤 두 번째 끊김이 시작된다
    const put = vi.fn(async (_b: Blob | null, range: string): Promise<PutResult> => {
      if (clock.now() < 120_000 || (secondFrom !== null && clock.now() < secondFrom + 120_000)) throw new Error("network");
      if (range === `bytes */${size}`) return { status: 308, range: received ? `bytes=0-${received - 1}` : null };
      const end = Number(/-(\d+)\//.exec(range)![1]);
      received = end + 1;
      if (end === size - 1) return { status: 200, range: null };
      secondFrom ??= clock.now();
      return { status: 308, range: `bytes=0-${end}` };
    });
    await expect(runResumableUpload({ size, slice: (s, e) => blob(e - s), put, sleep: clock.sleep, now: clock.now })).resolves.toBeUndefined();
    expect(received).toBe(size);
    expect(clock.elapsed()).toBeGreaterThan(NETWORK_RETRY_MS); // 끊긴 시간의 합은 3분을 넘었다
  });

  it("같은 자리만 돌려주면 끝없이 돌지 않는다", async () => {
    const put = vi.fn(async (): Promise<PutResult> => ({ status: 308, range: "bytes=0-0" }));
    await expect(runResumableUpload({ size: CHUNK_BYTES * 3, slice: (s, e) => blob(e - s), put, sleep: noSleep })).rejects.toBeInstanceOf(UploadError);
    expect(put.mock.calls.length).toBeLessThan(30);
  });
});

describe("다시 시도 사이 기다림(wakeableSleep)", () => {
  it("인터넷이 다시 잡히거나 화면으로 돌아오면 바로 깨고, 깨면 듣던 것을 모두 거둔다", async () => {
    vi.useFakeTimers();
    try {
      const add = vi.spyOn(window, "addEventListener"), remove = vi.spyOn(window, "removeEventListener");
      let woke = false;
      const waiting = wakeableSleep(16_000).then(() => { woke = true; });
      window.dispatchEvent(new Event("online"));
      await waiting;
      expect(woke).toBe(true);
      expect(remove).toHaveBeenCalledWith("online", expect.any(Function));
      expect(add.mock.calls.filter(([type]) => type === "online")).toHaveLength(1);
      // 정해진 시간이 지나도 깬다
      let timed = false;
      const later = wakeableSleep(2_000).then(() => { timed = true; });
      await vi.advanceTimersByTimeAsync(2_000);
      await later;
      expect(timed).toBe(true);
      add.mockRestore(); remove.mockRestore();
    } finally { vi.useRealTimers(); }
  });
});
