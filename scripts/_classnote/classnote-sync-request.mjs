// scripts/_classnote/classnote-sync-request.mjs — **지금 반 보드 동기화** 요청 처리(0313a, 연동 PC 워커가 매 폴 부른다).
//
// 원장 2026-09-30 *"지금 반 보드 동기화 버튼을 만들자 … 중복 발동 방지"* · *"너무 과부하 일어나지 않게 필요한것만 동기화하게"*.
// 앱 버튼 → classnote_sync_requests 행(지점당 살아 있는 요청 하나 — 부분 유니크) → 이 워커가 집어 **바뀐 반만** 동기화한다.
//
// - 집기 = `update … where id = (select … for update skip locked) and status='pending'` — 워커 두 대가 동시에 봐도 한 대만 집는다
//   (실게시 워커는 임대로 지점당 한 대 — worker-lease.mjs, 이 판정은 그 위의 두 번째 자물쇠).
// - 🔴 `--post` 워커만 집는다 — dry-run PC가 집으면 "동기화했다"면서 아무것도 안 한 결과가 남는다(앱도 postMode PC가 있을 때만 받는다).
// - 🔴 새벽 정기 동기화의 '오늘 함' 표식을 건드리지 않는다 — 일부 반만 본 수동 실행이 새벽 전체 실행을 건너뛰게 하면 안 된다.
//   같은 폴 루프(단일 스레드)라 둘이 동시에 돌 수는 없다(한 폴 안에서 차례로).
// - 달라진 게 없으면 ClassNote에 로그인조차 하지 않는다(aywa DB만 본다 — sync-request-plan.mjs).
// - 상한: 반 15개 — 남은 건 결과에 적고 새벽(또는 다시 누름)이 한다.
// - 🔴 1인 보드는 만들지도, 원아를 배정하지도 않는다(원장 2026-11-04 *"앞으로 1인보드에 배정 시키지마 절대"* · 1.0.14에서 신입 1인 보드 준비를 뺐다).
// - 표가 없으면(0313a 적용 전) 조용히 쉰다([[#95]]).
import { loginClassnote } from "./classnote-admin-core.mjs";
import { syncChildMapOnce } from "./classnote-childmap-core.mjs";
import { loadAywa } from "./math-class-boards-load.mjs";
import { autoReleaseEnabled, releaseHaltReason, syncMathClassBoards } from "./math-class-boards-sync.mjs";
import { auditEnrollments, auditReleases, writeSyncRun } from "./class-board-sync-report.mjs";
import {
  PENDING_STALE_MIN,
  RECENT_DAYS,
  RESTARTED_MSG,
  RUNNING_STALE_MIN,
  STALE_PENDING_MSG,
  STALE_RUNNING_MSG,
  childLinkCandidates,
  childMapRefreshDue,
  normalizeScope,
  selectClassesToSync,
  summarizeSync,
  syncErrorLabel,
} from "./sync-request-plan.mjs";

// 표가 없으면(0313a 적용 전) 10분 동안 다시 묻지 않는다 — 영구 포기로 두면 SQL을 적용해도 워커를 재시작할 때까지 요청이
// 아무도 안 집는 '대기 중'으로 남는다(앱은 caps만 보고 받는다).
const MISSING_RECHECK_MS = 10 * 60_000;
let tableMissingAt = 0;
let restartSwept = false;
/** 지금 동기화 앞에서 원아 연결을 마지막으로 새로 만든 시각(ms) — `childMapRefreshDue`가 10분 간격을 본다. */
let lastChildMapRefreshAt = 0;

const isMissing = (e) => e?.code === "42P01" || /classnote_sync_requests.*does not exist/i.test(String(e?.message ?? ""));

