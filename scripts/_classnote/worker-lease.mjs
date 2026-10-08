// Execution ownership must not depend on a display hostname or a writable file.
// Windows named pipes are held by the OS and released when a process dies.
import net from "node:net";
import { createHash } from "node:crypto";

export const LEASE_SECONDS = 180;
export const LEASE_REFRESH_MS = 30_000;

export function localWorkerLockAddress(scope, platform = process.platform) {
  if (typeof scope !== "string" || !scope.trim()) throw new Error("워커 실행 범위를 확인하지 못했습니다.");
  const key = createHash("sha256").update(scope).digest("hex");
  if (platform === "win32") return `\\\\.\\pipe\\eywa-worker-${key}`;
  if (platform === "linux") return `\0eywa-worker-${key}`;
  throw new Error("이 환경에서는 워커 실행 잠금을 지원하지 않습니다.");
}

export function createLocalWorkerLock(scope, { createServer = net.createServer, platform = process.platform } = {}) {
  let server = null;
  let pending = null;
  let lastError = null;
  return {
    get held() { return server?.listening === true; },
    get error() { return lastError; },
    acquire() {
      if (server?.listening) return Promise.resolve(true);
      if (pending) return pending;
      pending = new Promise((resolve) => {
        let candidate;
        const fail = (error) => {
          lastError = error?.code ?? "LOCK_UNAVAILABLE";
          if (server === candidate) server = null;
          candidate?.close(() => {});
          resolve(false);
        };
        try {
          candidate = createServer((socket) => socket.destroy());
          candidate.on("error", fail);
          candidate.once("close", () => { if (server === candidate) server = null; });
          candidate.once("listening", () => {
            server = candidate;
            lastError = null;
            candidate.unref();
            resolve(true);
          });
          candidate.listen({ path: localWorkerLockAddress(scope, platform), exclusive: true });
        } catch (error) { fail(error); }
      }).finally(() => { pending = null; });
      return pending;
    },
    async release() {
      if (pending) await pending;
      const current = server;
      server = null;
      if (current) await new Promise((resolve) => current.close(resolve));
    },
  };
}

// Compatibility observation only; an execution lease must also be acquired.
export function decideWorkerLease({ rows, instanceId }) {
  const live = (rows ?? []).filter((row) => row.post_mode === true && row.alive === true);
  if (!instanceId || live.length !== 1 || live[0].instance_id !== instanceId) return { owner: false, holder: null };
  return { owner: true, holder: live[0].hostname };
}
