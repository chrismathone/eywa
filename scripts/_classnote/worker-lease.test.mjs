import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalWorkerLock, decideWorkerLease, localWorkerLockAddress } from "./worker-lease.mjs";
import { createExecutionLease } from "./worker-execution-lease.mjs";

// OS 잠금은 Windows(이름 있는 파이프)·Linux(추상 소켓)만 지원한다 — 그 밖의 OS에서는 일부러 잠금을 거절한다(worker-lease.mjs).
const OS_LOCK = process.platform === "win32" || process.platform === "linux";
const locks = [];
const leases = [];
const local = (scope = `test:${randomUUID()}`, options) => { const lock = createLocalWorkerLock(scope, options); locks.push(lock); return lock; };
const row = (generation = "1") => [{ generation, remaining_ms: 180_000 }];
function leaseFixture(options = {}) {
  const api = { claim: vi.fn(async () => row()), renew: vi.fn(async () => row()), release: vi.fn(async () => true) };
  const onLost = vi.fn();
  const lease = createExecutionLease(api, { onLost, ...options });
  leases.push(lease);
  return { api, lease, onLost };
}
afterEach(async () => {
  await Promise.all(locks.splice(0).map((lock) => lock.release()));
  await Promise.all(leases.splice(0).map((lease) => lease.release()));
  vi.useRealTimers();
});

describe("운영체제 단일 실행 잠금", () => {
  it.skipIf(!OS_LOCK)("24개 동시 시작 중 하나만 잠금을 갖는다", async () => {
    const scope = `race:${randomUUID()}`;
    const contenders = Array.from({ length: 24 }, () => local(scope));
    expect((await Promise.all(contenders.map((lock) => lock.acquire()))).filter(Boolean)).toHaveLength(1);
    expect(contenders.filter((lock) => lock.held)).toHaveLength(1);
  });
  it.skipIf(!OS_LOCK)("동일 소유자의 중복 호출은 유지하고 종료 후 다른 소유자가 이어받는다", async () => {
    const scope = `release:${randomUUID()}`, a = local(scope), b = local(scope);
    expect(await a.acquire()).toBe(true);
    expect(await a.acquire()).toBe(true);
    expect(await b.acquire()).toBe(false);
    await a.release();
    expect(await b.acquire()).toBe(true);
  });
  it("잠금 권한 오류를 실행 허용으로 처리하지 않는다", async () => {
    const lock = local("denied", { createServer: () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); } });
    expect(await lock.acquire()).toBe(false);
    expect(lock.held).toBe(false);
    expect(lock.error).toBe("EACCES");
  });
  it("범위 없음·지원하지 않는 OS를 무잠금 성공으로 처리하지 않는다", async () => {
    expect(await local("").acquire()).toBe(false);
    expect(await local("unsupported", { platform: "unsupported" }).acquire()).toBe(false);
    expect(() => localWorkerLockAddress("")).toThrow();
  });
  it.skipIf(!OS_LOCK)("서로 다른 지점은 독립적으로 실행한다", async () => {
    expect(await local().acquire()).toBe(true);
    expect(await local().acquire()).toBe(true);
  });
  it.skipIf(!OS_LOCK)("실제 자식 프로세스 강제 종료 후 잠금이 해제된다", async () => {
    const scope = `crash:${randomUUID()}`;
    const moduleUrl = pathToFileURL(path.resolve("scripts/_classnote/worker-lease.mjs")).href;
    const child = spawn(process.execPath, ["--input-type=module", "-e",
      `import {createLocalWorkerLock} from ${JSON.stringify(moduleUrl)}; const l=createLocalWorkerLock(${JSON.stringify(scope)}); console.log(await l.acquire() ? 'ready' : 'failed'); setInterval(()=>{},1000);`],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (data) => { stderr += data; });
    try {
      const [chunk] = await Promise.race([once(child.stdout, "data"), once(child, "exit").then(() => { throw new Error(`Fixture child exited: ${stderr}`); })]);
      expect(String(chunk).trim()).toBe("ready");
      const next = local(scope);
      expect(await next.acquire()).toBe(false);
      const exited = once(child, "exit"); child.kill(); await exited;
      expect(await next.acquire()).toBe(true);
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill(); }
  });
});

describe("heartbeat는 실행 승인이 아니다", () => {
  it("빈 상태나 같은 PC 이름으로 소유권을 얻을 수 없다", () => {
    expect(decideWorkerLease({ rows: [], instanceId: "a" }).owner).toBe(false);
    const rows = [{ hostname: "same", post_mode: true, alive: true }];
    expect(decideWorkerLease({ rows, me: "same", instanceId: "a" }).owner).toBe(false);
    expect(decideWorkerLease({ rows, me: "same", instanceId: "b" }).owner).toBe(false);
  });
});