/** 멈춘 요청 정리 + (프로세스 첫 폴에) 이 PC가 들고 있던 실행 중 요청 정리. */
async function sweep(sql, tenant, host) {
  const timedOut = sql.json({ timedOut: true });
  await sql`update classnote_sync_requests set status = 'failed', finished_at = now(), error = ${STALE_PENDING_MSG}, result = ${timedOut}
    where tenant_id = ${tenant} and status = 'pending' and requested_at < now() - make_interval(secs => ${PENDING_STALE_MIN * 60})`;
  await sql`update classnote_sync_requests set status = 'failed', finished_at = now(), error = ${STALE_RUNNING_MSG}, result = ${timedOut}
    where tenant_id = ${tenant} and status = 'running' and coalesce(started_at, requested_at) < now() - make_interval(secs => ${RUNNING_STALE_MIN * 60})`;
  if (!restartSwept) {
    // 이 PC가 실행 중에 죽었다(재시작) — 그 요청은 끝나지 않는다. 한 폴 루프라 지금 이 PC에서 도는 실행은 없다.
    await sql`update classnote_sync_requests set status = 'failed', finished_at = now(), error = ${RESTARTED_MSG}, result = ${timedOut}
      where tenant_id = ${tenant} and status = 'running' and worker_id = ${host}`;
    restartSwept = true;
  }
}

/** 대기 중 요청 하나를 집는다(원자적). 없으면 null. */
async function claim(sql, tenant, host) {
  const [row] = await sql`
    update classnote_sync_requests set status = 'running', started_at = now(), worker_id = ${host}
    where id = (
      select id from classnote_sync_requests
      where tenant_id = ${tenant} and status = 'pending'
      order by requested_at limit 1
      for update skip locked
    ) and status = 'pending'
    returning id, scope, requested_at`;
  return row ?? null;
}

/**
 * 바뀐 반만 동기화 — ClassNote 쓰기는 새벽 동기화와 같은 코드·같은 가드(class-board-plan.mjs · math-class-boards-apply.mjs)를
 * 탄다. 여기서 새로 하는 일은 **대상 고르기**뿐이다.
 * `events`·`applied` = 동기화 보고서(0329a)용 빈 배열 — 이 회차의 변동·실패·보류 줄과 반별 실행 결과가 담긴다(멈춰도 남는다).
 */
