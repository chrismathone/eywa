import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDb, type FakeDb } from "./fake-db.test-util";
import { T } from "./test-fixture.test-util";
import { CONN, CONN_B } from "./account-fixture.test-util";
import { _resetVideoDriveQuotaForTest, defaultMinFreeBytes, videoDriveHasRoom, type QuotaTarget } from "./drive-quota";

const GB = 1024 ** 3;
const MB = 1024 ** 2;
type Db = Parameters<typeof videoDriveHasRoom>[0]["db"];
let db: FakeDb;
let quota: { limit?: number; usage: number } | null;
let request: ReturnType<typeof vi.fn<(url: string) => Promise<Response>>>;
const account: QuotaTarget = { tenantId: T, connectionId: CONN, tokenVersion: 1 };
const legacy: QuotaTarget = { tenantId: T, connectionId: null, tokenVersion: null };
const room = (target: QuotaTarget, bytes: number, now = 1_000_000) => videoDriveHasRoom({ db: db as unknown as Db, target, request, bytes, now });

beforeEach(() => {
  _resetVideoDriveQuotaForTest();
  db = createFakeDb({ classnote_workers: [] });
  quota = { limit: 15 * GB, usage: 5 * GB };
  request = vi.fn(async () => (quota
    ? new Response(JSON.stringify({ storageQuota: { ...(quota.limit === undefined ? {} : { limit: String(quota.limit) }), usage: String(quota.usage) } }))
    : new Response("", { status: 500 })));
});

describe("기본 문턱", () => {
  it("기존 연결은 20GB · 지점 계정은 min(1GB, 한도의 10%) · 한도 없는 계정은 0", () => {
    expect(defaultMinFreeBytes(null, 100 * GB)).toBe(20 * GB);
    expect(defaultMinFreeBytes(CONN, 15 * GB)).toBe(GB);
    expect(defaultMinFreeBytes(CONN, 5 * GB)).toBe(0.5 * GB);
    expect(defaultMinFreeBytes(CONN, null)).toBe(0);
  });
});

