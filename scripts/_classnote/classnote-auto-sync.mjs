// scripts/_classnote/classnote-auto-sync.mjs — **반 보드 자동 동기화**(연동 PC 워커가 매 폴 부른다 — 실제 대조는 1분에 한 번).
//
// aywa에서 반 이름·학생 배정·담임이 바뀌면 버튼을 누르지 않아도 그 반만 ClassNote에 맞춘다(원장 2026-10-03).
// 이 파일이 하는 일은 **요청을 한 줄 넣는 것**뿐이다 — 실제 동기화는 바로 뒤의 `processSyncRequestOnce`가 버튼과 같은 길로 한다
// (바뀐 반만 · 상한 15개 · 보고서·감사로그 · 자동 해제 가드 전부 그대로). 판정·가드는 auto-sync-plan.mjs(순수), 조회는 auto-sync-load.mjs.
//
// - `--post` 임대 주인만 한다(dry-run PC는 요청을 집지 않는다 — 넣으면 아무도 안 집는 '대기 중'이 남는다).
// - 끄기 = 연동 PC `CLASSNOTE_BOARD_AUTO_SYNC=off` · 지켜보기만 = `observe`(무엇을 요청하려는지 로그에만 남긴다).
// - ClassNote 기능(모듈)이 꺼진 지점은 워커 루프가 이 단계까지 오지 않는다(watch-classnote-queue.mjs 0-a). 반 보드를 한 번도
//   연결하지 않은 지점은 여기서 아무것도 하지 않는다.
// - 표가 없으면(0302a·0313a 전) 10분 쉬고 다시 본다([[#95]]) — 🔴 '표 없음'(42P01)만 그렇게 본다. 칸·함수가 없다는 오류까지 묶으면
//   조회가 깨진 채 로그도 없이 영영 쉰다. 그 밖의 조회 실패는 그 회차만 건너뛰고 사유를 남긴다(다음 분에 다시).
// - 요청은 `on conflict do nothing`(지점당 살아 있는 요청 하나 — 부분 유니크, [[#113]]) — 그 사이 누가 눌렀으면 넣지 않고 다음에 다시 본다.
// - 간격·실패 판정은 **DB 시계**로 잰다(요청 표의 `now() - finished_at`) — 연동 PC 시계가 틀어져 있으면 5분 쉼이 0분이나 15분이 된다.
// - 신입 1인 보드 준비는 싣지 않는다(scope에 학생을 넣지 않는다) — 버튼과 새벽 정기 동기화만 한다.
import { loadAutoSyncInputs } from "./auto-sync-load.mjs";
import { AUTO_CHECK_MS, createAutoSyncState, detectAutoChanges, markAutoRequested, mergeTeacherChanges, planAutoSync, settleAutoRequest } from "./auto-sync-plan.mjs";

const MISSING_RECHECK_MS = 10 * 60_000;
/** 표가 없다(마이그레이션 전) — 42P01 또는 `relation "…" does not exist`만. 칸(42703)·함수(42883) 부재는 여기 넣지 않는다. */
export const isMissingTable = (e) => e?.code === "42P01" || /relation "[^"]+" does not exist/i.test(String(e?.message ?? ""));

/** 감사로그 머리 — 🔴 `action: "…"` 리터럴로 둔다(감사로그 레지스트리 가드가 scripts/의 직접 insert를 이 모양으로 스캔한다). */
const REQUEST_AUDIT = { action: "classnote_board_sync_request", actor_name: "system:classnote-auto-sync" };

/** 자동 동기화 모드 — "on"(기본) · "observe"(로그만) · "off". */
export function autoSyncMode(env = process.env) {
  const v = String(env.CLASSNOTE_BOARD_AUTO_SYNC ?? "").trim().toLowerCase();
  if (["off", "false", "0", "no"].includes(v)) return "off";
  if (v === "observe") return "observe";
  return "on";
}

/** 워커 하나의 기억(대조 시각·판정 상태). 테스트가 새로 만든다. */
export function createAutoSyncRunner() {
  return { state: createAutoSyncState(), lastCheckAt: 0, missingAt: 0, lastWhy: "", lastParked: 0 };
}

const defaultRunner = createAutoSyncRunner();

/**
 * 요청 표의 최근 행 → 판정 입력. 시각은 DB가 잰 경과(`age_ms`)에서 환산한다.
 * @param {Array<{id:string, status:string, auto:boolean|null, age_ms:number|string|null}>} rows  최신순
 */
export function readRequestRows(rows, now) {
  const hasLive = rows.some((r) => r.status === "pending" || r.status === "running");
  const finished = rows.filter((r) => (r.status === "done" || r.status === "failed") && r.age_ms != null && Number.isFinite(Number(r.age_ms)));
  const lastFinishedAt = finished.length ? now - Math.min(...finished.map((r) => Math.max(0, Number(r.age_ms)))) : null;
  // 가장 최근부터 잇달아 실패한 **자동** 요청 수 — 성공했거나 사람이 누른 요청을 만나면 끊는다.
  let failStreak = 0;
  for (const r of finished) {
    if (r.status === "failed" && r.auto === true) failStreak++;
    else break;
  }
  return { hasLive, lastFinishedAt, failStreak };
}

/**
 * 폴 1회 — 1분에 한 번만 실제로 대조한다. 요청을 넣었으면 `requested`에 반 수를 돌려준다(바로 뒤 폴 단계가 집어 실행한다).
 * @returns {Promise<{checked:boolean, changes?:number, requested?:number, why?:string}>}
 */