export async function runScopedSync(sql, browser, { tenant, scope: rawScope, log = console.log, events = [], applied = [], released = { children: [], teachers: [] } }) {
  const scope = normalizeScope(rawScope);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const [aywa, linkRows, members, recentRows, childLinks] = await Promise.all([
    loadAywa(sql, tenant),
    sql`select class_id, board_name from classnote_class_boards where tenant_id = ${tenant}`,
    sql`select class_id, student_id, status, reason from classnote_class_board_members where tenant_id = ${tenant}`,
    sql`select distinct e.student_id from enrollments e join students s on s.id = e.student_id
      where e.tenant_id = ${tenant} and s.status = 'enrolled' and not coalesce(s.is_test, false)
        and (e.end_date is null or e.end_date >= ${today})
        and (e.start_date >= (${today}::date - ${RECENT_DAYS}::int) or e.created_at >= now() - make_interval(secs => ${RECENT_DAYS * 86400}))`,
    sql`select distinct student_id from classnote_child_links where tenant_id = ${tenant}`,
  ]);
  // 반 보드를 한 번도 연결하지 않은 지점 — 새벽 동기화와 같이 반 보드는 만들지 않는다(이 기능을 켠 적 없는 곳).
  const links = new Map(linkRows.map((r) => [r.class_id, { boardName: r.board_name }]));
  const recent = new Set(recentRows.map((r) => r.student_id));
  const { picked, remaining } = links.size
    ? selectClassesToSync({ classes: aywa.classes, links, members, recentStudentIds: recent, scope })
    : { picked: [], remaining: 0 };
  // 지목한 학생은 지점 학생만(다른 지점 id가 섞여 와도 무시 — 대상 반 목록이 이미 이 지점 것뿐).
  const tenantStudents = new Set(aywa.students.keys());
  const candidateIds = childLinkCandidates({
    recentStudentIds: recent,
    childLinkedStudentIds: new Set(childLinks.map((r) => r.student_id)),
    scope: { ...scope, studentIds: scope.studentIds.filter((s) => tenantStudents.has(s)) },
  });

  if (!picked.length && !candidateIds.length) {
    log("[sync-now] 바뀐 반 없음 — ClassNote는 건드리지 않음");
    return { noChange: true, classes: 0, enrolled: 0, summary: summarizeSync({ noChange: true }) };
  }
  log(`[sync-now] 대상 반 ${picked.length}개${remaining ? `(남은 ${remaining}개는 다음에)` : ""} · 가입 확인 후보 ${candidateIds.length}명`);
  for (const p of picked) log(`[sync-now]   ${p.className}: ${p.reasons.join(", ")}`);

  const out = { classes: 0, created: 0, renamed: 0, enrolled: 0, teachers: 0, held: 0, remaining, releasedChildren: 0, releasedTeachers: 0 };
  // ⓪ 원아 연결 갱신 — 가입 확인 후보가 있으면 원아 연결(0185a)을 먼저 새로 만든다(원장 2026-11-02 A안 · 판정 = `childMapRefreshDue`).
  //    수학이 반별이면 신입의 첫 반 보드 배정 출처가 원아 연결이라, 낮에 막 가입한 학부모의 원아가 **이 실행에서** 배정되려면 여기서
  //    만들어야 한다(아래 ②의 반 보드 동기화가 연결을 새로 읽는다). ClassNote는 명부 GET만 · 4분에 한 번 · 실패해도 기존 연결로 계속.
  //    결과(만든 연결 수 · 실패)는 동기화 보고서 줄과 결과값(`childLinks` — 감사로그 metadata)에 남긴다.
  if (childMapRefreshDue({ candidates: candidateIds.length, lastAt: lastChildMapRefreshAt, now: Date.now() })) {
    lastChildMapRefreshAt = Date.now();
    const cm = await syncChildMapOnce(sql, browser, { tenant, apply: true, log, force: true }).catch((e) => {
      log(`[sync-now] 원아 연결 갱신 오류(기존 연결로 진행): ${String(e?.message ?? e).slice(0, 160)}`);
      return { ran: false, error: true };
    });
    out.childLinks = cm.applied ?? 0;
    if (cm.error) events.push({ group: "held", className: "", text: "학부모 가입 확인(원아 연결 갱신)에 실패해 기존 연결로 진행했습니다 — 몇 분 뒤 다시 요청하면 다시 확인합니다" });
    else if (cm.ran && cm.applied) events.push({ group: "changed", className: "", text: `원아 연결 ${cm.applied}건 새로 만듦(학부모 가입 확인)` });
  }
  // ① (없앰 · 1.0.14) 신입 1인 보드 준비 — 원장 2026-11-04 *"앞으로 1인보드에 배정 시키지마 절대"*. 신입의 첫 반 보드 배정 출처는
  //    위 ⓪의 원아 연결이다(영어 반 방도 원아 연결로 보낸다 — english-class-route.mjs).
  if (remaining) events.push({ group: "held", className: "", text: `바뀐 반 ${remaining}개는 한 번에 볼 수 있는 수를 넘어 다음 동기화로 미뤘습니다` });
  // ② 고른 반만 반 보드 동기화. 실패하면 ⓪에서 이미 한 일을 오류에 실어 보낸다(부분 실패 기록).
  if (picked.length) {
    const page = await browser.newPage();
    try {
      await loginClassnote(page);
      const r = await syncMathClassBoards(sql, page, { tenant, apply: true, log, onlyClassIds: new Set(picked.map((p) => p.classId)), events, applied, released });
      Object.assign(out, { classes: r.classes, created: r.created, renamed: r.renamed, enrolled: r.enrolled, teachers: r.teachers, held: r.held, releasedChildren: r.releasedChildren ?? 0, releasedTeachers: r.releasedTeachers ?? 0 });
      for (const x of r.release ?? []) log(`[sync-now]   해제 필요(사람 확인): ${x}`);
      for (const x of r.skipped ?? []) log(`[sync-now]   보류: ${x}`);
    } catch (e) {
      // 멈추기 전에 이미 해제한 것은 되돌릴 수 없다 — 부분 결과에 실어 보낸다.
      if (e && typeof e === "object") e.partial = { ...out, releasedChildren: released.children.length, releasedTeachers: released.teachers.length };
      throw e;
    } finally {
      await page.close().catch(() => {});
    }
  }
  return { ...out, pickedClasses: picked.map((p) => p.className).slice(0, 20), summary: summarizeSync(out) };
}

