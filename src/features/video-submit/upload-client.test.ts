import { describe, expect, it, vi } from "vitest";
import { CHUNK_BYTES, nextOffsetFromRange, runResumableUpload, UploadError, type PutResult } from "./upload-client";

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

  it("세션이 사라지면(404) 바로 멈추고, 계속 실패하면 한도에서 멈춘다", async () => {
    await expect(runResumableUpload({ size: 10, slice: (s, e) => blob(e - s), put: async () => ({ status: 404, range: null }), sleep: noSleep }))
      .rejects.toMatchObject({ code: "session_gone" });
    const put = vi.fn(async () => { throw new Error("network"); });
    await expect(runResumableUpload({ size: 10, slice: (s, e) => blob(e - s), put, sleep: noSleep })).rejects.toBeInstanceOf(UploadError);
    expect(put.mock.calls.length).toBe(6);
  });

  it("같은 자리만 돌려주면 끝없이 돌지 않는다", async () => {
    const put = vi.fn(async (): Promise<PutResult> => ({ status: 308, range: "bytes=0-0" }));
    await expect(runResumableUpload({ size: CHUNK_BYTES * 3, slice: (s, e) => blob(e - s), put, sleep: noSleep })).rejects.toBeInstanceOf(UploadError);
    expect(put.mock.calls.length).toBeLessThan(30);
  });
});
