/**
 * scripts/_makeedu/weekly-push.cjs — **주간 자동 역동기화 적재**(aywa→makeedu).
 *
 * 원장 2026-09-01: 등록상담 화면의 'makeedu 보내기' 수동 카드를 감추고 **매주 일요일 06:00(KST)**에
 * 자동으로 밀기로 했다(CLAUDE.md 결정 로그의 "역동기화 전면 자동 = 비권장"을 원장이 명시로 뒤집음).
 *
 * 🔴 **새 경로를 만들지 않는다.** 이 모듈이 하는 일은 "후보를 큐에 넣는 것" 하나뿐이고,
 *    후보 판정 = `lib.isPushableConsultation`(앱 push-eligibility.ts와 같은 규칙)
 *    큐            = `makeedu_push_requests`(0071a)
 *    실제 제출     = `push-consultations.cjs`(워처가 pending을 보고 실행 — makeedu 신뢰 IP 필요)
 *    멱등 표식     = `enrollment_consultations.makeedu_pushed_at`(성공 시 제출 스크립트가 찍는다)
 *
 * 🔑 **적재 지점은 여기 하나다.** 앱은 자동으로 큐에 넣지 않는다(수동 전송 버튼은 연동 면에 남아
 *    있지만 그건 사람이 누르는 길이다). 중복 방지 3중:
 *      ① 같은 주에 두 번 돌지 않는다 — `makeedu_push_batches` 기본키 claim(원자적).
 *      ② 이미 pending/running인 상담은 다시 넣지 않는다.
 *      ③ 이미 나간 건(`makeedu_pushed_at`)·makeedu에서 들어온 건(`makeedu_id`)은 후보가 아니다(왕복 금지).
 *
 * 단독 실행(점검용):
 *   node --env-file=.env.local scripts/_makeedu/weekly-push.cjs          # 이번 주 버킷 적재(claim 포함)
 *   node --env-file=.env.local scripts/_makeedu/weekly-push.cjs --dry    # 적재 없이 후보만 세어 본다
 * 평소에는 상주 워처(watch-sync-requests.cjs)가 매 폴마다 이 모듈을 호출한다.
 */
const L = require("./lib.cjs");

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 주간 배치 경계 — 일요일 06:00 KST(원장 지정). 이 시각을 넘긴 뒤 처음 도는 폴에서 적재한다. */
const WEEKLY_HOUR_KST = 6;
/**
 * 한 배치가 큐에 넣는 상한. 🔴 **첫 실행 대비 안전판**이다 — 자동 적재를 처음 켜는 주엔 그동안 쌓인
 * 미전송 건이 통째로 후보가 되는데, 제출은 makeedu 폼을 브라우저로 채우는 일이라 수백 건이 한 번에
 * 나가면 시간도 시간이지만 봇 탐지에 걸린다. 남은 건 다음 주(또는 연동 면 수동 전송)로 넘어간다.
 * 화면의 수동 전송 후보 목록도 같은 50건 상한이다(getUnpushedIntakeConsultations).
 */
const WEEKLY_MAX_QUEUE = 50;

const pad = (n) => String(n).padStart(2, "0");

/**
 * 그 시각이 속한 **주간 버킷 키** = 가장 최근 '일요일 06:00 KST' 경계의 날짜.
 *
 * 순수 함수(테스트: weekly-push.test.ts). 🔑 버킷은 **상태 전이**를 표현해야 한다(알림 이벤트 규약) —
 * "지금 시각"이나 "마지막 실행 시각"을 키로 쓰면 폴마다 키가 바뀌어 15초마다 다시 밀게 된다.
 * ⚠️ 경계 **이전**(예: 일요일 05:00)은 아직 지난 주 버킷이다. 그래서 06:00이 지나야 새 배치가 열린다.
 * ⚠️ 워처 PC가 일요일에 꺼져 있었으면 화요일에 켜져도 같은 버킷이라 **그때 따라잡는다**(주 1회 유지).
 */
function weeklyBucketOf(now = new Date()) {
  // KST 벽시계를 UTC 게터로 읽는다(서버 로캘·서머타임 무관 — 한국은 고정 +09:00).
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const sinceBoundary =
    kst.getUTCDay() * DAY_MS +
    kst.getUTCHours() * 3600_000 +
    kst.getUTCMinutes() * 60_000 +
    kst.getUTCSeconds() * 1000 +
    kst.getUTCMilliseconds() -
    WEEKLY_HOUR_KST * 3600_000;
  const back = sinceBoundary >= 0 ? sinceBoundary : sinceBoundary + 7 * DAY_MS;
  const boundary = new Date(kst.getTime() - back);
  return `weekly:${boundary.getUTCFullYear()}-${pad(boundary.getUTCMonth() + 1)}-${pad(boundary.getUTCDate())}`;
}

/**
 * 표가 아직 없다(마이그레이션 0238a 미적용) — postgres `42P01 undefined_table`.
 * ⚠️ 코드로만 판정한다. 메시지에 표 이름이 들어간 **다른** 오류(권한 등)까지 "미적용"으로 부르면
 *    진짜 원인이 로그에서 지워진다(원인을 단정하지 말 것).
 */
const isMissingTable = (e) => !!e && e.code === "42P01";

