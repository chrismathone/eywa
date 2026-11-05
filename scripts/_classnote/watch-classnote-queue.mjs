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
 * 로그: D:/tmp/classnote/watch.log (env CLASSNOTE_OUT). **watch.log = 항상 오늘 로그**이고,
 * 날짜가 바뀌면 그 파일이 watch-YYYY-MM-DD.log로 넘어간다(보관 30일, env CLASSNOTE_LOG_KEEP_DAYS).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { isWorkerIssueLine } from "./worker-issue-filter.mjs";
import { stateDirLabel, stateFile } from "./classnote-paths.mjs";
import { DEFAULT_KEEP_DAYS, DEFAULT_MAX_BYTES, archiveName, needsRotation, pruneList, uniqueArchiveName } from "./log-rotation.mjs";
import { LEASE_REFRESH_MS, LEASE_SECONDS, createLocalWorkerLock } from "./worker-lease.mjs";
import { createExecutionLease, workerLeaseApi } from "./worker-execution-lease.mjs";
import managedWorker from "../_sync-agent/managed-worker.cjs";
import { waitForVideoIdle, videoWorkerBusy } from "./video-worker.mjs";
import { kickLinkVideoCompress, stopLinkVideoCompress, waitForLinkCompressIdle } from "./video-link-compress.mjs";
import { kickVideoReviewExtract, stopVideoReviewExtract, waitForReviewExtractIdle } from "./video-review-extract.mjs";
import { waitForAttachmentIdle } from "./repair-attachment-messages.mjs";
import { BATCH, closeClassnoteAdminSession, isClassnoteModuleEnabled, launchBrowser, processQueueOnce, resolveTenant } from "./classnote-core.mjs";
import { processNoticesOnce } from "./classnote-notice-core.mjs";
import { processRecallsOnce } from "./classnote-recall-core.mjs";
import { processClassNoticesOnce } from "./classnote-class-notice-core.mjs";
import { classBoardSyncDueToday, syncMathClassBoardsDaily } from "./math-class-boards-sync.mjs";
import { syncChildMapOnce } from "./classnote-childmap-core.mjs";
import { pollParentCommentsOnce, pollParentPostsOnce } from "./classnote-feed-core.mjs";
import { kickVideoWorker } from "./video-worker.mjs";
import { loadWorkerVideoDriveSetting, videoArchiveHeartbeat } from "./video-drive-settings.mjs";
import { videoStorageKeyFor, videoStorageStatus } from "./video-drive-quota.mjs";
import { pollReportReadsOnce } from "./classnote-read-core.mjs";
import { snapshotBoardRosterOnce } from "./classnote-roster-core.mjs";
import { processSyncRequestOnce } from "./classnote-sync-request.mjs";
import { autoSyncMode, autoSyncTick } from "./classnote-auto-sync.mjs";
import { processParentRepliesOnce } from "./classnote-parent-reply-core.mjs";
import { processParentReactionsOnce } from "./classnote-parent-reaction-core.mjs";

const POLL_MS = 15_000;
const POST = process.argv.includes("--post");
// 로그 파일 — 폴더 결정은 classnote-paths(단일 진입점, 쓰기 테스트까지 통과한 폴더).
const LOG = stateFile("watch.log");
// 로그 회전(2026-07-29 원장 지적 "log txt가 너무 길어진다") — 규칙은 log-rotation.mjs(순수+Vitest).
// watch.log 이름은 **고정**한다: 연동 PC 안내문·문서가 전부 "로그는 watch.log"라고 지시하기 때문(이름이
// 매일 바뀌면 그 안내가 전부 거짓이 된다). 날짜가 바뀐 뒤 첫 기록에서 옛 내용을 날짜 파일로 넘긴다.
const LOG_KEEP_DAYS = Number(process.env.CLASSNOTE_LOG_KEEP_DAYS) || DEFAULT_KEEP_DAYS;
const LOG_MAX_BYTES = (Number(process.env.CLASSNOTE_LOG_MAX_MB) || 0) * 1024 * 1024 || DEFAULT_MAX_BYTES;
let lastRotateCheck = 0;
let pendingRotateNote = null; // 회전 사실은 **새 파일 첫 줄**에 남긴다(어디로 갔는지 추적 가능하게)
/** 반 보드 정기 동기화 직전 원아 연결 갱신(3-0)을 한 날짜(KST) — 하루 한 번만(정기 동기화가 실패해 차례가 계속 참이어도). */
let preSyncChildMapDay = "";

