import { afterEach, describe, expect, it, vi } from "vitest";
import { videoDriveAuth } from "./video-drive-auth.mjs";
import { workerVideoTargetMatches } from "./video-drive-settings.mjs";
import { credentialForVideoTarget, fetchTenantCredential, resetTenantDriveTokenCache } from "./video-drive-token.mjs";

vi.mock("./video-drive-auth.mjs", () => ({ videoDriveAuth: vi.fn(async () => ({ kind: "oauth", accessToken: async () => "local" })) }));

const TENANT = "11111111-1111-4111-8111-111111111111";
const CONNECTION = "33333333-3333-4333-8333-333333333333";
const ROOT = "rootFolder0001";
const env = { CLASSNOTE_SHARE_BASE: "https://video.example", CLASSNOTE_INTERNAL_SECRET: "secret" };
const body = (expiresIn, tokenVersion = 4) => ({ accessToken: "access-secret", expiresIn, connectionId: CONNECTION, tokenVersion });

afterEach(() => { resetTenantDriveTokenCache(); vi.clearAllMocks(); });

describe("지점 Drive 접근 토큰", () => {
  it("실제 남은 시간만 캐시하고, tokenVersion 이 바뀌면 다시 받는다", async () => {
    let now = 1_000;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json(body(120)))
      .mockResolvedValueOnce(Response.json(body(50, 5)));
    const first = await fetchTenantCredential({ tenantId: TENANT, rootId: ROOT, connectionId: CONNECTION, tokenVersion: 4 }, { env, fetchImpl, now: () => now, hostname: "pc-a" });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://video.example/api/internal/video-drive-token");
    expect(fetchImpl.mock.calls[0][1].headers["x-eywa-internal"]).toBe("secret");
    expect(fetchImpl.mock.calls[0][1].cache).toBe("no-store");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ tenantId: TENANT, rootId: ROOT, connectionId: CONNECTION, hostname: "pc-a" });
    expect(await first.accessToken()).toBe("access-secret");
    expect(first).toMatchObject({ kind: "tenant-oauth", connectionId: CONNECTION, tokenVersion: 4 });
    now += 119_000;
    await fetchTenantCredential({ tenantId: TENANT, rootId: ROOT, connectionId: CONNECTION, tokenVersion: 4 }, { env, fetchImpl, now: () => now });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now += 2_000;
    await fetchTenantCredential({ tenantId: TENANT, rootId: ROOT, connectionId: CONNECTION, tokenVersion: 5 }, { env, fetchImpl, now: () => now });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("응답의 expiresIn 은 3300초를 넘기지 않고, 만료되면 같은 연결로 다시 받는다", async () => {
    let now = 0;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json(body(9000)))
      .mockResolvedValueOnce(Response.json({ ...body(480), accessToken: "refreshed" }))
      .mockResolvedValueOnce(Response.json({ ...body(60), accessToken: "again" }));
    const cred = await fetchTenantCredential({ tenantId: TENANT, rootId: ROOT, connectionId: CONNECTION, tokenVersion: 4 }, { env, fetchImpl, now: () => now, hostname: "pc-a" });
    now = 3_299_000;
    await expect(cred.accessToken()).resolves.toBe("access-secret");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now = 3_300_000;
    await expect(cred.accessToken()).resolves.toBe("refreshed");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ tenantId: TENANT, rootId: ROOT, connectionId: CONNECTION, hostname: "pc-a" });
    now += 481_000;
    await expect(cred.accessToken()).resolves.toBe("again");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(videoDriveAuth).not.toHaveBeenCalled();
  });

  it("재연결로 tokenVersion 이 바뀌면 남은 토큰도 버리고 같은 연결로 다시 받는다", async () => {
    let now = 0;
    let version = 4;
    const sql = vi.fn(async () => [{ token_version: version }]);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({ ...body(120, 4), accessToken: "v4" }))
      .mockResolvedValueOnce(Response.json({ ...body(120, 5), accessToken: "v5" }));
    const cred = await fetchTenantCredential({ tenantId: TENANT, rootId: ROOT, connectionId: CONNECTION, tokenVersion: 4 }, { env, fetchImpl, now: () => now, sql, hostname: "pc-a" });
    expect(await cred.accessToken()).toBe("v4");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    version = 5;
    now = 10_000;
    expect(await cred.accessToken()).toBe("v5");
    expect(cred.tokenVersion).toBe(5);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ tenantId: TENANT, rootId: ROOT, connectionId: CONNECTION, hostname: "pc-a" });
    expect(videoDriveAuth).not.toHaveBeenCalled();
  });

  it("만료 갱신은 동시에 불러도 요청이 하나고, 잠시 실패하면 다음 호출에서 다시 받는다", async () => {
    let now = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const shared = vi.fn()
      .mockResolvedValueOnce(Response.json(body(1)))
      .mockImplementationOnce(() => gate.then(() => Response.json({ ...body(30), accessToken: "shared" })));
    const cred = await fetchTenantCredential({ tenantId: TENANT, rootId: ROOT, connectionId: CONNECTION, tokenVersion: 4 }, { env, fetchImpl: shared, now: () => now, hostname: "pc-a" });
    now = 1_000;
    const first = cred.accessToken();
    const second = cred.accessToken();
    await Promise.resolve();
    expect(shared).toHaveBeenCalledTimes(2);
    release();
    await expect(first).resolves.toBe("shared");
    await expect(second).resolves.toBe("shared");
    expect(shared).toHaveBeenCalledTimes(2);
    resetTenantDriveTokenCache();
    const retry = vi.fn()
      .mockResolvedValueOnce(Response.json(body(1)))
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ ...body(30), accessToken: "recovered" }));
    const again = await fetchTenantCredential({ tenantId: TENANT, rootId: ROOT, connectionId: CONNECTION, tokenVersion: 4 }, { env, fetchImpl: retry, now: () => now, hostname: "pc-a" });
    now = 2_000;
    await expect(again.accessToken()).rejects.toMatchObject({ code: "transient", message: "영상 저장 연결을 확인하지 못했습니다." });
    await expect(again.accessToken()).resolves.toBe("recovered");
    expect(retry).toHaveBeenCalledTimes(3);
    expect(videoDriveAuth).not.toHaveBeenCalled();
  });

  it("401·403·409·503 을 나누고 로컬 인증으로 돌아가지 않는다", async () => {
    const statuses = [[401, "unauthorized"], [403, "mismatch"], [409, "reauth"], [503, "transient"]];
    for (const [status, code] of statuses) {
      const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status }));
      await expect(fetchTenantCredential({ tenantId: TENANT, rootId: ROOT, connectionId: CONNECTION }, { env, fetchImpl })).rejects.toMatchObject({ code });
    }
    await expect(credentialForVideoTarget({ tenantId: TENANT, rootId: ROOT, connectionId: CONNECTION, schema: "complete" }, {
      env, fetchImpl: vi.fn().mockResolvedValue(new Response("{}", { status: 403 })),
    })).rejects.toMatchObject({ code: "mismatch" });
    expect(videoDriveAuth).not.toHaveBeenCalled();
  });

  it("완성 스키마의 연결 없는 루트는 소유가 확인된 뒤에만 기존 PC 인증을 쓴다", async () => {
    const fetchImpl = vi.fn();
    const sql = vi.fn(async () => [{ tenant_id: TENANT, connection_id: null }]);
    const legacy = await credentialForVideoTarget({ tenantId: TENANT, rootId: ROOT, connectionId: null, schema: "complete" }, { env, fetchImpl, sql });
    expect(legacy.kind).toBe("oauth");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(videoDriveAuth).toHaveBeenCalledTimes(1);
    const foreign = vi.fn(async () => [{ tenant_id: "22222222-2222-4222-8222-222222222222", connection_id: null }]);
    await expect(credentialForVideoTarget({ tenantId: TENANT, rootId: ROOT, connectionId: null, schema: "complete" }, { env, fetchImpl, sql: foreign }))
      .rejects.toMatchObject({ code: "mismatch" });
    expect(videoDriveAuth).toHaveBeenCalledTimes(1);
    const local = await credentialForVideoTarget({ tenantId: TENANT, rootId: ROOT, connectionId: null, schema: "folders" }, { env, fetchImpl });
    expect(local.kind).toBe("oauth");
    const absent = await credentialForVideoTarget({ tenantId: TENANT, rootId: ROOT, connectionId: null, schema: "absent" }, { env, fetchImpl });
    expect(absent.kind).toBe("oauth");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("연결이 있으면 저장된 tokenVersion 으로 받고, 연결 표가 없어도 기존 인증으로 가지 않는다", async () => {
    const sql = vi.fn(async () => [{ token_version: 7 }]);
    const fetchImpl = vi.fn().mockResolvedValue(Response.json(body(30, 7)));
    const cred = await credentialForVideoTarget({ tenantId: TENANT, rootId: ROOT, connectionId: CONNECTION, schema: "complete" }, { env, fetchImpl, sql });
    expect(cred.tokenVersion).toBe(7);
    expect(videoDriveAuth).not.toHaveBeenCalled();
    const missing = Object.assign(new Error('relation "homework_video_drive_connections" does not exist'), { code: "42P01" });
    const sqlMissing = vi.fn(async () => { throw missing; });
    await expect(credentialForVideoTarget({ tenantId: TENANT, rootId: ROOT, connectionId: CONNECTION, schema: "folders" }, {
      env, fetchImpl: vi.fn(), sql: sqlMissing,
    })).rejects.toMatchObject({ code: "transient" });
    expect(videoDriveAuth).not.toHaveBeenCalled();
  });

  it("토큰 응답이 멈추거나 주소가 새도 제한 시간 뒤 일시 오류이고 기존 인증으로 가지 않는다", async () => {
    const leak = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("https://video.example secret"), { name: "AbortError" })));
    }));
    const hung = fetchTenantCredential({ tenantId: TENANT, rootId: ROOT, connectionId: CONNECTION, tokenVersion: 4 }, { env, fetchImpl: leak, timeoutMs: 30 });
    await expect(hung).rejects.toMatchObject({ code: "transient", message: "영상 저장 연결을 확인하지 못했습니다." });
    await expect(hung).rejects.not.toThrow(/secret|video\.example/);
    const ignore = vi.fn(() => new Promise(() => {}));
    const started = Date.now();
    await expect(fetchTenantCredential({ tenantId: TENANT, rootId: ROOT, connectionId: CONNECTION, tokenVersion: 4 }, { env, fetchImpl: ignore, timeoutMs: 40 }))
      .rejects.toMatchObject({ code: "transient", message: "영상 저장 연결을 확인하지 못했습니다." });
    expect(Date.now() - started).toBeLessThan(1000);
    const hangBody = vi.fn(async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }));
    await expect(fetchTenantCredential({ tenantId: TENANT, rootId: ROOT, connectionId: CONNECTION, tokenVersion: 4 }, { env, fetchImpl: hangBody, timeoutMs: 30 }))
      .rejects.toMatchObject({ code: "transient" });
    const column = Object.assign(new Error('column "connection_id" does not exist'), { code: "42703" });
    const sql = (strings) => {
      const text = strings.join("?");
      if (text.includes("connection_id")) return Promise.reject(column);
      if (text.includes("homework_video_drive_roots")) return Promise.resolve([{ tenant_id: TENANT }]);
      return Promise.resolve([]);
    };
    const setting = { schema: "folders", enabled: true, rootId: ROOT, connectionId: null };
    expect(await workerVideoTargetMatches(sql, TENANT, { rootId: ROOT, connectionId: null }, setting, { env: {} })).toBe(true);
    const accountFetch = vi.fn(() => new Promise(() => {}));
    const local = await credentialForVideoTarget({ tenantId: TENANT, rootId: ROOT, connectionId: null, schema: "folders" }, { env, fetchImpl: accountFetch, sql, timeoutMs: 30 });
    expect(local.kind).toBe("oauth");
    expect(accountFetch).not.toHaveBeenCalled();
    await expect(credentialForVideoTarget({ tenantId: TENANT, rootId: ROOT, connectionId: CONNECTION, schema: "complete" }, {
      env, fetchImpl: accountFetch, timeoutMs: 30, sql: vi.fn(async () => [{ token_version: 4 }]),
    })).rejects.toMatchObject({ code: "transient", message: "영상 저장 연결을 확인하지 못했습니다." });
    expect(accountFetch).toHaveBeenCalledTimes(1);
    expect(videoDriveAuth).toHaveBeenCalledTimes(1);
  });
});