export async function autoSyncTick(sql, { tenant, post, log = console.log, now = Date.now(), runner = defaultRunner, env = process.env }) {
  const mode = autoSyncMode(env);
  if (!post || mode === "off") return { checked: false };
  if (now - runner.lastCheckAt < AUTO_CHECK_MS) return { checked: false };
  if (runner.missingAt && now - runner.missingAt < MISSING_RECHECK_MS) return { checked: false };
  runner.lastCheckAt = now;
  try {
    const input = await loadAutoSyncInputs(sql, tenant);
    runner.missingAt = 0;
    // 반 보드를 한 번도 연결하지 않은 지점 — 새벽 동기화와 같이 반 보드를 만들지 않는다(이 기능을 켠 적 없는 곳).
    if (!input.links.size) return { checked: true, changes: 0, why: "반 보드를 쓰지 않는 지점" };
    // 요청 표는 필요할 때만, 한 회차에 한 번만 읽는다 — 달라진 반도 없고 결과를 기다리는 자동 요청도 없으면 읽지 않는다
    // (평소엔 대조 한 번의 왕복으로 끝난다. 같은 상태로 멈춘 반이 남아 있는 동안은 이 표도 읽는다).
    let rows = null;
    const requestRows = async () =>
      (rows ??= await sql`select id, status, (scope->>'auto') = 'true' as auto, extract(epoch from (now() - finished_at)) * 1000 as age_ms
        from classnote_sync_requests where tenant_id = ${tenant} order by requested_at desc limit 8`);
    // 방금 넣은 자동 요청의 결과는 **대조보다 먼저** 확정한다 — 실패로 되돌린 담임 기준이 같은 회차의 대조에 바로 잡혀야
    // 그 담임 변경의 실패 횟수가 이어진다(나중에 확정하면 한 회차 동안 차이가 안 보여 기록이 지워진다).
    if (runner.state.last) {
      const mine = (await requestRows()).find((r) => r.id === runner.state.last.id);
      settleAutoRequest(runner.state, mine ? mine.status : null);
      if (mine?.status === "failed") log("[auto-sync] 직전 자동 동기화가 실패로 끝났습니다 — 간격을 두고 다시 시도합니다");
    }
    const changes = mergeTeacherChanges(runner.state, detectAutoChanges(input), input.classes, input.links);
    const req = changes.length ? readRequestRows(await requestRows(), now) : { hasLive: false, lastFinishedAt: null, failStreak: 0 };
    const plan = planAutoSync(runner.state, { now, changes, ...req });
    if (plan.parked !== runner.lastParked) {
      if (plan.parked > runner.lastParked) log(`[auto-sync] 같은 상태로는 더 시도하지 않는 반 ${plan.parked}개 — 상태가 바뀌거나 새벽 정기 동기화가 볼 때까지 둡니다`);
      runner.lastParked = plan.parked;
    }
    if (plan.action !== "request") {
      // 같은 이유를 매분 적지 않는다 — 이유가 바뀔 때만.
      const why = plan.action === "wait" ? plan.why : "";
      if (why && why !== runner.lastWhy) log(`[auto-sync] 달라진 반 ${runner.state.pending.size}개 — ${why}`);
      runner.lastWhy = why;
      return { checked: true, changes: changes.length, why: plan.why };
    }
    runner.lastWhy = "";
    const picked = plan.picked;
    const lines = picked.map((p) => `${p.className}(${p.reasons.join(", ")})`);
    if (mode === "observe") {
      log(`[auto-sync] (지켜보기) 요청했을 반 ${picked.length}개 — ${lines.join(" · ")}`);
      markAutoRequested(runner.state, picked, now); // 같은 줄을 매분 되풀이하지 않게
      return { checked: true, changes: changes.length, requested: 0, why: "지켜보기 모드" };
    }
    // 신입 1인 보드 준비는 싣지 않는다 — 반만 지목한다(`auto` 표식은 결과·보고서·감사로그에 '자동'으로 남기는 용도).
    const scope = { classIds: picked.map((p) => p.classId), auto: true };
    const ins = await sql`insert into classnote_sync_requests (tenant_id, scope) values (${tenant}, ${sql.json(scope)})
      on conflict do nothing returning id`;
    if (!ins.length) {
      log("[auto-sync] 그 사이 다른 동기화 요청이 들어와 이번엔 넣지 않았습니다(다음에 다시 봅니다)");
      return { checked: true, changes: changes.length, requested: 0, why: "다른 요청이 먼저 들어옴" };
    }
    markAutoRequested(runner.state, picked, now, ins[0].id);
    log(`[auto-sync] 달라진 반 ${picked.length}개 동기화 요청 — ${lines.join(" · ")}`);
    const metadata = { requestId: ins[0].id, auto: true, full: false, classCount: picked.length, studentCount: 0, source: "auto", classes: picked.map((p) => ({ name: p.className, reasons: p.reasons })) };
    await sql`insert into audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
      values (${tenant}, null, ${REQUEST_AUDIT.actor_name}, ${REQUEST_AUDIT.action}, ${"classnote_sync"},
        ${`반 보드 자동 동기화(반 ${picked.length})`}, ${sql.json(metadata)})`.catch(() => {});
    return { checked: true, changes: changes.length, requested: picked.length };
  } catch (e) {
    if (isMissingTable(e)) {
      if (!runner.missingAt) log("[auto-sync] 반 보드 표가 아직 없어 쉽니다(10분마다 다시 확인)");
      runner.missingAt = now;
      return { checked: false };
    }
    log(`[auto-sync] 대조 실패(다음에 다시): ${String(e?.message ?? e).slice(0, 160)}`);
    return { checked: true, why: "대조 실패" };
  }
}
