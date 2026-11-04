import "server-only";
import { assertTenantViewOutboundAllowed } from "@/lib/auth/tenant-view-outbound";
import postgres from "postgres";
import { nextClosedClassName } from "../closed-name";
import { CLOSE_TERM_REASON } from "./enrollment-lifecycle";

export class ClassTermError extends Error {}

export type TermActor = { id: string | null; tenantId: string; displayName: string };
/**
 * `closeSchedules` = 종강일 뒤로 남은 시간표 배치(class_schedules)도 종강일에 닫는다(2026-11-02).
 * 종강 버튼·밤 정리(cron)만 켠다 — 영어 시트 반영(master-sheet-store)은 배치를 제 계획으로 직접 닫고
 * 제 스냅샷으로 되돌리므로 여기서 또 닫으면 되돌리기끼리 부딪힌다. 폐지는 is_active로 이미 모든 화면에서 빠진다.
 */
export type TermRequest = { classId: string; date: string; name?: string; archive?: boolean; closeSchedules?: boolean };
type ClassState = { id: string; class_name: string; closed_at: string | null; is_active: boolean };
type EnrollmentState = {
  id: string;
  student_id: string;
  start_date: string;
  end_date: string | null;
  withdrawal_reason: string | null;
};
/** 배치 한 줄의 끝나는 날 before → after. 재개강·되돌리기는 after가 그대로일 때만 before로 돌린다. */
export type ScheduleTermChange = { id: string; before: string | null; after: string | null };
export type TermBackup = {
  before: ClassState;
  after: ClassState;
  enrollments: { before: EnrollmentState; after: EnrollmentState }[];
  /** 없으면 배치를 건드리지 않은 기록(옛 스냅샷·시트 반영). */
  schedules?: ScheduleTermChange[];
};

/** Same lifecycle as 반 관리: end open enrollments, keep students/status and all historical records. */
export async function prepareClassTerms(
  tx: postgres.TransactionSql,
  tenant: string,
  requests: TermRequest[],
  excludedEnrollments: string[] = [],
): Promise<TermBackup[]> {
  if (!requests.length) return [];
  const [clock] = await tx<
    { today: string }[]
  >`select (now() at time zone 'Asia/Seoul')::date::text as today`;
  const classes = await tx<(ClassState & { subject: string })[]>`
    select id,class_name,closed_at::text,is_active,subject from classes where tenant_id=${tenant} order by id for update`;
  const result: TermBackup[] = [];
  for (const request of requests) {
    const c = classes.find((c) => c.id === request.classId);
    if (!c) throw new ClassTermError("종강할 반을 찾지 못했습니다. 다시 확인해 주세요.");
    const names = classes
      .filter((v) => v.subject === c.subject && v.id !== c.id)
      .map((v) => v.class_name);
    const name = nextClosedClassName(c.class_name, request.date, names);
    if (request.name && request.name !== name)
      throw new ClassTermError("종강 후 반 이름이 변경되었습니다. 다시 검사해 주세요.");
    // Future closure is visible on the class now; the nightly job ends enrollments only when due.
    const rows =
      !request.archive && request.date > clock!.today
        ? []
        : await tx<EnrollmentState[]>`
      select id,student_id,start_date::text,end_date::text,withdrawal_reason from enrollments
      where tenant_id=${tenant} and class_id=${c.id} and end_date is null and not(id=any(${excludedEnrollments}::uuid[])) order by id for update`;
    const before = {
      id: c.id,
      class_name: c.class_name,
      closed_at: c.closed_at,
      is_active: c.is_active,
    };
    const after = {
      ...before,
      class_name: name,
      closed_at: request.archive ? c.closed_at : request.date,
      is_active: request.archive ? false : c.is_active,
    };
    // 🔴 종강이 배치를 안 닫으면 시간표에선 숨는데 DB엔 '끝나는 날 없음'으로 남아, 시트 가져오기가 시트에 없는
    //    그 반을 "제거(종료)"로 띄운다(원장 2026-11-02 LS4b — "없는 반인데 갑자기 삭제를 한다고?"). 종강일보다
    //    늦게 시작하는 예약 줄도 종강일로 끝낸다(시작보다 이른 끝 = 한 번도 유효하지 않음 — 재개강이 되살린다).
    //    🔴 종강일 뒤에 찍힌 출결이 있으면 배치는 **그 마지막 출결일까지** 남긴다 — 출결의 강사 귀속(teacher-axis)이
    //    그날 살아 있는 배치로 정해져서, 먼저 닫으면 지난 기록의 교시 담당·자리 시수가 담임 몫으로 옮겨 간다
    //    (2026-11-02 실측: `고등M_일 개별진도` 종강 9/27 · 출결 9/30까지). 종강일은 그대로 둔다.
    const closeSchedules = request.closeSchedules && !request.archive;
    let scheduleEnd = request.date;
    if (closeSchedules) {
      const [att] = await tx<{ last: string | null }[]>`
        select max(session_date)::text as last from attendance_records
        where tenant_id=${tenant} and class_id=${c.id} and session_date>${request.date}::date`;
      if (att?.last && att.last > scheduleEnd) scheduleEnd = att.last;
    }
    const schedules = closeSchedules
      ? await tx<{ id: string; valid_to: string | null }[]>`
      select id,valid_to::text from class_schedules
      where tenant_id=${tenant} and class_id=${c.id} and (valid_to is null or valid_to>${scheduleEnd}::date) order by id for update`
      : [];
    result.push({
      before,
      after,
      enrollments: rows.map((e) => ({
        before: e,
        after: {
          ...e,
          end_date: e.start_date > request.date ? e.start_date : request.date,
          withdrawal_reason: request.archive ? "반 폐지" : "종강",
        },
      })),
      ...(closeSchedules
        ? { schedules: schedules.map((s) => ({ id: s.id, before: s.valid_to, after: scheduleEnd })) }
        : {}),
    });
    Object.assign(c, after);
  }
  return result;
}

