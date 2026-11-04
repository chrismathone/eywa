// scripts/_classnote/class-board-sync-report.mjs — 반 보드 **동기화 보고서**(0329a, 원장 2026-10-02).
//
// 원장: *"동기화 보고서에는 모든 변동된 리스트가 남아있고, 변동실패한 리스트도 남아있고 모든 이유가 적혀있으면 될듯"* ·
//       *"감사로그 및 반이동 기록 등 모든 기록에도 남아있도록 배선되어야함"*.
//
// 동기화가 한 일을 **줄 단위**로 모아(이유 포함) 회차 행(classnote_board_sync_runs)에 적고, 학생 기록에 남을 일(원아 배정)은
// 감사로그에도 한 줄씩 남긴다. 앱의 '동기화 보고서 다운로드'가 이 행을 글(txt)로 만든다(src/features/report-admin/classnote-sync-report.ts).
//
// 줄 묶음(group): changed = 실제로 바뀐 것(원아·담임 **해제** 포함) · failed = 하려다 안 된 것 · held = 가드에 걸려 보류한 것 ·
//   release = 자동 해제 뒤에도 반 보드에 남은 명단 밖 원아(자동 해제가 보류한 것 — 사유는 held 줄에 원아마다 적는다).
// 🔴 줄 글(text)은 **한글 문장**으로 여기서 완성한다 — 앱은 코드를 풀어 쓰지 않는다(워커가 줄 종류를 늘려도 앱은 그대로).
// 🔴 보호자 전화 **값**은 넣지 않는다(계획의 보류 사유는 일치 여부만 담는다 — class-board-plan.mjs).
// 🔴 어떤 기록 실패도 동기화를 막지 않는다(표·칸이 아직 없으면 그 기록만 건너뛴다, #95).

const line = (group, className, text, extra = {}) => ({ group, className: className ?? "", text: String(text).slice(0, 500), ...extra });

/** 계획에서 바로 나오는 줄 — 특정 불가·개명 보류·학생별 보류(이유 전부). */
export function planEvents(plans) {
  const out = [];
  for (const p of plans ?? []) {
    // 학생이 없는 보고서 미발송(JJ) 반은 일부러 안 만든 것 — 실패가 아니라 '보류' 안내(실패 수·버튼 숫자·감사로그 '실패 N건'에 안 든다, 리뷰 C1).
    if (p.board?.action === "block" && p.board.notice) out.push(line("held", p.className, `반 보드를 만들지 않았습니다 — ${p.board.reason ?? "사유 없음"}`));
    else if (p.board?.action === "block") out.push(line("failed", p.className, `반 보드를 정하지 못했습니다 — ${p.board.reason ?? "사유 없음"}`));
    if (p.board?.renameBlocked) out.push(line("failed", p.className, `반 이름 변경 보류 — ${p.board.renameBlocked}`));
    for (const h of p.hold ?? []) out.push(line("held", p.className, `${h.name ?? "?"}: ${(h.reasons ?? []).join(" / ") || "사유 없음"}`, { name: h.name ?? null }));
  }
  return out;
}

/** 실행 결과(math-class-boards-apply.mjs) → 줄 — 반 생성·이름 변경·원아 배정, 그리고 그 반만 보류된 사유. */
export function appliedEvents(done) {
  const out = [];
  for (const d of done ?? []) {
    if (d.created) out.push(line("changed", d.className, "ClassNote 반 보드를 새로 만들었습니다"));
    if (d.renamed) out.push(line("changed", d.className, `반 이름 변경: ${JSON.stringify(d.renamed)} → ${JSON.stringify(d.className)}`));
    if (d.renameFailed) out.push(line("failed", d.className, `반 이름 변경 실패 — ${d.renameFailed}`));
    if (d.skipped) out.push(line("failed", d.className, d.skipped));
    for (const e of d.enrolled ?? []) out.push(line("changed", d.className, `원아 배정: ${e.name ?? "?"}`, { name: e.name ?? null }));
  }
  return out;
}

/** 담임 — 연결한 것과 건너뛴 사유. */
export function teacherEvents(todo, skipped) {
  return [
    ...(todo ?? []).map((t) => line("changed", t.className, `담임 연결: ${t.teacher ?? "?"}`)),
    ...(skipped ?? []).map((s) => {
      const text = String(s ?? "");
      const at = text.indexOf(": ");
      return at > 0 ? line("held", text.slice(0, at), `담임 연결 안 함 — ${text.slice(at + 2)}`) : line("held", "", `담임 연결 안 함 — ${text}`);
    }),
  ];
}

