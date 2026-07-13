/**
 * scripts/_classnote/watch-classnote-queue.mjs — ClassNote 발송 워커 상주 데몬(원장 PC).
 *
 * 강사가 원스크린 "ClassNote 발송"을 누르면 lesson_reports가 queued로만 쌓인다(Vercel은 Playwright+ClassNote
 * 로그인을 못 함 = 로컬 PC 필요). 이 데몬이 15초 간격으로 폴링해 queued를 잡아 /r 스크린샷→Cloud Run 게시까지
 * 자동 처리한다 → 강사는 대기 없이 발송, 실제 게시는 이 PC가 백그라운드로. makeedu watch-sync-requests 패턴 재사용.
 *
 * - 처리 코어는 classnote-core.mjs와 공용(one-shot과 동일 로직). tenant 격리·stale 복구·SKIP LOCKED·재시도 포함.
 * - DB 연결 오류는 연결을 버리고 다음 폴에서 재연결(무한 상주 — 작업 스케줄러가 로그온 시 시작·10분마다 부활).
 * - Playwright browser는 루프 밖 1회 launch·재사용, 오류 시 버리고 재launch.
 * - heartbeat(classnote_workers, 0084a): 이 PC가 발송 담당·살아있음을 매 폴 기록 → 웹에서 온라인/오프라인 표시.
 *
 * 실행: node --env-file=.env.local scripts/_classnote/watch-classnote-queue.mjs [--post]
 *   기본 dry-run(게시 안 함), 프로덕션은 --post. 등록: setup-classnote-pc.ps1(작업 스케줄러 "eywa-classnote-worker").
 * 로그: D:/tmp/classnote/watch.log (env CLASSNOTE_OUT).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import { launchBrowser, processQueueOnce, resolveTenant } from "./classnote-core.mjs";
import { processNoticesOnce } from "./classnote-notice-core.mjs";

const POLL_MS = 15_000;
const POST = process.argv.includes("--post");
const LOG_DIR = process.env.CLASSNOTE_OUT || "D:/tmp/classnote";
const LOG = path.join(LOG_DIR, "watch.log");
const HOSTNAME = os.hostname();
const STARTED_AT = new Date().toISOString(); // 이 데몬 프로세스 시작 시각(재시작 감지)

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG, line + "\n");
  } catch {
    /* 로그 실패가 데몬을 죽이면 안 됨 */
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
  tenantId = null; // 재연결 시 tenant 재해석
  if (s) await s.end({ timeout: 1 }).catch(() => {});
}

// Playwright browser도 재사용하되, 오류(크래시·context 누수) 시 버리고 다음 폴에서 재launch.
let browser = null;
async function getBrowser() {
  if (!browser) browser = await launchBrowser();
  return browser;
}
async function dropBrowser() {
  const b = browser;
  browser = null;
  if (b) await b.close().catch(() => {});
}

// tenant는 연결당 1회 해석(단일 테넌트면 자동, 여럿이면 CLASSNOTE_TENANT_ID 필수 — 오발송 방지).
let tenantId = null;
async function getTenant() {
  if (!tenantId) tenantId = await resolveTenant(db());
  return tenantId;
}

// 심장박동(0084a) — 이 PC가 발송 담당·살아있음을 매 폴마다 기록. best-effort(실패해도 처리 계속).
async function heartbeat(tenant) {
  await db()`
    insert into classnote_workers (tenant_id, hostname, started_at, last_seen)
    values (${tenant}, ${HOSTNAME}, ${STARTED_AT}, now())
    on conflict (tenant_id, hostname) do update set last_seen = now(), started_at = excluded.started_at`;
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL 없음"); process.exit(1); }
  if (POST && (!process.env.CLASSNOTE_UPLOAD_ID || !process.env.CLASSNOTE_UPLOAD_PW)) {
    console.error("--post엔 CLASSNOTE_UPLOAD_ID/PW env 필요"); process.exit(1);
  }
  log(`데몬 시작 — mode=${POST ? "POST(실게시)" : "DRY-RUN"} host=${HOSTNAME} poll=${POLL_MS / 1000}s`);
  for (;;) {
    try {
      const tenant = await getTenant();
      // 0) 심장박동 — best-effort라 실패해도 처리 계속.
      await heartbeat(tenant).catch((e) => log(`heartbeat 실패(무시): ${e.message}`));
      // 1) 큐 한 주기 처리(공용 코어).
      const b = await getBrowser();
      const s = await processQueueOnce(db(), b, { tenant, post: POST, log });
      if (s.claimed) log(`처리 완료 — 성공 ${s.success} / 실패 ${s.failed} / 재큐 ${s.requeued} / stale복구 ${s.stale}`);
      // 2) 반 공지 큐(classnote_notices) — 내부 API 게시(별 코어). 실패해도 보고서 큐와 독립.
      const nres = await processNoticesOnce(db(), b, { tenant, post: POST, log }).catch((e) => {
        log(`[notice] 처리 오류(다음 폴에서 재시도): ${e.message}`);
        return { processed: 0 };
      });
      if (nres.processed) log(`[notice] 공지 ${nres.processed}건 처리 완료`);
    } catch (e) {
      log(`폴링 오류(다음 폴에서 재시도): ${e.message}`);
      await dropDb();
      await dropBrowser(); // 브라우저 상태도 의심 → 재launch
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
