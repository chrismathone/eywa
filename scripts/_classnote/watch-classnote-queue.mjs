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
import { stateDirLabel, stateFile } from "./classnote-paths.mjs";
import { closeClassnoteAdminSession, launchBrowser, processQueueOnce, resolveTenant } from "./classnote-core.mjs";
import { processNoticesOnce } from "./classnote-notice-core.mjs";
import { provisionDailyOnce } from "./classnote-provision-core.mjs";
import { pollParentCommentsOnce, pollParentPostsOnce } from "./classnote-feed-core.mjs";
import { pollReportReadsOnce } from "./classnote-read-core.mjs";

const POLL_MS = 15_000;
const POST = process.argv.includes("--post");
// 로그 파일 — 폴더 결정은 classnote-paths(단일 진입점, 쓰기 테스트까지 통과한 폴더).
const LOG = stateFile("watch.log");
const HOSTNAME = os.hostname();
const STARTED_AT = new Date().toISOString(); // 이 데몬 프로세스 시작 시각(재시작 감지)

// 최근 경고/오류 몇 줄 — 하트비트에 실어 **eywa 화면에서 바로 본다**(연동 PC 파일을 열 수 없을 때의 생명줄).
// ⚠️ 로그 파일이 안 써지던 사고(2026-07-21) 재발 시에도 원인이 웹에 남게 하는 안전망.
const RECENT_MAX = 5;
const recentIssues = [];

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  if (/실패|오류|error|⚠/i.test(msg)) {
    recentIssues.push(line.slice(0, 300));
    if (recentIssues.length > RECENT_MAX) recentIssues.shift();
  }
  if (!LOG) return;
  try {
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
  // 코어가 폴 사이에 유지하는 로그인 세션도 함께 버린다 — 안 버리면 죽은 브라우저의 page를 계속 들고 있는다.
  await closeClassnoteAdminSession().catch(() => {});
  if (b) await b.close().catch(() => {});
}

// tenant는 연결당 1회 해석(단일 테넌트면 자동, 여럿이면 CLASSNOTE_TENANT_ID 필수 — 오발송 방지).
let tenantId = null;
async function getTenant() {
  if (!tenantId) tenantId = await resolveTenant(db());
  return tenantId;
}

// 폴러별 마지막 결과(0123a) — 하트비트에 동봉해 웹 큐 카드가 "읽음 12:30 · 매칭 3"처럼 표시.
// 이력이 아니라 **최신 상태만**(이력은 watch.log). 활동이 있었거나 오류일 때만 갱신(15초마다 at만 바뀌는 노이즈 방지).
// 값은 숫자 필드만 추려 담는다(문자열 원문은 파일 로그 몫 — DB엔 error 한 줄만).
const lastResults = {};
function noteResult(key, value) {
  const out = { at: new Date().toISOString() };
  for (const [k, v] of Object.entries(value ?? {})) {
    if (typeof v === "number") out[k] = v;
  }
  if (typeof value?.error === "string" && value.error) out.error = value.error.slice(0, 200);
  lastResults[key] = out;
}

