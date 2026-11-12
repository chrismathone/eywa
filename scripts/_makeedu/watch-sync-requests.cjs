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
 * - **주간 자동 역동기화**(원장 2026-09-01): 매주 일요일 06:00(KST) 버킷이 열리면 QR 접수 상담을
 *   makeedu_push_requests에 적재한다(weekly-push.cjs) → 아래 푸시 단계가 같은 큐를 그대로 제출한다.
 *
 * 실행: node --env-file=.env.local scripts/_makeedu/watch-sync-requests.cjs
 * 등록: 작업 스케줄러 "eywa-makeedu-sync-watcher" (run-watch-requests.ps1, 로그온 트리거 + 상시 실행)
 * 로그: <repo>/.makeedu-tmp/watch-requests.log (MAKEEDU_OUT로 재정의 가능)
 */
const { spawnSync, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const postgres = require("postgres");
const L = require("./lib.cjs");
const { runWeeklyPushEnqueue, weeklyBucketOf } = require("./weekly-push.cjs");
const managedWorker = require("../_sync-agent/managed-worker.cjs");

const POLL_MS = 15_000;
const HERE = __dirname;
const REPO = path.resolve(HERE, "..", "..");
const LOG_DIR = process.env.MAKEEDU_OUT || path.join(REPO, ".makeedu-tmp");
const LOG = path.join(LOG_DIR, "watch-requests.log");
const HOSTNAME = os.hostname();
const STARTED_AT = new Date().toISOString(); // 이 워처 프로세스 시작 시각(재시작 감지)

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  if(managedWorker.managed)return; // The app captures and dates all worker output.
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

// 이 워처가 맡은 지점 — 시작 뒤 첫 사용 때 한 번 푼다(env MAKEEDU_TENANT_ID → 없으면 학원이 정확히 1개일 때만, lib.cjs).
// 🔴 **큐를 집는 모든 쿼리가 이 값으로 거른다**(원장 2026-09-21 "워커도 지점 분리" — 다른 지점은 makeedu를 아예 안 쓸 수 있다).
//    안 거르던 때: 둘째 지점이 누른 '지금 동기화'를 이 PC가 집어 **거짓 '완료'**를 찍고, 역동기화 요청은 그 지점 학생·보호자
//    연락처를 **이 지점 makeedu 계정에 제출**했다(감사 2026-09-21). 못 풀면 throw → 폴 루프가 로그만 남기고 아무것도 안 집는다(fail-closed).
let workerTenantId = null;
let tenantFailLoggedAt = 0;
async function tenantOfWorker() {
  if (workerTenantId) return workerTenantId;
  try {
    workerTenantId = await L.resolveTenantId(db());
  } catch (e) {
    // 🔴 이 상태에선 **아무 요청도 안 집는다** → 웹의 '지금 동기화'는 계속 '대기'로 보인다(단서가 이 로그뿐이라 눈에 띄게).
    //    흔한 원인 = 둘째 지점이 생겼는데 MAKEEDU_TENANT_ID를 안 넣음(docs/domain-cutover.md '지점을 하나 더 만드는 날' 0번).
    if (Date.now() - tenantFailLoggedAt > 10 * 60_000) {
      tenantFailLoggedAt = Date.now();
      log(`⛔ 이 워처의 지점을 정하지 못해 요청을 집지 않습니다 — .env.local의 MAKEEDU_TENANT_ID를 확인하세요: ${e.message}`);
    }
    throw e;
  }
  return workerTenantId;
}

// 이 지점의 pending 전부를 running으로 claim(요청 N개 = 동기화 1회). requested_by도 확보 → "누가 눌렀는지" 로그(0076a).
async function claimPending() {
  const tenantId = await tenantOfWorker();
  return db()`
    update makeedu_sync_requests
    set status = 'running', started_at = now()
    where status = 'pending' and tenant_id = ${tenantId}
    returning id, requested_by`;
}

async function finish(ids, ok, errMsg) {
  const idList = ids.map((r) => r.id);
  await db()`
    update makeedu_sync_requests
    set status = ${ok ? "done" : "error"}, finished_at = now(), error = ${ok ? null : errMsg}
    where id in ${db()(idList)}`;
}

// 스크립트를 동기(블로킹)로 완주 — 실행 중엔 폴링도 멈춰 중복 실행이 구조적으로 없음.
async function runScript(scriptRel, extraEnv) {
  if(managedWorker.managed) {
    return new Promise(resolve=>{
      let tail="",settled=false;
      const child=spawn(process.execPath,[path.join("scripts","_makeedu",scriptRel),"--apply"],{cwd:REPO,windowsHide:true,env:{...process.env,...extraEnv},stdio:["ignore","pipe","pipe"]});
      const collect=(stream,chunk)=>{stream.write(chunk);tail=(tail+chunk.toString('utf8')).slice(-8192);};
      child.stdout.on('data',chunk=>collect(process.stdout,chunk));child.stderr.on('data',chunk=>collect(process.stderr,chunk));
      const finish=ok=>{if(settled)return;settled=true;resolve({ok,tail:tail.split("\n").filter(Boolean).slice(-5).join(" | ").slice(0,500)});};
      child.once('error',()=>finish(false));child.once('close',code=>finish(code===0));
    });
  }
  const r = spawnSync(
    process.execPath,
    [...(managedWorker.managed ? [] : ["--env-file=.env.local"]), path.join("scripts", "_makeedu", scriptRel), "--apply"],
    { cwd: REPO, encoding: "utf8", windowsHide: true, env: { ...process.env, ...extraEnv } },
  );
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  try { fs.appendFileSync(LOG, out); } catch {}
  return { ok: r.status === 0, tail: out.split("\n").filter(Boolean).slice(-5).join(" | ").slice(0, 500) };
}

// 정방향 동기화(sync-all). 버튼과 동일 semantics: 수동 요청 = 토글 무시(MAKEEDU_FORCE). relay = 실행 로그 트리거 라벨.
// triggeredBy = 이번에 claim한 요청의 요청자 user id(여럿이면 첫 요청자) → sync-all이 실행 로그에 "누가"로 남김.
const runSync = (triggeredBy) =>
  runScript("sync-all.cjs", {
    MAKEEDU_FORCE: "true",
    MAKEEDU_TRIGGER: "relay",
    ...(triggeredBy ? { MAKEEDU_TRIGGERED_BY: triggeredBy } : {}),
  });
// 역동기화 푸시(push-consultations) — 큐의 pending 요청을 스크립트가 자체 claim해 makeedu에 제출.
const runPush = () => runScript("push-consultations.cjs", {});

// 역동기화 pending 푸시 요청이 있으면 push-consultations를 실행(스크립트가 pending을 claim). count만 보고 트리거.
async function pendingPushCount() {
  const tenantId = await tenantOfWorker();
  const [row] = await db()`
    select count(*)::int n from makeedu_push_requests where status = 'pending' and tenant_id = ${tenantId}`;
  return row ? row.n : 0;
}

// ───────── 주간 자동 역동기화 적재(원장 2026-09-01) ─────────
// 🔴 실제 dedup 정본은 DB(makeedu_push_batches 기본키 claim)다. 아래 두 변수는 **폴마다 나가는 쓰기를
//    줄이는 캐시**일 뿐이라, 프로세스를 재시작해도 DB가 같은 주를 두 번 밀지 않게 막는다.
let weeklyBucketDone = null;   // 이 프로세스가 처리를 마친 버킷(queued/empty/done)
let weeklyNoTableLogged = null; // 0238a 미적용 안내를 버킷당 한 번만 찍는다(15초마다 로그 폭탄 방지)

async function weeklyPush() {
  const bucket = weeklyBucketOf(new Date());
  if (weeklyBucketDone === bucket) return;
  let r;
  try {
    // 지점은 워처가 이미 풀어 뒀다(추가 쿼리 0 — tenantOfWorker). 아직이면 모듈이 스스로 푼다.
    r = await runWeeklyPushEnqueue(db(), { tenantId: workerTenantId || undefined });
  } catch (e) {
    log(`주간 자동 전송 적재 실패(다음 폴에서 재시도): ${e.message}`);
    return;
  }
  if (r.status === "no-table") {
    // 마이그레이션 0238a가 아직 안 들어왔다 — dedup을 못 하므로 **보내지 않는다**(fail-closed).
    // 버킷은 소모하지 않아, 적용되는 순간 그 주에 바로 따라잡는다.
    if (weeklyNoTableLogged !== bucket) {
      log(`주간 자동 전송 대기: 마이그레이션 0238a(makeedu_push_batches) 미적용 — 적용되면 자동 시작 (${bucket})`);
      weeklyNoTableLogged = bucket;
    }
    return;
  }
  weeklyBucketDone = bucket;
  if (r.status === "queued") {
    // 상한(WEEKLY_MAX_QUEUE)에 걸려 남은 건이 있으면 **반드시 적는다** — 안 적으면 "다 보냈다"로 읽힌다.
    log(
      `주간 자동 전송: ${r.queued}건 큐 적재 (${bucket})` +
        (r.deferred ? ` · ${r.deferred}건은 다음 배치로 미룸(상한)` : ""),
    );
  } else if (r.status === "empty") {
    log(`주간 자동 전송: 보낼 상담 없음 (${bucket})`);
  }
  // "done" = 다른 폴/다른 PC가 이미 이번 주를 처리 → 조용히 넘어간다.
}

// 심장박동(0073a) — 이 PC가 동기화 담당·살아있음을 매 폴마다 기록 → 웹 연동 면에서 온라인/오프라인 표시.
// best-effort: 실패해도 요청 처리를 막지 않는다. 테넌트는 시작 시 1회 해석(단일 테넌트 배포).
async function heartbeat() {
  const heartbeatTenantId = await tenantOfWorker();
  await db()`
    insert into makeedu_sync_workers (tenant_id, hostname, started_at, last_seen)
    values (${heartbeatTenantId}, ${HOSTNAME}, ${STARTED_AT}, now())
    on conflict (tenant_id, hostname) do update set last_seen = now(), started_at = excluded.started_at`;
}

(async () => {
  log(`워처 시작 — repo: ${REPO}, poll: ${POLL_MS / 1000}s`);
  // ⚠️ 심장박동은 폴 루프와 **분리된 타이머**로 돈다. 예전엔 같은 루프 안에 있어서, runSync가
  // spawnSync(블로킹, 실측 53~76초)로 도는 동안 last_seen이 멈췄고 온라인 판정(60초)을 넘겨
  // **동기화를 실행 중인 바로 그 PC가 화면에서 '오프라인'으로 뒤집혔다**(2026-07-30 적대 리뷰).
  // spawnSync가 이벤트 루프를 막으므로 setInterval도 그 사이엔 못 돈다 → 자식 실행 **직전에** 한 번 더 찍고,
  // 타이머는 유휴 구간을 메운다(둘 다 best-effort).
  const beat = () => heartbeat().catch((e) => log(`heartbeat 실패(무시): ${e.message}`));
  // 🔴 **20초를 유지한다**(2026-08-13 적대 리뷰에서 60초 변경을 되돌림). 이유: 동기화 자식 프로세스는
  //    `spawnSync`라 도는 동안 이 타이머가 **아예 못 돈다**. 60초 간격이면 긴 동기화 한 번에 마지막
  //    박동으로부터 150초(WORKER_ONLINE_MS)를 넘겨 **실제로 돌고 있는 PC가 '오프라인'으로 뒤집힌다**
  //    (2026-07-30에 이미 한 번 났던 사고). 아끼는 값은 59일 통틀어 317초뿐이라 바꿀 이유가 없다.
  const heartbeatTimer = setInterval(beat, 20_000);
  heartbeatTimer.unref?.();
  for (;;) {
    try {
      const control = managedWorker.managed ? await managedWorker.state("cycle") : { drain: false };
      if (control.drain) { await dropDb(); return; }
      if (!managedWorker.managed && await managedWorker.legacyCutover(db(), await tenantOfWorker())) {
        log("이 지점은 통합 연동 앱으로 전환되었습니다.");
        clearInterval(heartbeatTimer); await dropDb(); return;
      }
      // 0) 심장박동 — 담당 PC 생존 신호(웹 표시용). best-effort라 실패해도 요청 처리 계속.
      await beat();
      // 꺼진 동안에는 요청·예약·주간 적재·역동기화를 집지 않고, 다시 켜면 이어서 처리한다.
      if (!(await L.isMakeeduModuleEnabled(db(), await tenantOfWorker()))) {
        await managedWorker.activity(null);
        await new Promise((r) => setTimeout(r, POLL_MS));
        continue;
      }
      // 1) 정방향 동기화 요청.
      const claimed = await claimPending();
      if (claimed.length) {
        // 여럿이 동시에 눌러 합쳐졌으면 첫(가장 이른) 요청자를 대표로 로그에 남긴다.
        const requester = claimed.map((c) => c.requested_by).find(Boolean) || null;
        log(`동기화 요청 ${claimed.length}건 감지 → sync-all 실행`);
        await beat(); // 블로킹 실행 직전에 갱신 — 실행 중 '오프라인' 오표시 최소화
        await managedWorker.activity("syncNow"); // 연동 앱 표시: 업데이트가 기다리는 작업
        const { ok, tail } = await runSync(requester);
        managedWorker.result("syncNow",{ok});
        await finish(claimed, ok, ok ? null : tail || "sync-all 실패");
        log(ok ? "✅ 동기화 완료 (done)" : `✖ 동기화 실패 (error): ${tail}`);
      }
      if (managedWorker.managed && (await managedWorker.state("stage")).drain) continue;
      if (managedWorker.managed) {
        const { brokerCall } = require("../_sync-agent/remote-db.cjs");
        const { job } = await brokerCall("schedule", {});
        if (job) {
          await brokerCall("event", { kind: "job_started",detail:{task:job.kind} });
          const result = await runScript(job.kind === "login" ? "check-session.mjs" : "sync-all.cjs", { MAKEEDU_FORCE: "false", MAKEEDU_TRIGGER: "scheduled" });
          await brokerCall("schedule", { finish: { ...job, ok: result.ok } });
          await brokerCall("event", { kind: result.ok ? "job_succeeded" : "job_failed",detail:{task:job.kind} });
        }
      }
      // 2) 주간 자동 역동기화 적재 — 일요일 06:00(KST) 버킷이 열렸으면 큐에 넣는다(주 1회).
      //    제출은 새 경로가 아니라 바로 아래 3)이 그대로 한다.
      if (managedWorker.managed && (await managedWorker.state("stage")).drain) continue;
      await weeklyPush();
      // 3) 역동기화 푸시 요청(aywa→makeedu) — 스크립트가 pending을 claim·처리·마감.
      if (managedWorker.managed && (await managedWorker.state("stage")).drain) continue;
      if ((await pendingPushCount()) > 0) {
        log(`푸시 요청 감지 → push-consultations 실행`);
        await beat();
        await managedWorker.activity("push");
        const { ok, tail } = await runPush();
        managedWorker.result("push",{ok});
        log(ok ? "✅ 푸시 완료 (done)" : `✖ 푸시 실패/부분실패: ${tail}`);
      }
    } catch (e) {
      log(`폴링 오류(다음 폴에서 재시도): ${e.message}`);
      await dropDb();
    }
    await managedWorker.activity(null); // 쉬는 동안엔 '다음 주기 대기'(연동 앱 표시)
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
})();