/** 필요하면 watch.log를 날짜/크기 기준으로 넘긴다. 실패해도 로깅은 계속(fail-open). */
function maybeRotateLog(nowMs) {
  if (!LOG) return;
  if (nowMs - lastRotateCheck < 60_000) return; // stat 남발 방지 — 1분 간격이면 자정 감지에 충분
  lastRotateCheck = nowMs;
  try {
    const st = fs.statSync(LOG);
    const r = needsRotation({ mtimeMs: st.mtimeMs, sizeBytes: st.size, nowMs, maxBytes: LOG_MAX_BYTES });
    if (!r.rotate) return;
    const dir = path.dirname(LOG);
    const name = uniqueArchiveName(archiveName({ ...r, nowMs }), (n) => fs.existsSync(path.join(dir, n)), nowMs);
    fs.renameSync(LOG, path.join(dir, name));
    pendingRotateNote = `[로그] 이전 로그를 ${name}로 넘겼습니다(${r.reason === "size" ? "크기 초과" : "날짜 변경"}).`;
    // 보관 기간 지난 것 정리 — 형식이 맞는 회전본만(다른 상태파일은 pruneList가 제외).
    for (const old of pruneList(fs.readdirSync(dir), { nowMs, keepDays: LOG_KEEP_DAYS })) {
      fs.unlinkSync(path.join(dir, old));
    }
  } catch {
    /* 파일 없음(첫 기동)·권한·잠금 — 회전 실패가 로깅을 막지 않는다 */
  }
}
const HOSTNAME = os.hostname();
const STARTED_AT = new Date().toISOString(); // 이 데몬 프로세스 시작 시각(재시작 감지)
const INSTANCE_ID = randomUUID(); // hostname is display-only; a new process gets a new identity

// 최근 경고/오류 몇 줄 — 하트비트에 실어 **aywa 화면에서 바로 본다**(연동 PC 파일을 열 수 없을 때의 생명줄).
// ⚠️ 로그 파일이 안 써지던 사고(2026-07-21) 재발 시에도 원인이 웹에 남게 하는 안전망.
const RECENT_MAX = 5;
const recentIssues = [];

/**
 * 이 워커 버전이 할 수 있는 일 — 하트비트에 실어 **앱이 발송 전에 확인**한다.
 *
 * 🔴 왜 필요한가: 앱은 Vercel로 즉시 배포되지만 이 워커는 **zip 물리 이관**이라 시차가 필연이다.
 * 그 사이 강사가 이미지 첨부 공지(교재요청서)를 보내면, 첨부를 모르는 구버전 워커가 **글자만 게시하고
 * `success`로 기록**한다 — 학부모는 요청서 없는 안내만 받고 강사는 정상 발송으로 본다(이미 게시돼
 * 재발송하면 중복 글). 앱이 이 플래그를 보고 미지원이면 발송을 막는다(개인화 태그 롤아웃 가드와 같은 패턴).
 * ⚠️ 새 기능이 워커·앱 양쪽을 함께 바꿔야 할 때마다 여기에 키를 추가할 것(구버전은 키가 없어 자동 차단).
 */