/**
 * 이번 주 배치를 claim한다. 이미 누가(=지난 폴이) 가져갔으면 null.
 * 🔴 claim을 **먼저** 한다 — 후보가 0건이어도 버킷은 소모돼야 한다(안 그러면 그 주 내내 15초마다
 *    전건을 다시 훑고, 주중에 들어온 새 QR 접수가 곧바로 나가 "주 1회"가 깨진다).
 */
async function claimBucket(sql, tenantId, bucket) {
  const rows = await sql`
    insert into makeedu_push_batches (tenant_id, bucket)
    values (${tenantId}, ${bucket})
    on conflict (tenant_id, bucket) do nothing
    returning bucket`;
  return rows.length ? bucket : null;
}

/** 아직 makeedu에 안 나간 QR 공개접수 상담 + 연결 학생의 makeedu 등록 여부(판정 재료). */
async function fetchCandidates(sql, tenantId) {
  const rows = await sql`
    select ec.id, ec.outcome, s.makeedu_id as student_makeedu_id
      from enrollment_consultations ec
      left join students s on s.id = ec.student_id
     where ec.tenant_id = ${tenantId}
       and ec.from_public_intake = true
       and ec.makeedu_id is null          -- makeedu에서 들어온 건은 되밀지 않는다(왕복 금지)
       and ec.makeedu_pushed_at is null   -- 이미 나간 건(멱등 표식)
     order by ec.created_at`;
  return rows.filter((r) => L.isPushableConsultation(r.outcome, r.student_makeedu_id));
}

/**
 * 주간 자동 적재 1회. 워처가 매 폴마다 부르지만 실제로 적재하는 건 주에 한 번뿐이다.
 * @returns {Promise<{status:string, bucket:string, queued?:number, candidates?:number, deferred?:number}>}
 *   status: "queued"(적재함) | "empty"(보낼 게 없어 버킷만 소모) | "done"(이미 이번 주에 돌았다)
 *         | "no-table"(0238a 미적용 — 건너뜀)
 */
async function runWeeklyPushEnqueue(sql, opts = {}) {
  const now = opts.now ? new Date(opts.now) : new Date();
  const bucket = weeklyBucketOf(now);
  const tenantId = opts.tenantId || (await L.resolveTenantId(sql));

  if (opts.dryRun) {
    const candidates = await fetchCandidates(sql, tenantId);
    return { status: "dry-run", bucket, candidates: candidates.length };
  }

  let claimed;
  try {
    claimed = await claimBucket(sql, tenantId, bucket);
  } catch (e) {
    // 🔴 fail-closed — dedup을 못 하면 아예 보내지 않는다(매 폴 재전송이 훨씬 나쁘다).
    if (isMissingTable(e)) return { status: "no-table", bucket };
    throw e;
  }
  if (!claimed) return { status: "done", bucket };

  try {
    const candidates = await fetchCandidates(sql, tenantId);
    if (candidates.length === 0) return { status: "empty", bucket, candidates: 0 };

    const ids = candidates.map((c) => c.id);
    // 이미 큐에 있는(pending/running) 상담은 제외 — 수동 전송과 겹쳐도 두 번 안 들어간다.
    const inflight = await sql`
      select consultation_id from makeedu_push_requests
       where consultation_id in ${sql(ids)} and status in ('pending','running')`;
    const busy = new Set(inflight.map((r) => r.consultation_id));
    const queueable = ids.filter((id) => !busy.has(id));
    if (queueable.length === 0) return { status: "empty", bucket, candidates: candidates.length };
    // 오래된 것부터(fetchCandidates가 created_at 오름차순) 상한만큼만 — 나머지는 다음 배치로.
    const toQueue = queueable.slice(0, WEEKLY_MAX_QUEUE);
    const deferred = queueable.length - toQueue.length;

    // requested_by = null → 화면·로그에서 "[자동 실행]"으로 읽힌다(수동 전송과 구분).
    await sql`
      insert into makeedu_push_requests ${sql(
        toQueue.map((cid) => ({ tenant_id: tenantId, consultation_id: cid })),
        "tenant_id",
        "consultation_id",
      )}`;
    await sql`
      update makeedu_push_batches set queued_count = ${toQueue.length}
       where tenant_id = ${tenantId} and bucket = ${bucket}`;
    return { status: "queued", bucket, queued: toQueue.length, candidates: candidates.length, deferred };
  } catch (e) {
    // 적재에 실패했으면 버킷을 되돌려 다음 폴에서 다시 시도한다(claim만 남고 아무것도 안 나가는 주 방지).
    await sql`delete from makeedu_push_batches where tenant_id = ${tenantId} and bucket = ${bucket}`.catch(
      () => {},
    );
    throw e;
  }
}

module.exports = { weeklyBucketOf, runWeeklyPushEnqueue, WEEKLY_HOUR_KST, WEEKLY_MAX_QUEUE };

// 단독 실행(점검용) — 워처가 require할 땐 이 블록이 돌지 않는다.
if (require.main === module) {
  const postgres = require("postgres");
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  runWeeklyPushEnqueue(sql, { dryRun: process.argv.includes("--dry") })
    .then((r) => {
      console.log(JSON.stringify(r));
    })
    .catch((e) => {
      console.error("ERR", e.message);
      process.exitCode = 1;
    })
    .finally(() => sql.end());
}