/**
 * 실행 중 요청을 끝낸다 — 그 사이 다른 화면이 합류해 적은 범위(`next_scope`)가 있으면 **같은 트랜잭션에서** 새 대기 요청을
 * 만든다(다음 폴에 이어서 돈다). 조건부(`status='running'`)라 그 사이 시간 초과로 정리된 요청은 건드리지 않는다.
 * ⚠️ 부분 유니크(지점당 살아 있는 요청 하나)는 `on conflict` 타깃이 안 된다([[#113]]) — 타깃 없는 `do nothing`만 쓴다.
 * @returns {Promise<{finished:boolean, requeued:boolean}>}
 */
async function finish(sql, tenant, id, { status, result, error }) {
  if (sql.agentOperation) return sql.agentOperation("finish-class-sync", { id, status, result, error });
  return sql.begin(async (tx) => {
    const [row] = await tx`update classnote_sync_requests set status = ${status}, finished_at = now(), result = ${sql.json(result)}, error = ${error}
      where id = ${id} and status = 'running' returning next_scope`;
    if (!row) return { finished: false, requeued: false };
    if (!row.next_scope || typeof row.next_scope !== "object") return { finished: true, requeued: false };
    const next = normalizeScope(row.next_scope);
    const ins = await tx`insert into classnote_sync_requests (tenant_id, scope) values (${tenant}, ${sql.json(next)})
      on conflict do nothing returning id`;
    return { finished: true, requeued: ins.length > 0 };
  });
}

/** 감사로그 머리 — 🔴 `action: "…"` 리터럴로 둔다(감사로그 레지스트리 가드가 scripts/의 직접 insert를 이 모양으로 스캔한다). */
const RUN_AUDIT = { action: "classnote_board_sync_run", actor_name: "system:classnote-sync-now" };

/** 감사로그(0313a) — 사람 세션이 없어 직접 넣는다. 액션 키는 앱 AUDIT_ACTIONS에 등록돼 있다. best-effort. */
async function audit(sql, tenant, requestId, result, error, auto = false) {
  const metadata = {
    requestId,
    ...(auto ? { auto: true } : {}),
    ok: !error,
    noChange: result?.noChange === true,
    classes: result?.classes ?? 0,
    created: result?.created ?? 0,
    renamed: result?.renamed ?? 0,
    enrolled: result?.enrolled ?? 0,
    teachers: result?.teachers ?? 0,
    held: result?.held ?? 0,
    releasedChildren: result?.releasedChildren ?? 0,
    releasedTeachers: result?.releasedTeachers ?? 0,
    remaining: result?.remaining ?? 0,
    ...(error ? { error } : {}),
  };
  await sql`insert into audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
    values (${tenant}, null, ${RUN_AUDIT.actor_name}, ${RUN_AUDIT.action}, ${"classnote_sync"},
      ${error ? "반 보드 지금 동기화 실패" : "반 보드 지금 동기화"}, ${sql.json(metadata)})`.catch(() => {});
}

/**
 * 폴 1회 — 대기 요청이 있으면 집어 실행하고 끝낸다. `post`가 아니면 아무것도 안 한다.
 * @returns {Promise<{ran:boolean, ok?:boolean, noChange?:boolean, summary?:string}>}
 */
