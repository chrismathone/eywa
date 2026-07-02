/**
 * scripts/_makeedu/watch-sync-requests.cjs — 동기화 PC 상주 워처(릴레이).
 *
 * 프로덕션(Vercel) '지금 동기화' 버튼은 스크립트를 실행할 수 없어(서버리스 + makeedu 신뢰 IP 요구)
 * makeedu_sync_requests(0069a)에 pending 행만 남긴다. 이 워처가 15초 간격으로 폴링해 발견 즉시
 * sync-all.cjs --apply(MAKEEDU_FORCE)를 실행하고 done/error로 마감한다 → 웹 버튼이 어디서든 동작.
 *
 * - 연타/다중 요청: pending 전부를 한 번에 claim → 동기화 1회로 합침(additive·멱등이라 안전).
 * - PC가 꺼져 있던 동안 쌓인 pending도 켜지면 즉시 따라잡음.
 * - DB 연결 오류는 연결을 버리고 다음 폴에서 재시도(무한 상주 — 작업 스케줄러가 로그온 시 시작).
 *
 * 실행: node --env-file=.env.local scripts/_makeedu/watch-sync-requests.cjs
 * 등록: 작업 스케줄러 "eywa-makeedu-sync-watcher" (run-watch-requests.ps1, 로그온 트리거 + 상시 실행)
 * 로그: D:/tmp/makeedu/watch-requests.log
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");

const POLL_MS = 15_000;
const HERE = __dirname;
const REPO = path.resolve(HERE, "..", "..");
const LOG_DIR = process.env.MAKEEDU_OUT || "D:/tmp/makeedu";
const LOG = path.join(LOG_DIR, "watch-requests.log");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG, line + "\n");
  } catch {
    /* 로그 실패가 워처를 죽이면 안 됨 */
  }
}

// 연결은 재사용하되, 오류가 나면 버리고 다음 폴에서 새로 연결(장기 상주라 커넥션이 끊길 수 있음).
let sql = null;
function db() {
  if (!sql) sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  return sql;
}
async function dropDb() {
  const s = sql;
  sql = null;
  if (s) await s.end({ timeout: 1 }).catch(() => {});
}

// pending 전부를 running으로 claim(요청 N개 = 동기화 1회). returning으로 이번에 잡은 id만 확보.
async function claimPending() {
  return db()`
    update makeedu_sync_requests
    set status = 'running', started_at = now()
    where status = 'pending'
    returning id`;
}

async function finish(ids, ok, errMsg) {
  const idList = ids.map((r) => r.id);
  await db()`
    update makeedu_sync_requests
    set status = ${ok ? "done" : "error"}, finished_at = now(), error = ${ok ? null : errMsg}
    where id in ${db()(idList)}`;
}

// sync-all을 동기(블로킹)로 완주 — 실행 중엔 폴링도 멈춰 중복 실행이 구조적으로 없음.
function runSync() {
  const r = spawnSync(
    process.execPath,
    ["--env-file=.env.local", path.join("scripts", "_makeedu", "sync-all.cjs"), "--apply"],
    {
      cwd: REPO,
      encoding: "utf8",
      windowsHide: true,
      // 버튼과 동일 semantics: 수동 요청 = 토글 무시(MAKEEDU_FORCE). relay = 실행 로그 트리거 라벨.
      env: { ...process.env, MAKEEDU_FORCE: "true", MAKEEDU_TRIGGER: "relay" },
    },
  );
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  try {
    fs.appendFileSync(LOG, out);
  } catch {}
  return { ok: r.status === 0, tail: out.split("\n").filter(Boolean).slice(-5).join(" | ").slice(0, 500) };
}

(async () => {
  log(`워처 시작 — repo: ${REPO}, poll: ${POLL_MS / 1000}s`);
  for (;;) {
    try {
      const claimed = await claimPending();
      if (claimed.length) {
        log(`요청 ${claimed.length}건 감지 → sync-all 실행`);
        const { ok, tail } = runSync();
        await finish(claimed, ok, ok ? null : tail || "sync-all 실패");
        log(ok ? "✅ 동기화 완료 (done)" : `✖ 동기화 실패 (error): ${tail}`);
      }
    } catch (e) {
      log(`폴링 오류(다음 폴에서 재시도): ${e.message}`);
      await dropDb();
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
})();