export async function applyClassTerms(
  tx: postgres.TransactionSql,
  actor: TermActor,
  backups: TermBackup[],
  restoring = false,
) {
  for (const b of backups) {
    const changed = await tx`
      update classes set class_name=${b.after.class_name},closed_at=${b.after.closed_at}::date,is_active=${b.after.is_active}
      where tenant_id=${actor.tenantId} and id=${b.before.id} and class_name=${b.before.class_name}
        and closed_at is not distinct from ${b.before.closed_at}::date and is_active=${b.before.is_active} returning id`;
    if (changed.length !== 1)
      throw new ClassTermError("반 정보가 변경되어 종강 처리를 중단했습니다. 다시 검사해 주세요.");
    if (b.enrollments.length) {
      const updated = await tx`
        update enrollments e set end_date=(x->'after'->>'end_date')::date,withdrawal_reason=x->'after'->>'withdrawal_reason'
        from jsonb_array_elements(${tx.json(b.enrollments as never)}::jsonb) x
        where e.tenant_id=${actor.tenantId} and e.class_id=${b.before.id} and e.id=(x->'before'->>'id')::uuid
          and e.student_id=(x->'before'->>'student_id')::uuid and e.start_date=(x->'before'->>'start_date')::date
          and e.end_date is not distinct from (x->'before'->>'end_date')::date
          and e.withdrawal_reason is not distinct from x->'before'->>'withdrawal_reason' returning e.id`;
      if (updated.length !== b.enrollments.length)
        throw new ClassTermError("수강 정보가 변경되어 종강 처리를 중단했습니다.");
    }
    if (b.schedules?.length) {
      const updated = await tx`
        update class_schedules s set valid_to=(x->>'after')::date
        from jsonb_array_elements(${tx.json(b.schedules as never)}::jsonb) x
        where s.tenant_id=${actor.tenantId} and s.class_id=${b.before.id} and s.id=(x->>'id')::uuid
          and s.valid_to is not distinct from (x->>'before')::date returning s.id`;
      if (updated.length !== b.schedules.length)
        throw new ClassTermError("시간표 배치가 변경되어 종강 처리를 중단했습니다. 다시 시도해 주세요.");
    }
    const action = restoring
      ? "class_reopen_term"
      : b.before.closed_at !== b.after.closed_at || b.after.is_active
        ? "class_end_term"
        : "class_archive";
    await tx`insert into audit_logs(tenant_id,actor_id,actor_name,action,target_type,target_label,metadata)
      values(${actor.tenantId},${actor.id},${actor.displayName},${action},'class',${b.after.class_name},
        ${tx.json({
          classId: b.before.id,
          closedAt: b.after.closed_at,
          fromName: b.before.class_name,
          toName: b.after.class_name,
          affectedStudents: new Set(b.enrollments.map((e) => e.before.student_id)).size,
          // 재개강이 이 목록으로 배치를 되살린다(reopenClassWithSchedules) — 닫은 줄이 있을 때만 싣는다.
          ...(b.schedules?.length ? { schedules: b.schedules } : {}),
        })})`;
  }
}