describe("서버 실행 잠금 소실과 재개", () => {
  it("한 실행기의 동시 획득 요청은 하나의 DB 요청과 감시 타이머만 만든다", async () => {
    vi.useFakeTimers();
    const { api, lease } = leaseFixture();
    expect(await Promise.all(Array.from({ length: 24 }, () => lease.acquire()))).toEqual(Array(24).fill(true));
    expect(api.claim).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(2);
    await lease.release();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("획득 응답 대기 중 해제한 실행기는 늦은 승인으로 시작하지 않는다", async () => {
    const { api, lease } = leaseFixture();
    let reply;
    api.claim.mockImplementation(() => new Promise((resolve) => { reply = resolve; }));
    const pending = lease.acquire();
    await Promise.resolve();
    await lease.release();
    reply(row());
    expect(await pending).toBe(false);
    expect(lease.held).toBe(false);
  });
  it("DB가 승인을 반환하지 않으면 시작하지 않는다", async () => {
    const { api, lease } = leaseFixture(); api.claim.mockResolvedValue([]);
    expect(await lease.acquire()).toBe(false); expect(lease.held).toBe(false);
  });
  it("로컬 잠금이 없으면 DB 선점도 시도하지 않는다", async () => {
    const { api, lease } = leaseFixture({ localHeld: () => false });
    expect(await lease.acquire()).toBe(false); expect(api.claim).not.toHaveBeenCalled();
  });
  it("승인과 같은 세대 갱신 뒤 업무를 허용한다", async () => {
    const { api, lease, onLost } = leaseFixture();
    expect(await lease.acquire()).toBe(true); await lease.renew();
    expect(api.renew).toHaveBeenCalledWith("1"); expect(lease.held).toBe(true);
    expect(() => lease.assertHeld()).not.toThrow(); expect(onLost).not.toHaveBeenCalled();
  });
  it.each([{ reply: [] }, { reply: row("2") }, { reply: [{ generation: "1", remaining_ms: NaN }] }])("갱신 누락·세대 변경·비정상 응답은 영구 중단한다: $reply", async ({ reply }) => {
    const { api, lease, onLost } = leaseFixture(); await lease.acquire(); api.renew.mockResolvedValue(reply);
    await lease.renew(); expect(lease.held).toBe(false); expect(onLost).toHaveBeenCalledTimes(1);
    expect(await lease.acquire()).toBe(false); expect(() => lease.assertHeld()).toThrow();
    expect(onLost).toHaveBeenCalledTimes(1);
  });
  it("통신 실패 후 늦은 성공으로 잠금을 되살리지 않는다", async () => {
    vi.useFakeTimers();
    const { api, lease, onLost } = leaseFixture(); await lease.acquire();
    let reply; api.renew.mockImplementation(() => new Promise((resolve) => { reply = resolve; }));
    const renewal = lease.renew(); await vi.advanceTimersByTimeAsync(10_001); await renewal;
    expect(onLost).toHaveBeenCalledTimes(1); reply(row()); await Promise.resolve();
    expect(lease.held).toBe(false); expect(await lease.acquire()).toBe(false);
  });
  it("절전 뒤 만료한 실행은 새 업무와 갱신을 시작하지 못한다", async () => {
    let clock = 0;
    const { api, lease, onLost } = leaseFixture({ now: () => clock }); await lease.acquire();
    clock = 180_000; expect(() => lease.assertHeld()).toThrow();
    await lease.renew(); expect(api.renew).not.toHaveBeenCalled(); expect(onLost).toHaveBeenCalledTimes(1);
  });
  it("감시 타이머보다 먼저 온 갱신 응답도 이전 만료 시각 뒤에는 거절한다", async () => {
    let clock = 0;
    const { api, lease, onLost } = leaseFixture({ now: () => clock });
    await lease.acquire();
    clock = 169_000;
    api.renew.mockImplementation(async () => { clock = 175_000; return row(); });
    await lease.renew();
    expect(lease.held).toBe(false);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(await lease.acquire()).toBe(false);
  });
  it("네트워크 오류와 로컬 잠금 유실은 즉시 중단한다", async () => {
    const { api, lease, onLost } = leaseFixture(); await lease.acquire(); api.renew.mockRejectedValue(new Error("offline"));
    await lease.renew(); expect(onLost).toHaveBeenCalledTimes(1); expect(lease.held).toBe(false);
    let held = true;
    const next = leaseFixture({ localHeld: () => held }); await next.lease.acquire(); held = false;
    expect(() => next.lease.assertHeld()).toThrow(); expect(next.onLost).toHaveBeenCalledTimes(1);
  });
});