describe("올리기 시작 전 남은 공간 확인", () => {
  it("🔴 보통의 15GB 계정이 기존 20GB 문턱 때문에 늘 멈추지 않는다 — 남은 공간에서 이번 파일을 뺀 값이 1GB 아래일 때만 멈춘다", async () => {
    expect(await room(account, 500 * MB)).toBe(true); // 남은 10GB
    quota = { limit: 15 * GB, usage: 13.8 * GB }; // 남은 1.2GB
    _resetVideoDriveQuotaForTest();
    expect(await room(account, 100 * MB)).toBe(true); // 1.1GB 남는다
    expect(await room(account, 500 * MB, 1_030_000)).toBe(false); // 0.7GB — 문턱 아래
  });
  it("기존 연결은 20GB 문턱 그대로 · 한도 없는 계정(무제한)은 멈추지 않는다", async () => {
    quota = { limit: 100 * GB, usage: 85 * GB };
    expect(await room(legacy, 100 * MB)).toBe(false);
    quota = { usage: 900 * GB };
    _resetVideoDriveQuotaForTest();
    expect(await room(account, GB)).toBe(true);
  });
  it("여유가 넉넉하면 5분 동안 캐시로 답하고, 문턱 근처면 받기 전에 다시 읽는다", async () => {
    await room(account, 100 * MB, 1_000_000);
    await room(account, 100 * MB, 1_060_000);
    expect(request).toHaveBeenCalledTimes(1);
    await room(account, 100 * MB, 1_000_000 + 5 * 60_000 + 1);
    expect(request).toHaveBeenCalledTimes(2);
    quota = { limit: 15 * GB, usage: 13.5 * GB }; // 남은 1.5GB — 문턱(1GB)의 2배 안
    _resetVideoDriveQuotaForTest();
    await room(account, 100 * MB, 2_000_000);
    await room(account, 100 * MB, 2_060_000);
    expect(request).toHaveBeenCalledTimes(4); // 근처라 두 번 다 읽었다
  });
  it("계정마다 따로 센다 — 한 계정이 가득 차도 다른 계정·기존 연결은 받는다 · 다시 연결하면(토큰 번호) 새로 읽는다", async () => {
    quota = { limit: 15 * GB, usage: 14.9 * GB };
    expect(await room(account, 100 * MB)).toBe(false);
    quota = { limit: 200 * GB, usage: 10 * GB };
    expect(await room({ tenantId: T, connectionId: CONN_B, tokenVersion: 1 }, 100 * MB)).toBe(true);
    expect(await room(legacy, 100 * MB)).toBe(true);
    expect(await room({ ...account, tokenVersion: 2 }, 100 * MB)).toBe(true);
    expect(request).toHaveBeenCalledTimes(4);
  });
  it("용량 조회가 실패하면 직전 판정을 유지하고, 직전 판정이 없으면 받는다(조회 장애로 접수를 막지 않는다)", async () => {
    quota = null;
    expect(await room(account, 100 * MB)).toBe(true);
    quota = { limit: 15 * GB, usage: 14.9 * GB };
    expect(await room(account, 100 * MB, 2_000_000)).toBe(false);
    quota = null;
    expect(await room(account, 100 * MB, 2_000_000 + 6 * 60_000)).toBe(false);
  });
  it("같은 연결의 발송 PC가 하트비트에 적은 문턱이 있으면 그 값을 쓴다 — 다른 연결·오래된 하트비트의 값은 쓰지 않는다", async () => {
    const now = Date.parse("2026-10-04T12:00:00Z");
    const worker = (connectionId: string | null, minFreeBytes: number, seenAgoMs = 60_000) =>
      ({ tenant_id: T, last_seen: new Date(now - seenAgoMs).toISOString(), last_results: { videoArchive: { connectionId }, videoStorage: { minFreeBytes } } });
    quota = { limit: 15 * GB, usage: 10 * GB }; // 남은 5GB
    db.tables.classnote_workers = [worker(CONN_B, 8 * GB), worker(CONN, 6 * GB, 3_600_000)];
    expect(await room(account, 100 * MB, now)).toBe(true); // 기본 1GB
    _resetVideoDriveQuotaForTest();
    db.tables.classnote_workers = [worker(CONN, 6 * GB)];
    expect(await room(account, 100 * MB, now)).toBe(false); // PC가 정한 6GB
    _resetVideoDriveQuotaForTest();
    db.tables.classnote_workers = [{ tenant_id: T, last_seen: new Date(now - 60_000).toISOString(), last_results: { videoStorage: { minFreeBytes: 3 * GB } } }];
    quota = { limit: 100 * GB, usage: 96 * GB }; // 옛 PC 하트비트(연결 칸 없음) = 기존 연결의 문턱 3GB
    expect(await room(legacy, 100 * MB, now)).toBe(true);
  });
  it("🔴 PC가 지점 계정의 문턱을 0으로 정했으면 0 그대로다 — 남은 공간이 1GB 아래여도 들어갈 자리가 있는 파일은 받는다(기본 1GB로 바뀌지 않는다)", async () => {
    const now = Date.parse("2026-10-04T12:00:00Z");
    const heartbeat = (connectionId: string | null, minFreeBytes: unknown) =>
      ({ tenant_id: T, last_seen: new Date(now - 60_000).toISOString(), last_results: { videoArchive: { connectionId }, videoStorage: { minFreeBytes } } });
    quota = { limit: 15 * GB, usage: 14.5 * GB }; // 남은 0.5GB — 기본 문턱(1GB) 아래
    db.tables.classnote_workers = [heartbeat(CONN, 0)];
    expect(await room(account, 100 * MB, now)).toBe(true);
    // 문턱이 0이어도 남은 공간보다 큰 파일은 받지 않는다.
    expect(await room(account, 600 * MB, now + 30_000)).toBe(false);
    // 여러 PC가 같은 연결을 쓰면 가장 큰 값 — 0과 2GB가 함께 있으면 2GB.
    _resetVideoDriveQuotaForTest();
    db.tables.classnote_workers = [heartbeat(CONN, 0), heartbeat(CONN, 2 * GB)];
    expect(await room(account, 100 * MB, now)).toBe(false);
  });
  it("🔴 하트비트에 문턱이 없거나 숫자가 아니면 0으로 읽지 않는다 — 기본 1GB(기존 연결은 20GB)로 판정한다", async () => {
    const now = Date.parse("2026-10-04T12:00:00Z");
    quota = { limit: 15 * GB, usage: 14.5 * GB }; // 남은 0.5GB
    for (const missing of [null, undefined, "0", "", Number.NaN, -1, Number.POSITIVE_INFINITY, false, {}]) {
      _resetVideoDriveQuotaForTest();
      db.tables.classnote_workers = [{
        tenant_id: T, last_seen: new Date(now - 60_000).toISOString(),
        last_results: { videoArchive: { connectionId: CONN }, videoStorage: missing === undefined ? {} : { minFreeBytes: missing } },
      }];
      expect(await room(account, 100 * MB, now), String(missing)).toBe(false);
    }
    // 기존 연결은 PC도 0을 쓰지 않는다(0 이하는 20GB) — 하트비트의 0을 '문턱 없음'으로 받지 않는다.
    _resetVideoDriveQuotaForTest();
    quota = { limit: 100 * GB, usage: 90 * GB }; // 남은 10GB
    db.tables.classnote_workers = [{ tenant_id: T, last_seen: new Date(now - 60_000).toISOString(), last_results: { videoStorage: { minFreeBytes: 0 } } }];
    expect(await room(legacy, 100 * MB, now)).toBe(false);
  });
});