/** Cancel only our own changes. Other class/enrollment edits cause an atomic rollback of cancellation. */
export async function rollbackClassTerms(
  tx: postgres.TransactionSql,
  actor: TermActor,
  backups: TermBackup[],
) {
  for (const b of [...backups].reverse()) {
    await applyClassTerms(
      tx,
      actor,
      [
        {
          before: b.after,
          after: b.before,
          enrollments: b.enrollments.map((e) => ({ before: e.after, after: e.before })),
          ...(b.schedules?.length
            ? { schedules: b.schedules.map((s) => ({ id: s.id, before: s.after, after: s.before })) }
            : {}),
        },
      ],
      true,
    );
  }
}

/** Called only after the class-management permission gate; one transaction for name/status/enrollments. */
export async function endClassWithName(actor: TermActor, request: TermRequest) {
  // 🔴 DB에 직접 접속해 쓴다 — Supabase 요청을 보는 쓰기 차단을 지나지 않으므로, 운영 콘솔의 '지점 보기'(읽기 전용)는 여기서 따로 멈춘다(tenant-view-outbound.ts).
  await assertTenantViewOutboundAllowed();
  if (!process.env.DATABASE_URL) throw new Error("반 관리 DB 연결을 확인해 주세요.");
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 15 });
  try {
    return await sql.begin("isolation level serializable", async (tx) => {
      await tx`set local lock_timeout='5s'`;
      await tx`select set_config('request.jwt.claims',${JSON.stringify({ sub: actor.id, role: "authenticated" })},true)`;
      const rows = await prepareClassTerms(tx, actor.tenantId, [request]);
      await applyClassTerms(tx, actor, rows);
      return rows[0]!;
    });
  } finally {
    await sql.end();
  }
}

/**
 * 재개강 — 종강일 비우기 · 종강이 닫은 배치 되살리기 · 종강이 끝낸 수강 되살리기 · 재개강 기록을 **한 거래**로.
 * ① 배치 근거 = 지난 재개강 뒤로 지금 종강일에 남은 종강 기록 **전부**(`class_end_term`의 schedules — 버튼·밤 정리·
 *    명령줄 정리가 나눠 남길 수 있다). 줄마다 가장 이른 기록의 원래 끝나는 날로, 그 뒤 손으로 바꾼 줄은 그대로 둔다.
 *    재개강 기록도 이 거래 안에서 남긴다 — 다음 종강 주기의 합치기 경계라서, 수강 되살리기가 실패해 기록만 빠지면
 *    옛 주기 값이 되살아난다(재리뷰 2026-11-02).
 * ② 그래도 밤 정리가 '운영 기간 종료'로 볼 반이면(`class_period_closed_end` — 산 배치 없음) **재개강을 막는다** — 그대로 열면 그날 밤 `close_ended_class_period_enrollments`
 *    가 되살린 수강을 '운영 기간 종료'로 다시 닫는다(적대 리뷰 2026-11-02). 배치를 지어 내지 않는다(옛 학기 줄을
 *    소급해 살리거나 원래 운영 종료일을 지우게 된다 — 재리뷰). 배치가 아예 없는 반은 그 밤 정리에 안 걸리니 연다.
 * ⚠️ 그 종강 기록은 기능이 읽는 감사 로그다 — 감사 로그를 옮기거나 지울 때 `class_end_term`의 schedules를 남길 것.
 */