// nativePublish=이 워커가 Cloud Run 없이 자체 게시하는 버전인가(2026-07-29). 구버전엔 이 키가 없어
// **키 부재 = 구워커**로 판정할 수 있다 — zip 이관 여부를 원격에서 확인하는 유일한 신호다.
// ⚠️ **새 기능을 워커에 넣으면 여기 cap을 함께 올릴 것.** 연동 PC는 물리적으로 다른 컴퓨터라, 이 값이
// "지금 도는 코드가 그 기능을 아는가"를 웹에서 확인할 유일한 수단이다. 2026-08-06에 회수를 넣고 cap을
// 안 올린 탓에, 옛 프로세스가 그대로 돌고 있는데도(started_at 7일 전) 하트비트만 보고는 알 수 없었다.
// kageFailReasons=스샷 업로드 실패를 네 갈래(빈 캡처·첨부 칸 없음·kage 거부·무응답)로 갈라 담는 버전인가
// (2026-09-04). 이 키가 없으면 옛 워커라 실패 사유가 여전히 `스샷 kage 업로드 실패` 한 줄로만 남는다.
// mathClassRoute=수학 반 보드 경로(보고서 설정 '수학 발송 경로', 2026-09-29)를 아는 버전인가. 이 키가 없는 옛 워커는
// 설정을 반별로 바꿔도 **전부 1인 보드로** 보낸다 — 설정을 바꾸기 전에 이 키로 이관 여부를 확인할 것.
// syncRequests=지금 반 보드 동기화 요청(0313a)을 집는 버전인가(2026-09-30). 앱은 이 키가 있는 실게시 PC가 살아 있을 때만 요청을 받는다
// (옛 워커만 있으면 아무도 안 집는 '대기 중'이 생긴다).
// parentReply=학부모 글 답글(0317a) · parentReaction=학부모 글 공감(0319a)을 집는 버전인가. 앱은 그 키가 있을 때만 요청을 받는다.
// parentReplySettings=답글 모드를 **학원 설정**(끔·시험·전체)에서 읽는 버전인가(2026-10-01). 이 키가 없는 옛 판은 모드가 코드 상수(시험)라
// 설정을 '전체'로 바꿔도 실제 학부모 글의 요청을 전부 실패시킨다 — 앱은 이 키가 없으면 답글 요청을 받지 않는다.
// homeworkVideoTenantFolders=지점별 저장 폴더 설정을 읽는 버전인가. 이 키가 없는 워커는 env 폴더만 안다.
// 새 PC 번들 전에는 키 부재만으로 준비 안 됨으로 보면 안 된다(지금 도는 워커가 막힌다). 다른 루트 첫 각인은 DB 가드가 거절한다.
// homeworkVideoReportLink=보고서 글에 댓글로 올린 영상을 그 보고서의 숙제에 묶는 버전인가(2026-10-06, video-report-link.mjs).
// 앱은 이 키로 아무것도 막지 않는다 — 이 키가 없는 옛 워커가 올린 영상은 예전처럼 '가장 오래된 미확인 숙제부터' 센다(적용 확인용).
// homeworkVideoLinkCompress=`/v`로 학생이 올린 영상을 발송 PC가 사후 압축하는 버전인가(2026-10-16, video-link-compress.mjs). 적용 확인용.
// noticeEnglishRoom=영어 개별 공지·교재요청서를 그 영어 반의 **반 방**으로 1:1 보내는 버전인가(2026-11-04 · 1.0.15, notice-class-route.mjs
// `resolveNoticeEnglishTarget`). 앱은 이 키가 있을 때만 영어 대상에 반(`classId` + `subject: "english"`)을 싣는다 — 옛 워커는 그 대상을
// 수학 반 보드로 보고 실패시킨다(오발송은 아니다).
const WORKER_CAPS = { autoBoardSync: POST && autoSyncMode() === "on", classNoticeImages: true, noticeClassRoute: true, noticeEnglishRoom: true, noticeAttachments: true, nativePublish: true, reportAuthorClassPrefix: true, reportRecall: true, kageFailReasons: true, mathClassRoute: true, classWideNotice: true, classBoardSync: true, syncRequests: true, homeworkVideoArchive: true, homeworkVideoTenantFolders: true, homeworkVideoTenantAccounts: true, homeworkVideoReportLink: true, homeworkVideoLinkCompress: true, parentReply: true, parentReplySettings: true, parentReaction: true, attachmentMessageRepair: true };

