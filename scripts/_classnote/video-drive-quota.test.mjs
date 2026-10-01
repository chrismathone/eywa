import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCompressionStats } from "./video-compress.mjs";
import { DEFAULT_MIN_FREE_BYTES, driveQuotaPaused, formatGB, resetDriveQuota, videoStorageStatus } from "./video-drive-quota.mjs";

const GB = 1024 ** 3;
const oauth = { kind: "oauth", accessToken: async () => "test-only" };
const quota = (freeGb, limitGb = 1024) => new Response(JSON.stringify({ storageQuota: { limit: String(limitGb * GB), usage: String((limitGb - freeGb) * GB) } }), { status: 200 });
function clock(start = Date.parse("2026-10-01T03:00:00Z")) { let t = start; return { now: () => t, add: (ms) => { t += ms; } }; }
beforeEach(() => { resetDriveQuota(); resetCompressionStats(); });

describe("Drive 남은 공간 감시", () => {
  it("남은 공간이 문턱(기본 20GB) 아래면 멈추고, 공간이 생기면 5분 안에 다시 연다", async () => {
    const c = clock(); const logs = [];
    const fetchImpl = vi.fn().mockResolvedValueOnce(quota(18.2)).mockResolvedValueOnce(quota(18)).mockResolvedValueOnce(quota(120));
    const ask = () => driveQuotaPaused(oauth, { log: (m) => logs.push(m), env: {}, now: c.now, fetchImpl });
    expect(await ask()).toBe(true);
    expect(logs[0]).toContain("18.2GB — 20.0GB 아래라 영상 업로드를 멈춥니다");
    c.add(4 * 60_000); expect(await ask()).toBe(true); // 5분 안에는 다시 묻지 않는다
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    c.add(2 * 60_000); expect(await ask()).toBe(true);
    c.add(5 * 60_000); expect(await ask()).toBe(false);
    expect(logs.at(-1)).toContain("120GB — 영상 업로드를 다시 시작합니다");
    expect(logs).toHaveLength(2); // 계속 멈춰 있는 동안 같은 말을 반복하지 않는다
    expect(fetchImpl.mock.calls[0][0]).toBe("https://www.googleapis.com/drive/v3/about?fields=storageQuota(limit,usage)");
  });

  it("여유가 넉넉하면 1시간에 한 번만 묻는다 · 문턱은 발송 PC 설정으로 바꿀 수 있다", async () => {
    const c = clock(); const fetchImpl = vi.fn().mockImplementation(async () => quota(900));
    const ask = (env = {}) => driveQuotaPaused(oauth, { log: () => {}, env, now: c.now, fetchImpl });
    expect(await ask()).toBe(false);
    c.add(59 * 60_000); await ask(); expect(fetchImpl).toHaveBeenCalledTimes(1);
    c.add(2 * 60_000); await ask(); expect(fetchImpl).toHaveBeenCalledTimes(2);
    resetDriveQuota();
    expect(await ask({ CLASSNOTE_VIDEO_DRIVE_MIN_FREE_GB: "1000" })).toBe(true);
    expect(DEFAULT_MIN_FREE_BYTES).toBe(20 * GB);
  });

  it("조회 실패는 직전 판정을 유지한다(처음이면 막지 않음) · 한 번만 알린다", async () => {
    const c = clock(); const logs = [];
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 500 })).mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(quota(10)).mockResolvedValueOnce(new Response("{}", { status: 503 }));
    const ask = () => driveQuotaPaused(oauth, { log: (m) => logs.push(m), env: {}, now: c.now, fetchImpl });
    expect(await ask()).toBe(false);
    c.add(5 * 60_000); expect(await ask()).toBe(false);
    expect(logs.filter((m) => m.includes("확인하지 못했습니다"))).toHaveLength(1);
    expect(videoStorageStatus({}).quotaError).toBe(true);
    c.add(5 * 60_000); expect(await ask()).toBe(true);
    c.add(5 * 60_000); expect(await ask()).toBe(true); // 멈춘 뒤 조회가 실패해도 풀지 않는다
  });

  it("무제한 계정(limit 없음)은 막지 않고, 서비스계정(공유 드라이브)은 묻지도 않는다", async () => {
    const unlimited = vi.fn().mockResolvedValue(new Response(JSON.stringify({ storageQuota: { usage: "123" } })));
    expect(await driveQuotaPaused(oauth, { log: () => {}, env: {}, fetchImpl: unlimited })).toBe(false);
    resetDriveQuota();
    const never = vi.fn();
    expect(await driveQuotaPaused({ kind: "service-account", accessToken: async () => "x" }, { fetchImpl: never })).toBe(false);
    expect(never).not.toHaveBeenCalled();
    expect(videoStorageStatus({})).toMatchObject({ sharedDrive: true, paused: false });
  });

  it("하트비트 값은 숫자·짧은 상태만(파일·학생 정보 없음)", async () => {
    await driveQuotaPaused(oauth, { log: () => {}, env: {}, now: () => Date.parse("2026-10-01T03:00:00Z"), fetchImpl: vi.fn().mockResolvedValue(quota(512)) });
    expect(videoStorageStatus({})).toEqual({ v: 1, checkedAt: "2026-10-01T03:00:00.000Z", freeBytes: 512 * GB, limitBytes: 1024 * GB,
      minFreeBytes: 20 * GB, paused: false, quotaError: false, sharedDrive: false, ffmpeg: null, compressed: 0, kept: 0, failed: 0, savedBytes: 0 });
    expect(formatGB(512 * GB)).toBe("512GB");
    expect(formatGB(18.25 * GB)).toBe("18.3GB");
  });
});