export async function reopenClassWithSchedules(actor: TermActor, classId: string) {
  await assertTenantViewOutboundAllowed();
  if (!process.env.DATABASE_URL) throw new Error("반 관리 DB 연결을 확인해 주세요.");
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 15 });
  try {
    return await sql.begin("isolation level serializable", async (tx) => {
      await tx`set local lock_timeout='5s'`;
      await tx`select set_config('request.jwt.claims',${JSON.stringify({ sub: actor.id, role: "authenticated" })},true)`;
      const [c] = await tx<{ class_name: string; closed_at: string | null }[]>`
        select class_name,closed_at::text from classes where tenant_id=${actor.tenantId} and id=${classId} for update`;
      if (!c) throw new ClassTermError("재개강할 반을 찾지 못했습니다. 다시 확인해 주세요.");
      if (!c.closed_at) throw new ClassTermError("이미 운영 중인 반입니다. 새로고침해 주세요.");
      const logs = await tx<{ schedules: ScheduleTermChange[] | null }[]>`
        select a.metadata->'schedules' as schedules from audit_logs a
        where a.tenant_id=${actor.tenantId} and a.action='class_end_term' and a.target_type='class'
          and a.metadata->>'classId'=${classId} and a.metadata->>'closedAt'=${c.closed_at}
          and jsonb_typeof(a.metadata->'schedules')='array'
          and a.created_at > coalesce((select max(r.created_at) from audit_logs r where r.tenant_id=${actor.tenantId}
            and r.action='class_reopen_term' and r.metadata->>'classId'=${classId}), '-infinity'::timestamptz)
        order by a.created_at, a.id`;
      const first = new Map<string, ScheduleTermChange>();
      for (const log of logs) for (const s of log.schedules ?? []) if (!first.has(s.id)) first.set(s.id, s);
      const back = [...first.values()].map((s) => ({ id: s.id, before: s.after, after: s.before }));
      let restoredSchedules = 0;
      if (back.length) {
        const rows = await tx`
          update class_schedules s set valid_to=(x->>'after')::date
          from jsonb_array_elements(${tx.json(back as never)}::jsonb) x
          where s.tenant_id=${actor.tenantId} and s.class_id=${classId} and s.id=(x->>'id')::uuid
            and s.valid_to is not distinct from (x->>'before')::date returning s.id`;
        restoredSchedules = rows.length;
      }
      // 막는 판정 = 그 밤 정리가 쓰는 DB 함수 그대로(한 벌) — 산 배치가 없고 마지막 줄이 끝난 뒤 만든 줄도 아니면 날짜가 온다.
      const [state] = await tx<{ period_end: string | null }[]>`
        select public.class_period_closed_end(${classId}::uuid)::text as period_end`;
      if (state?.period_end)
        throw new ClassTermError(
          `이 반은 시간표 배치가 ${state.period_end}에 모두 끝나 있어 다시 개강하면 그날 밤 수강이 운영 기간 종료로 다시 닫힙니다. 반 수정에서 시간표를 넣은 뒤 재개강해 주세요.`,
        );
      await tx`update classes set closed_at=null where tenant_id=${actor.tenantId} and id=${classId}`;
      // 종강이 끝낸 수강만 되살린다(그 전에 수동 종료·반이동으로 끝난 수강은 그대로) — 화면과 같은 DB 함수·같은 권한 검사.
      const students = await tx<{ student_id: string }[]>`
        select student_id from public.reopen_class_enrollments(${classId}::uuid, ${CLOSE_TERM_REASON})`;
      const affectedStudents = new Set(students.map((r) => r.student_id)).size;
      await tx`insert into audit_logs(tenant_id,actor_id,actor_name,action,target_type,target_label,metadata)
        values(${actor.tenantId},${actor.id},${actor.displayName},'class_reopen_term','class',${c.class_name},
          ${tx.json({ classId, affectedStudents, restoredSchedules })})`;
      return { className: c.class_name, restoredSchedules, affectedStudents };
    });
  } finally {
    await sql.end();
  }
}