/** 해제 대상 — 보드가 확인된 반의 "그 반 누구의 원아도 아닌 원아"(자동 해제 뒤에도 남은 것 — 사유는 '보류' 줄에 있다). */
export function releaseEvents(plans) {
  return (plans ?? [])
    .filter((p) => p.board?.action === "exists" && (p.extras ?? []).length)
    .map((p) => line("release", p.className, `해제 필요: ${p.extras.join(", ")}`));
}

/** 원아 해제 — 실제로 내보낸 것(사유 포함) · 그 건만 실패한 것 · 자동으로 해제하지 않고 보류한 것(왜 — 사람이 확인한다). */
export function childReleaseEvents(done, failed, held) {
  return [
    ...(done ?? []).map((r) => line("changed", r.className, `원아 해제: ${r.childName ?? "?"} — ${r.reason ?? "이 반 수강이 끝났습니다"}`, { name: r.studentName ?? r.childName ?? null })),
    ...(failed ?? []).map((r) => line("failed", r.className, `원아 해제 실패: ${r.childName ?? "?"} — ${r.why ?? "사유 없음"}`, { name: r.childName ?? null })),
    ...(held ?? []).map((h) => line("held", h.className, h.text, { name: h.childName ?? null })),
  ];
}

/** 담임 해제 — 해제한 것 · 그 건만 실패한 것 · 보류한 것(사유). */
export function teacherReleaseEvents(done, failed, held) {
  return [
    ...(done ?? []).map((r) => line("changed", r.className, `담임 해제: ${r.teacher ?? "?"} — 지금 이 반 담당이 아닙니다`)),
    ...(failed ?? []).map((r) => line("failed", r.className, `담임 해제 실패: ${r.teacher ?? "?"} — ${r.why ?? "사유 없음"}`)),
    ...(held ?? []).map((h) => line("held", h.className, h.text)),
  ];
}

/**
 * 멈춘 회차 — **왜 멈췄는지**와 **멈추는 바람에 손대지 못한 반**. 원장이 바란 것이 "변동 실패한 리스트 + 모든 이유"인데, 가장 큰 실패(멈춤)의
 * 이유가 일반 문구 한 줄로만 남으면 어느 반·어느 학생에서 멈췄는지 알 수 없다.
 *  · 원문에 한글이 있으면(우리가 쓴 문장 — "홍길동: 1인 보드 원아가 계획과 다르다 — 중단") 그대로 싣는다.
 *    한글이 없으면(네트워크·브라우저의 영문 오류) 싣지 않는다 — 회차의 한글 사유(`run.error`)가 대신 말한다.
 *  · 손대지 못한 반 = 실행 대상(targets) 중 결과(applied)에 없는 반.
 */
export function stoppedEvents(error, targets, applied) {
  const out = [];
  const raw = String(error?.message ?? error ?? "").trim();
  if (/[가-힣]/.test(raw)) out.push(line("failed", "", `여기서 멈췄습니다 — ${raw}`));
  const reached = new Set((applied ?? []).map((d) => d.classId));
  for (const p of targets ?? [])
    if (!reached.has(p.classId)) out.push(line("held", p.className, "앞에서 멈춰 이번에는 하지 못했습니다 — 다음 동기화에서 다시 합니다"));
  return out;
}

/** 숫자 요약 — 줄에서 센다(화면 요약과 보고서가 같은 수를 말하게). */
export function summarizeEvents(events, extra = {}) {
  const n = (g) => (events ?? []).filter((e) => e.group === g).length;
  return { changed: n("changed"), failed: n("failed"), held: n("held"), release: n("release"), ...extra };
}

/**
 * 회차 한 줄을 적는다 — 성공·실패 모두(멈춘 회차는 ok=false + 한글 사유, 그 전에 한 일은 events에 남는다).
 * @param {import("postgres").Sql} sql
 * @param {{ tenant:string, kind:"daily"|"request", requestId?:string|null, startedAt:Date, ok:boolean, error?:string|null,
 *           events:Array<object>, summary?:object, log?:(s:string)=>void }} run
 * @returns {Promise<boolean>} 적었으면 true
 */