export async function processSyncRequestOnce(sql, browser, { tenant, post, host, log = console.log }) {
  if (!post || (tableMissingAt && Date.now() - tableMissingAt < MISSING_RECHECK_MS)) return { ran: false };
  let row;
  try {
    await sweep(sql, tenant, host);
    row = await claim(sql, tenant, host);
  } catch (e) {
    if (isMissing(e)) {
      tableMissingAt = Date.now(); // 0313a 적용 전 — 조용히 쉰다(10분 뒤 다시 본다)
      return { ran: false };
    }
    throw e;
  }
  tableMissingAt = 0;
  if (!row) return { ran: false };
  // 자동 동기화(classnote-auto-sync.mjs)가 넣은 요청인가 — 결과·보고서·감사로그에 '자동'으로 남긴다(사람이 누른 것과 가린다).
  const auto = !!row.scope && typeof row.scope === "object" && !Array.isArray(row.scope) && row.scope.auto === true;
  log(`[sync-now] 요청 ${row.id} 시작${auto ? "(자동)" : ""}`);
  // 동기화 보고서(0329a) — 이 요청이 한 일·못 한 일을 이유와 함께 남긴다(멈춘 요청도, 바뀐 것이 없던 요청도).
  const startedAt = new Date();
  const events = [];
  const applied = [];
  const released = { children: [], teachers: [] };
  let recorded = false; // 회차·배정 기록은 한 번만 — 성공을 적은 뒤 요청 마무리(finish)가 던져도 '멈춘 회차'를 한 번 더 적지 않는다
  try {
    const result = await runScopedSync(sql, browser, { tenant, scope: row.scope, log, events, applied, released });
    const { classes, created, renamed, enrolled, teachers, releasedChildren, releasedTeachers } = result;
    await writeSyncRun(sql, { tenant, kind: "request", requestId: row.id, startedAt, ok: true, events, log,
      summary: { classes, created, renamed, enrolled, teachers, releasedChildren, releasedTeachers, noChange: result.noChange === true, autoRelease: autoReleaseEnabled() && !releaseHaltReason(), ...(auto ? { auto: true } : {}) } });
    await auditEnrollments(sql, tenant, applied, { kind: "request" });
    await auditReleases(sql, tenant, released, { kind: "request" });
    recorded = true;
    const fin = await finish(sql, tenant, row.id, { status: "done", result: auto ? { ...result, auto: true } : result, error: null });
    if (!fin.finished) log(`[sync-now] 요청 ${row.id}는 그 사이 시간 초과로 정리됐습니다(결과만 로그에 남김) — ${result.summary}`);
    else log(`[sync-now] 완료 — ${result.summary}${fin.requeued ? " · 실행 중에 들어온 요청을 이어서 합니다" : ""}`);
    await audit(sql, tenant, row.id, result, null, auto);
    return { ran: true, ok: true, noChange: !!result.noChange, summary: result.summary };
  } catch (e) {
    const raw = String(e?.message ?? e).slice(0, 300);
    const label = syncErrorLabel(raw);
    log(`[sync-now] 실패 — ${label} (${raw})`);
    // 부분 실패도 기록한다 — ClassNote에 이미 한 일(배정 등)은 되돌릴 수 없으므로, 0302a는 그 반만 다시 적는 다음 실행이 맞춘다.
    const partial = e && typeof e === "object" && e.partial ? e.partial : null;
    // 회차를 먼저 적고 요청을 끝낸다 — 화면은 요청이 끝난 것을 보고 보고서 요약을 읽는다(순서가 뒤집히면 직전 회차를 보여 준다).
    if (!recorded) {
      await writeSyncRun(sql, { tenant, kind: "request", requestId: row.id, startedAt, ok: false, error: label, events, log, ...(auto ? { summary: { auto: true } } : {}) });
      await auditEnrollments(sql, tenant, applied, { kind: "request" }); // 멈추기 전에 이미 배정한 원아도 기록에 남긴다
      await auditReleases(sql, tenant, released, { kind: "request" }); // 이미 해제한 원아·담임도
    }
    await finish(sql, tenant, row.id, { status: "failed", result: { raw, ...(partial ? { partial } : {}), ...(auto ? { auto: true } : {}) }, error: label }).catch(() => {});
    await audit(sql, tenant, row.id, partial, label, auto);
    return { ran: true, ok: false, summary: label };
  }
}