// 심장박동(0084a) — 이 PC가 발송 담당·살아있음을 매 폴마다 기록. best-effort(실패해도 처리 계속).
async function heartbeat(tenant) {
  const s = db();
  // env 진단(logDir·recent)을 함께 실어 보낸다 — 연동 PC가 물리적으로 다른 컴퓨터라, 웹에서 못 보면
  // 원인 추적이 불가능해진다(2026-07-21 로그 미생성 사고에서 실제로 막혔다).
  const payload = { ...lastResults, env: { logDir: stateDirLabel(), recent: recentIssues.slice(-RECENT_MAX) } };
  await s`
    insert into classnote_workers (tenant_id, hostname, started_at, last_seen, last_results)
    values (${tenant}, ${HOSTNAME}, ${STARTED_AT}, now(), ${s.json(payload)})
    on conflict (tenant_id, hostname) do update
      set last_seen = now(), started_at = excluded.started_at, last_results = excluded.last_results`;
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
      if (s.claimed) {
        log(`처리 완료 — 성공 ${s.success} / 실패 ${s.failed} / 재큐 ${s.requeued} / stale복구 ${s.stale}`);
        noteResult("queue", s);
      }
      // 2) 반 공지 큐(classnote_notices) — 내부 API 게시(별 코어). 실패해도 보고서 큐와 독립.
      const nres = await processNoticesOnce(db(), b, { tenant, post: POST, log }).catch((e) => {
        log(`[notice] 처리 오류(다음 폴에서 재시도): ${e.message}`);
        noteResult("notice", { error: e.message });
        return { processed: 0 };
      });
      if (nres.processed) {
        log(`[notice] 공지 ${nres.processed}건 처리 완료`);
        noteResult("notice", nres);
      }
      // 3) 일일 프로비저닝(신규생 보드 생성 + 가입자 자동 배정) — KST 05시 이후 하루 1회(가드 내장).
      const pres = await provisionDailyOnce(db(), b, { tenant, post: POST, log }).catch((e) => {
        log(`[provision] 오류(내일 재시도): ${e.message}`);
        noteResult("provision", { error: e.message });
        return { ran: false };
      });
      if (pres.ran) {
        log(`[provision] 일일 프로비저닝 완료 — 보드 생성 ${pres.created} · 배정 ${pres.assigned}${pres.held ? ` · 보류 ${pres.held}` : ""}`);
        noteResult("provision", pres);
      }
      // 4) 학부모 새 글 감지(인바운드, 읽기 전용) → 담당 강사 eywa 알림. 1분 가드 내장이라 대부분 즉시 no-op.
      //    ClassNote에 아무것도 쓰지 않는다. 실패해도 발송 큐와 독립.
      const fres = await pollParentPostsOnce(db(), b, { tenant, post: POST, log }).catch((e) => {
        log(`[feed] 오류(다음 폴에서 재시도): ${e.message}`);
        noteResult("posts", { error: e.message });
        return { ran: false };
      });
      if (fres.ran) noteResult("posts", fres);
      // 5) 학부모 댓글 감지(인바운드, 읽기 전용) → 담당 강사 eywa 알림. 10분 가드 내장.
      //    ⚠️ 4)와 별 폴러인 이유 = 감지 방식이 다르다(글=워터마크 1페이지 / 댓글=감시 창 전체 재조회).
      //    실측상 학부모 연락의 다수가 댓글로 온다(댓글 12건/일 vs 새 글 4.2건/일). 실패해도 나머지와 독립.
      const cres = await pollParentCommentsOnce(db(), b, { tenant, post: POST, log }).catch((e) => {
        log(`[comment] 오류(다음 폴에서 재시도): ${e.message}`);
        noteResult("comments", { error: e.message });
        return { ran: false };
      });
      if (cres.ran) noteResult("comments", cres);
      // 6) 학부모 읽음 동기화(0122a, 읽기 전용 GET) → eywa lesson_reports.classnote_read_at.
      //    ⚠️ ClassNote에 아무것도 쓰지 않으므로 --post와 무관하게 돈다(읽음은 사실 데이터).
      //    30분 가드 내장. 읽음은 발송 뒤 며칠에 걸쳐 채워져 워터마크 없이 창(14일)을 매번 재조회한다.
      const rres = await pollReportReadsOnce(db(), b, { tenant, log }).catch((e) => {
        log(`[읽음] 오류(다음 폴에서 재시도): ${e.message}`);
        noteResult("reads", { error: e.message });
        return { ran: false };
      });
      if (rres.ran) noteResult("reads", rres);
    } catch (e) {
      log(`폴링 오류(다음 폴에서 재시도): ${e.message}`);
      await dropDb();
      await dropBrowser(); // 브라우저 상태도 의심 → 재launch
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