export async function writeSyncRun(sql, run) {
  const log = run.log ?? console.log;
  try {
    const events = (run.events ?? []).slice(0, 2000); // 한 회차 줄 수 상한(보류가 몰려도 행이 비대해지지 않게)
    const summary = summarizeEvents(run.events ?? [], { ...(run.summary ?? {}), truncated: (run.events ?? []).length > events.length });
    await sql`
      insert into classnote_board_sync_runs (tenant_id, kind, request_id, started_at, finished_at, ok, error, summary, events)
      values (${run.tenant}, ${run.kind}, ${run.requestId ?? null}, ${run.startedAt}, now(), ${run.ok}, ${run.error ?? null},
        ${sql.json(summary)}, ${sql.json(events)})`;
    // 석 달 지난 회차는 지운다(바뀐 반이 없던 요청까지 쌓인다) — 실패해도 기록과 무관.
    await sql`delete from classnote_board_sync_runs where tenant_id = ${run.tenant} and finished_at < now() - interval '90 days'`.catch(() => {});
    return true;
  } catch (e) {
    log(`[class-board] 동기화 보고서 기록 건너뜀 — ${String(e?.message ?? e).slice(0, 120)}`);
    return false;
  }
}

/** 감사로그 머리 — 🔴 `action: "…"` 리터럴로 둔다(감사로그 레지스트리 가드가 scripts/의 직접 insert를 이 모양으로 스캔한다). */
const ENROLL_AUDIT = { action: "classnote_board_enroll", actor_name: "system:classnote-board-sync" };
const DAILY_AUDIT = { action: "classnote_board_sync_daily", actor_name: "system:classnote-board-sync" };
const RELEASE_AUDIT = { action: "classnote_board_release", actor_name: "system:classnote-board-sync" };
const TEACHER_RELEASE_AUDIT = { action: "classnote_board_teacher_release", actor_name: "system:classnote-board-sync" };

/**
 * 원아 배정을 **학생 기록**으로 남긴다 — 감사로그에 학생 한 명당 한 줄(어느 반 보드에 배정됐나).
 * 반 이동·신입으로 ClassNote 반 보드가 바뀐 사실이 사람 기록(감사로그)에서도 되짚인다. best-effort.
 */
export async function auditEnrollments(sql, tenant, done, { kind }) {
  for (const d of done ?? []) {
    for (const e of d.enrolled ?? []) {
      const metadata = { studentId: e.studentId ?? null, className: d.className, boardId: d.boardId ?? null, childId: e.childId ?? null, kind };
      await sql`insert into audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
        values (${tenant}, null, ${ENROLL_AUDIT.actor_name}, ${ENROLL_AUDIT.action}, ${"student"}, ${e.name ?? "학생"}, ${sql.json(metadata)})`.catch(() => {});
    }
  }
}

/**
 * 원아·담임 **해제**를 기록으로 남긴다 — 감사로그에 한 건당 한 줄(어느 반 보드에서 누가 빠졌나 · 왜). best-effort.
 * @param {{children?:Array, teachers?:Array}} released  class-board-release-apply.mjs가 실제로 해제한 것
 */
export async function auditReleases(sql, tenant, released, { kind }) {
  for (const r of released?.children ?? []) {
    // boardKind = 어느 종류 보드에서 뺐나(반 보드·영어 반 방·종강 반 보드·1인 보드 — 원장 2026-11-03 범위 확장). 옛 줄은 반 보드다.
    const metadata = { studentId: r.studentId ?? null, className: r.className, boardId: r.boardId ?? null, childId: r.childId ?? null, reason: r.reason ?? null, boardKind: r.boardKind ?? "class", kind };
    await sql`insert into audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
      values (${tenant}, null, ${RELEASE_AUDIT.actor_name}, ${RELEASE_AUDIT.action}, ${"student"}, ${r.studentName ?? r.childName ?? "학생"}, ${sql.json(metadata)})`.catch(() => {});
  }
  for (const r of released?.teachers ?? []) {
    const metadata = { className: r.className, boardId: r.boardId ?? null, teacher: r.teacher ?? null, kind };
    await sql`insert into audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
      values (${tenant}, null, ${TEACHER_RELEASE_AUDIT.actor_name}, ${TEACHER_RELEASE_AUDIT.action}, ${"class"}, ${r.className ?? "반"}, ${sql.json(metadata)})`.catch(() => {});
  }
}

/** 매일 정기 동기화의 감사로그 — '지금 동기화'는 요청 쪽이 따로 남긴다(classnote-sync-request.mjs). best-effort. */
export async function auditDailyRun(sql, tenant, { ok, error, summary }) {
  const metadata = { ok, ...(summary ?? {}), ...(error ? { error } : {}) };
  await sql`insert into audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
    values (${tenant}, null, ${DAILY_AUDIT.actor_name}, ${DAILY_AUDIT.action}, ${"classnote_sync"},
      ${ok ? "반 보드 정기 동기화" : "반 보드 정기 동기화 실패"}, ${sql.json(metadata)})`.catch(() => {});
}