// 로그 타임스탬프 = KST(UTC+9) 고정 오프셋 — 연동 PC의 시스템 로케일/타임존과 무관하게 "YYYY-MM-DD HH:MM:SS".
// watch.log이 UTC(…Z)로 찍혀 실제 시각과 9시간 어긋나 보이던 문제(2026-07-22 원장 제보). DB/하트비트는 ISO 유지(기계용).
function kstStamp(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}:${p(k.getUTCSeconds())}`;
}

function log(msg) {
  const line = `[${kstStamp()}] ${msg}`;
  console.log(line);
  // ⚠️ 단순히 /실패|오류/ 로 잡으면 **"실패 0"(정상 보고)** 이 5칸 중 2칸을 먹어 진짜 문제를 밀어낸다
  // (2026-07-21 실측). 0건 여부까지 보는 판정은 worker-issue-filter.mjs 단일 소스.
  if (isWorkerIssueLine(msg)) {
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
  if(managedWorker.managed) managedWorker.result(key,value);
}

// 심장박동(0084a) — 이 PC가 발송 담당·살아있음을 매 폴마다 기록. best-effort(실패해도 처리 계속).
async function heartbeat(tenant, driveSetting) {
  const s = db();
  // env 진단(logDir·recent)을 함께 실어 보낸다 — 연동 PC가 물리적으로 다른 컴퓨터라, 웹에서 못 보면
  // 원인 추적이 불가능해진다(2026-07-21 로그 미생성 사고에서 실제로 막혔다).
  const payload = {
    ...lastResults,
    caps: WORKER_CAPS, // 이 워커가 지원하는 기능(앱의 발송 전 롤아웃 가드가 읽는다)
    videoArchive: videoArchiveHeartbeat(driveSetting),
    videoStorage: videoStorageStatus(process.env, videoStorageKeyFor(driveSetting)), // 그 계정의 실제 문턱(앱 '영상 보관' 줄)
    postMode: POST, // 실게시 PC 표식 — 지점당 한 대 임대(worker-lease.mjs)가 이 값을 센다(dry-run PC는 주인이 안 된다)
    executionInstanceId: INSTANCE_ID,
    executionLeaseVersion: 1,
    env: {
      logDir: stateDirLabel(),
      recent: recentIssues.slice(-RECENT_MAX),
      // 게시 엔진 표기 — 2026-07-29 Cloud Run 분기 제거 후 경로는 하나뿐이라 상수다(env 무관).
      // ⚠️ 앱은 이 값을 읽지 않는다(extractWorkerEnv는 logDir·recent만 본다) — 이관 확인은 위 caps.nativePublish로.
      publishMode: "native",
    },
  };
  await s`
    insert into classnote_workers (tenant_id, hostname, started_at, last_seen, last_results)
    values (${tenant}, ${HOSTNAME}, ${STARTED_AT}, now(), ${s.json(payload)})
    on conflict (tenant_id, hostname) do update
      set last_seen = now(), started_at = excluded.started_at, last_results = excluded.last_results`;
}

let localLock = null;
let leaseTenant = null;
let executionLease = null;
let leaseSql = null;
function stopAfterLeaseLoss() {
  log("[중단] 실행 잠금을 확인하지 못해 워커를 종료합니다. 진행 결과를 확인한 뒤 다시 시작합니다.");
  // Exit the worker so background video/attachment tasks cannot keep writing after ownership loss.
  // Work already accepted by an external service is reconciled by the existing job handlers.
  process.exit(1);
}
/** 단계 경계 — 잠금 확인 + 종료 요청 확인. `task` = 이어서 할 일(TASK_LABELS 키) — 연동 앱이 업데이트가 기다리는 작업으로 보여 준다. */
async function assertExecutionLease(task) {
  if (!localLock?.held) stopAfterLeaseLoss();
  if (POST && !executionLease) stopAfterLeaseLoss();
  if (POST) executionLease.assertHeld();
  if(managedWorker.managed&&(await managedWorker.state("stage", task)).drain)throw Object.assign(new Error("작업 종료 요청"),{code:"AGENT_DRAIN"});
}
async function finishDraining(){
  stopLinkVideoCompress(); // 긴 인코딩(최대 60분)이 종료·업데이트를 붙잡지 않게 끊는다(시도로 세지 않는다)
  stopVideoReviewExtract(); // AI 메모용 소리·화면 추출도 끊는다(시도로 세지 않는다)
  // 마무리를 기다리는 일 — 영상 올리기가 돌고 있으면 그것(연동 앱 표시).
  await managedWorker.activity(videoWorkerBusy() ? "video" : null);
  await Promise.allSettled([waitForVideoIdle(),waitForAttachmentIdle(),waitForLinkCompressIdle(),waitForReviewExtractIdle()]);
  await dropBrowser();await dropDb();await executionLease?.release?.();
  await leaseSql?.end({timeout:1});await localLock?.release();
}
async function main() {
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL 없음"); process.exit(1); }
  if (POST && (!process.env.CLASSNOTE_UPLOAD_ID || !process.env.CLASSNOTE_UPLOAD_PW)) {
    console.error("--post엔 CLASSNOTE_UPLOAD_ID/PW env 필요"); process.exit(1);
  }
  log(`데몬 시작 — mode=${POST ? "POST(실게시)" : "DRY-RUN"} host=${HOSTNAME} poll=${POLL_MS / 1000}s`);
  if (POST) log(`반 보드 자동 동기화: ${{ on: "켜짐(달라진 반만, 1분마다 대조)", observe: "지켜보기(요청하지 않고 로그만)", off: "꺼짐" }[autoSyncMode()]}`);
  // 옛 스위치가 .env.local에 남아 있으면 **무시된다는 사실**을 로그로 남긴다(2026-07-29). 07-28 안내문이
  // "이 줄을 지우면 예전 방식으로 복귀"라고 적어 둔 탓에, 담당자가 지우고 '롤백했다'고 오인할 수 있다.
  if (process.env.CLASSNOTE_PUBLISH_MODE)
    log(`[안내] CLASSNOTE_PUBLISH_MODE=${process.env.CLASSNOTE_PUBLISH_MODE} 는 무시됩니다 — 게시 경로는 워커 내장 하나뿐(2026-07-29 폴백 제거).`);
  let moduleOffLogged = false; // 모듈 꺼짐 안내는 바뀔 때 한 번만
  let leaseHolderLogged = null; // "다른 PC가 담당" 안내는 바뀔 때 한 번만
  let driveSettingUnreadLogged = false; // 저장 폴더 조회 실패 안내는 풀릴 때까지 한 번만
  // 임대 유지 — 한 폴이 몇 분 걸려도(매일 동기화·밀린 배치) 하트비트가 끊기지 않게 폴과 따로 last_seen만 갱신한다.
  if (POST)
    setInterval(() => {
      if (!tenantId || !localLock?.held || !executionLease?.held) return;
      db()`update classnote_workers set last_seen = now() where tenant_id = ${tenantId} and hostname = ${HOSTNAME}
        and last_results->>'executionInstanceId' = ${INSTANCE_ID}`.catch(() => {});
    }, LEASE_REFRESH_MS).unref();
  let backlogFastPoll = false; // 직전 주기가 배치를 꽉 채워 성공했는가 = 밀린 큐 → 다음 주기 즉시 진행
  for (;;) {
    try {
      if (managedWorker.managed && (await managedWorker.state("cycle")).drain) {
        await finishDraining();
        return;
      }
      const tenant = await getTenant();
      if (!managedWorker.managed && await managedWorker.legacyCutover(db(), tenant)) {
        log("[중단] 이 지점은 통합 연동 앱으로 전환되었습니다.");
        process.exit(0);
        return;
      }
      if (leaseTenant && leaseTenant !== tenant) { stopAfterLeaseLoss(); return; }
      leaseTenant = tenant;
      localLock ??= createLocalWorkerLock(`classnote:${tenant}`);
      if (!(await localLock.acquire())) {
        if (leaseHolderLogged !== "local") log("[안내] 다른 워커가 실행 중이거나 실행 잠금을 사용할 수 없어 대기합니다.");
        leaseHolderLogged = "local";
        backlogFastPoll = false;
        await new Promise((r) => setTimeout(r, POLL_MS));
        continue;
      }
      if (POST) {
        // Older workers do not participate in the new atomic lease. Do not overwrite
        // their heartbeat before this check, especially when hostnames are identical.
        const [legacy] = await db()`select exists(select 1 from classnote_workers where tenant_id = ${tenant}
          and last_results->>'postMode' = 'true'
          and last_results->>'executionLeaseVersion' is distinct from '1'
          and (now() - last_seen) <= make_interval(secs => ${LEASE_SECONDS})) as active`;
        if (legacy?.active) {
          if (executionLease?.held) { stopAfterLeaseLoss(); return; }
          if (leaseHolderLogged !== "legacy") log("[안내] 이전 워커의 종료 확인을 기다립니다. 이전 발송 PC 작업을 먼저 중지하세요.");
          leaseHolderLogged = "legacy";
          backlogFastPoll = false;
          await new Promise((r) => setTimeout(r, POLL_MS));
          continue;
        }
        leaseSql ??= postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 10 });
        executionLease ??= createExecutionLease(workerLeaseApi(leaseSql, tenant, INSTANCE_ID), {
          localHeld: () => localLock?.held === true, onLost: stopAfterLeaseLoss,
        });
        if (!(await executionLease.acquire())) {
          if (leaseHolderLogged !== "server") log("[안내] 다른 PC가 작업을 맡고 있어 대기합니다.");
          leaseHolderLogged = "server";
          backlogFastPoll = false;
          await new Promise((r) => setTimeout(r, POLL_MS));
          continue;
        }
      }
      if (leaseHolderLogged) log("[안내] 실행 잠금을 확인했습니다. 작업을 이어갑니다.");
      leaseHolderLogged = null;
      await assertExecutionLease();
      // 이 폴의 영상 설정. 폴마다 다시 읽는다 — 프로세스 수명의 캐시는 해제 뒤에도 큐에 넣는다.
      let driveSetting = { enabled: false, rootId: null, source: "none" };
      try { driveSetting = await loadWorkerVideoDriveSetting(db(), tenant); }
      catch { driveSetting = { enabled: false, rootId: null, source: "unknown", error: true }; }
      // 0) 심장박동 — best-effort라 실패해도 처리 계속. 루트는 이번 폴의 실제 설정이다.
      await heartbeat(tenant, driveSetting).catch((e) => log(`상태 전송 실패: ${e.message}`));
      // 0-a) 이 학원에서 ClassNote 기능(모듈)이 꺼져 있으면 아무것도 하지 않는다(발송·공지·회수·동기화·피드·읽음 전부).
      //      원장 2026-09-30 "꺼지면 있었는지조차 모르게". 켜지면 다음 폴부터 그대로 이어서 처리한다(큐 보존).
      if (!(await isClassnoteModuleEnabled(db(), tenant))) {
        if (!moduleOffLogged) log("[안내] 이 학원의 ClassNote 기능이 꺼져 있어 쉽니다(큐 보존).");
        moduleOffLogged = true;
        backlogFastPoll = false;
        await new Promise((r) => setTimeout(r, POLL_MS));
        continue;
      }
      moduleOffLogged = false;
      // 1) 큐 한 주기 처리(공용 코어).
      const b = await getBrowser();
      await assertExecutionLease("queue");
      const s = await processQueueOnce(db(), b, { tenant, post: POST, log });
      if (s.claimed) {
        log(`처리 완료 — 성공 ${s.success} / 실패 ${s.failed} / 재큐 ${s.requeued} / stale복구 ${s.stale}`);
        noteResult("queue", s);
      }
      // 밀린 큐는 **쉬지 않고 이어서** 처리한다(2026-07-28 속도) — 한 배치(BATCH)를 꽉 채워 집어왔다는 건
      // 뒤에 더 남았다는 뜻이므로 폴 간격 15초를 건너뛴다. 발송 실적이 있을 때만(success>0) 적용해
      // 실패·보류가 반복되는 상황에서 15초 간격이 사라져 재시도 폭풍이 되는 것을 막는다.
      // ⚠️ 평상시(큐가 비었거나 배치 미달)는 그대로 15초 — 상시 부하는 늘지 않는다.
      // 아래 부가 폴러(공지·프로비저닝·피드·읽음 등)는 전부 자체 시간 가드가 있어 즉시 재호출돼도 no-op.
      backlogFastPoll = s.claimed >= BATCH && s.success > 0;
      // 2) 반 공지 큐(classnote_notices) — 내부 API 게시(별 코어). 실패해도 보고서 큐와 독립.
      await assertExecutionLease("notice");
      const nres = await processNoticesOnce(db(), b, { tenant, post: POST, log }).catch((e) => {
        log(`[notice] 처리 오류(다음 폴에서 재시도): ${e.message}`);
        noteResult("notice", { error: e.message });
        return { processed: 0 };
      });
      if (nres.processed) {
        log(`[notice] 공지 ${nres.processed}건 처리 완료`);
        noteResult("notice", nres);
      }
      // 2-a) 반 단체 공지 큐(classnote_class_notices, 0304a) — 반 보드에 공지 1건. 원생 개별 공지(위)와 별개.
      await assertExecutionLease("classNotice");
      const cnres = await processClassNoticesOnce(db(), b, { tenant, post: POST, log }).catch((e) => {
        log(`[class-notice] 처리 오류(다음 폴에서 재시도): ${e.message}`);
        noteResult("classNotice", { error: e.message });
        return { processed: 0 };
      });
      if (cnres.processed) noteResult("classNotice", cnres);
      // 2-b) 수업보고서 회수(recall_requested) — 학부모 게시글 삭제. 발송 큐와 독립(실패해도 발송은 계속).
      //      ⚠️ 발송 킬스위치엔 걸지 않는다(회수는 사고 수습이라 스위치를 내린 상황에서 가장 급하다).
      // ⚠️ 변수명은 `recallRes` — 아래 읽음 동기화가 이미 `rres`를 쓴다(같은 블록 스코프라 중복 선언 =
      //    **파일 전체 문법 오류**로 데몬이 아예 기동 못 한다. 2026-08-06 실측으로 걸렀다).
      await assertExecutionLease("recall");
      const recallRes = await processRecallsOnce(db(), b, { tenant, post: POST, log }).catch((e) => {
        log(`[recall] 처리 오류(다음 폴에서 재시도): ${e.message}`);
        noteResult("recall", { error: e.message });
        return { claimed: 0, recalled: 0, failed: 0 };
      });
      if (recallRes.claimed) {
        log(`[recall] 회수 ${recallRes.recalled}건 완료 · 실패 ${recallRes.failed}건`);
        noteResult("recall", recallRes);
      }
      // 2-c) 지금 반 보드 동기화 요청(0313a) — 앱 버튼. `--post` 임대 주인만 집고, **바뀐 반만**(상한 15개) 돈다.
      //      새벽 정기 동기화(아래 3·3-a)의 '오늘 함' 표식은 건드리지 않는다(한 폴 루프라 둘이 동시에 돌 수 없다).
      // 2-c-0) 반 보드 자동 동기화(2026-10-03) — 1분에 한 번 aywa DB만 보고, 지난 동기화 기록과 달라진 반이 있으면 **요청 한 줄**을 넣는다.
      //        바로 아래 2-c가 그 요청을 버튼과 같은 길로 집어 실행한다. 스스로 오류를 삼킨다(대조가 실패해도 발송은 계속).
      await assertExecutionLease("autoSync");
      const asres = await autoSyncTick(db(), { tenant, post: POST, log }).catch((e) => {
        log(`[auto-sync] 처리 오류(다음에 다시): ${e.message}`);
        return { checked: false };
      });
      if (asres.requested) noteResult("autoSync", { requested: asres.requested });
      await assertExecutionLease("syncNow");
      const snres = await processSyncRequestOnce(db(), b, { tenant, post: POST, host: HOSTNAME, log }).catch((e) => {
        log(`[sync-now] 처리 오류(다음 폴에서 재시도): ${e.message}`);
        noteResult("syncNow", { error: e.message });
        return { ran: false };
      });
      if (snres.ran) noteResult("syncNow", { ok: snres.ok ? 1 : 0 });
      // 2-d) 학부모 글·댓글 답글(0317a) — 앱에서 쓴 답글을 그 글에 댓글로 게시·수정·삭제. 한 폴에 한 건(드물다).
      //      발송 킬스위치·모듈을 따르고, 모드(학원 설정 '학부모 글 답글·공감' — 끔·시험·전체)는 코어가 폴마다 DB에서 다시 읽는다(끔이면 아무것도 안 집는다).
      await assertExecutionLease("parentReply");
      const rpres = await processParentRepliesOnce(db(), b, { tenant, post: POST, host: HOSTNAME, log }).catch((e) => {
        log(`[reply] 처리 오류(다음 폴에서 재시도): ${e.message}`);
        noteResult("parentReply", { error: e.message });
        return { ran: false };
      });
      if (rpres.ran) noteResult("parentReply", { ok: rpres.ok ? 1 : 0 });
      // 2-e) 학부모 글·댓글 공감(0319a) — 앱에서 누른 공감을 그 글·댓글에 누르거나 푼다. 답글과 같은 모드·가드·허가증. 한 폴에 한 건.
      await assertExecutionLease("parentReaction");
      const rxres = await processParentReactionsOnce(db(), b, { tenant, post: POST, host: HOSTNAME, log }).catch((e) => {
        log(`[reaction] 처리 오류(다음 폴에서 재시도): ${e.message}`);
        noteResult("parentReaction", { error: e.message });
        return { ran: false };
      });
      if (rxres.ran) noteResult("parentReaction", { ok: rxres.ok ? 1 : 0 });
      // 3) (없앰 · 1.0.14) 1인 보드 준비 — 원장 2026-11-04 *"앞으로 1인보드에 배정 시키지마 절대"*. `(수학)`·`(영어)` 1인 보드를
      //    만들지도, 원아를 배정하지도 않는다(옛 1인 보드 준비 모듈은 지웠다 · 가드 no-personal-board-writes.test.mjs).
      // 3-0) 원아 연결(0185a)을 반 보드 정기 동기화 **바로 앞에서** 한 번 새로 만든다(원장 2026-11-02 A안). 신입의 첫 반 보드 배정
      //      출처가 (수학) 1인 보드에서 원아 연결로 바뀌었다 — 아래 3.5의 20시간 주기만 믿으면 어제 가입한 학부모의 원아가 오늘 새벽
      //      배정을 놓쳐 첫 보고서가 하루 더 막힌다. 실패해도 동기화는 어제까지의 연결로 그대로 돈다(3.5와 같은 처리 · 3.5는 이 실행으로
      //      주기가 채워져 오늘 다시 돌지 않는다). 🔴 하루 한 번만(자기 표식) — 정기 동기화가 '오늘 함' 표식 전에 실패하면 차례가 계속
      //      참이라, 표식이 없으면 폴마다 ClassNote에 로그인한다.
      const childMapDueDay = classBoardSyncDueToday({ post: POST });
      if (childMapDueDay && childMapDueDay !== preSyncChildMapDay) {
        preSyncChildMapDay = childMapDueDay;
        await assertExecutionLease("childmap");
        const pre = await syncChildMapOnce(db(), b, { tenant, apply: true, log, force: true }).catch((e) => {
          log(`[원아매핑] 반 보드 동기화 전 갱신 오류(어제까지의 연결로 진행): ${e.message}`);
          noteResult("childmap", { error: e.message });
          return { ran: false };
        });
        if (pre.ran) noteResult("childmap", { ...pre, samples: undefined });
      }
      // 3-a) 수학 반 보드 매일 동기화(새 반·이름 변경·신입 배정·담임·0302a 기록) — KST 05시 이후 하루 1회, 반 보드를 쓰는 지점만.
      await assertExecutionLease("classBoardSync");
      const cbres = await syncMathClassBoardsDaily(db(), b, { tenant, post: POST, log }).catch((e) => {
        log(`[class-board] 동기화 중단(내일 재시도): ${e.message}`);
        noteResult("classBoardSync", { error: e.message });
        return { ran: false };
      });
      if (cbres.ran) noteResult("classBoardSync", { ...cbres, release: cbres.release?.length ?? 0 });
      // 3.5) 원아 ID 매핑(0184a, 읽기 전용 GET) — 학부모 연락에서 **그룹반(영어) 학생까지** 특정하려면 선행돼야 한다.
      //      KST 하루 1회 가드 내장. ⚠️ `--post`와 무관하게 돈다 — ClassNote에 쓰지 않고 aywa 한 컬럼만 채우는
      //      사실 데이터라(프로비저닝 스냅샷·읽음 동기화와 같은 취지), 발송이 꺼져 있어도 매핑은 최신이어야 한다.
      await assertExecutionLease("childmap");
      const mres = await syncChildMapOnce(db(), b, { tenant, apply: true, log }).catch((e) => {
        log(`[원아매핑] 오류(내일 재시도): ${e.message}`);
        noteResult("childmap", { error: e.message });
        return { ran: false };
      });
      if (mres.ran) noteResult("childmap", { ...mres, samples: undefined });
      // 4·5) 학부모 글·댓글. 저장 폴더 설정을 읽지 못한 폴은 이 둘만 건너뛴다.
      //    켜진 것으로 넘기면 큐는 건너뛰고 워터마크·댓글 수만 앞으로 간다. 꺼짐과 구분해서 아예 호출하지 않는다.
      if (driveSetting.error) {
        if (!driveSettingUnreadLogged) log("[영상] 저장 폴더 설정을 확인하지 못해 이번 학부모 글·댓글 수집은 건너뜁니다. 다음 주기에 다시 확인합니다.");
        driveSettingUnreadLogged = true;
      } else {
        driveSettingUnreadLogged = false;
        // 4) 학부모 새 글 감지(인바운드, 읽기 전용) → 담당 강사 aywa 알림. 1분 가드 내장이라 대부분 즉시 no-op.
        //    ClassNote에 아무것도 쓰지 않는다. 실패해도 발송 큐와 독립.
        await assertExecutionLease("posts");
        const fres = await pollParentPostsOnce(db(), b, { tenant, post: POST, log, archiveEnabled: driveSetting.enabled }).catch((e) => {
          log(`[feed] 오류(다음 폴에서 재시도): ${e.message}`);
          noteResult("posts", { error: e.message });
          return { ran: false };
        });
        if (fres.ran) noteResult("posts", fres);
        // 5) 학부모 댓글 감지(인바운드, 읽기 전용) → 담당 강사 aywa 알림. 10분 가드 내장.
        //    ⚠️ 4)와 별 폴러인 이유 = 감지 방식이 다르다(글=워터마크 1페이지 / 댓글=감시 창 전체 재조회).
        //    실측상 학부모 연락의 다수가 댓글로 온다(댓글 12건/일 vs 새 글 4.2건/일). 실패해도 나머지와 독립.
        await assertExecutionLease("comments");
        const cres = await pollParentCommentsOnce(db(), b, { tenant, post: POST, log, archiveEnabled: driveSetting.enabled }).catch((e) => {
          log(`[comment] 오류(다음 폴에서 재시도): ${e.message}`);
          noteResult("comments", { error: e.message });
          return { ran: false };
        });
        if (cres.ran) noteResult("comments", cres);
      }
      await assertExecutionLease("video");
      if (POST) kickVideoWorker(b, tenant, log, { setting: driveSetting });
      // `/v`로 학생이 올린 원본 영상 → 발송 PC가 압축해 같은 Drive 파일에 새 버전으로(원장 2026-10-16). 기다리지 않는다.
      if (POST) kickLinkVideoCompress(tenant, log, { setting: driveSetting, busy: videoWorkerBusy });
      // 영상 설명 AI 참고 메모(0390a) — 서버가 만든 추출 대기 줄의 소리·화면을 뽑아 올린다(원장 2026-10-20). 기다리지 않는다.
      if (POST) kickVideoReviewExtract(tenant, log, { setting: driveSetting, busy: videoWorkerBusy });
      // 6) 학부모 읽음 동기화(0122a, 읽기 전용 GET) → aywa lesson_reports.classnote_read_at.
      //    ⚠️ ClassNote에 아무것도 쓰지 않으므로 --post와 무관하게 돈다(읽음은 사실 데이터).
      //    30분 가드 내장. 읽음은 발송 뒤 며칠에 걸쳐 채워져 워터마크 없이 창(14일)을 매번 재조회한다.
      await assertExecutionLease("reads");
      const rres = await pollReportReadsOnce(db(), b, { tenant, log }).catch((e) => {
        log(`[읽음] 오류(다음 폴에서 재시도): ${e.message}`);
        noteResult("reads", { error: e.message });
        return { ran: false };
      });
      if (rres.ran) noteResult("reads", rres);
      // 7) 반 보드 구성 스냅샷(0142a, 읽기 전용 GET) — aywa 반 ↔ ClassNote 반 보드 대조용 원본.
      //    ⚠️ ClassNote에 아무것도 쓰지 않으므로 --post와 무관하게 돈다(구성은 사실 데이터).
      //    KST 05시 이후 하루 1회. 영어는 반 보드로 운영돼 학생 배정이 어긋나면 발송이 조용히 실패한다.
      await assertExecutionLease("roster");
      const bres = await snapshotBoardRosterOnce(db(), b, { tenant, log }).catch((e) => {
        log(`[roster] 오류(내일 재시도): ${e.message}`);
        noteResult("roster", { error: e.message });
        return { ran: false };
      });
      if (bres.ran) noteResult("roster", bres);
    } catch (e) {
      if(e.code==="AGENT_DRAIN"){await finishDraining();return;}
      log(`폴링 오류(다음 폴에서 재시도): ${e.message}`);
      await dropDb();
      await dropBrowser(); // 브라우저 상태도 의심 → 재launch
      backlogFastPoll = false; // 오류 뒤엔 반드시 쉬어간다(오류 폭주 방지)
    }
    if (!backlogFastPoll) await managedWorker.activity(null); // 쉬는 동안엔 '다음 주기 대기'(연동 앱 표시)
    if (!backlogFastPoll) await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
