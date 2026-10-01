import "server-only";
import postgres from "postgres";
import { nextClosedClassName } from "../closed-name";

export type TermActor = { id: string | null; tenantId: string; displayName: string };
export type TermRequest = { classId: string; date: string; name?: string; archive?: boolean };
type ClassState = { id: string; class_name: string; closed_at: string | null; is_active: boolean };
type EnrollmentState = {
  id: string;
  student_id: string;
  start_date: string;
  end_date: string | null;
  withdrawal_reason: string | null;
};
export type TermBackup = {
  before: ClassState;
  after: ClassState;
  enrollments: { before: EnrollmentState; after: EnrollmentState }[];
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
    if (!c) throw new Error("종강할 반을 찾지 못했습니다. 다시 확인해 주세요.");
    const names = classes
      .filter((v) => v.subject === c.subject && v.id !== c.id)
      .map((v) => v.class_name);
    const name = nextClosedClassName(c.class_name, request.date, names);
    if (request.name && request.name !== name)
      throw new Error("종강 후 반 이름이 변경되었습니다. 다시 검사해 주세요.");
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
      throw new Error("반 정보가 변경되어 종강 처리를 중단했습니다. 다시 검사해 주세요.");
    if (b.enrollments.length) {
      const updated = await tx`
        update enrollments e set end_date=(x->'after'->>'end_date')::date,withdrawal_reason=x->'after'->>'withdrawal_reason'
        from jsonb_array_elements(${tx.json(b.enrollments as never)}::jsonb) x
        where e.tenant_id=${actor.tenantId} and e.class_id=${b.before.id} and e.id=(x->'before'->>'id')::uuid
          and e.student_id=(x->'before'->>'student_id')::uuid and e.start_date=(x->'before'->>'start_date')::date
          and e.end_date is not distinct from (x->'before'->>'end_date')::date
          and e.withdrawal_reason is not distinct from x->'before'->>'withdrawal_reason' returning e.id`;
      if (updated.length !== b.enrollments.length)
        throw new Error("수강 정보가 변경되어 종강 처리를 중단했습니다.");
    }
    await tx`insert into audit_logs(tenant_id,actor_id,actor_name,action,target_type,target_label,metadata)
      values(${actor.tenantId},${actor.id},${actor.displayName},${restoring ? "class_reopen_term" : b.after.is_active ? "class_end_term" : "class_archive"},'class',${b.after.class_name},
        ${tx.json({
          classId: b.before.id,
          closedAt: b.after.closed_at,
          fromName: b.before.class_name,
          toName: b.after.class_name,
          affectedStudents: new Set(b.enrollments.map((e) => e.before.student_id)).size,
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
        },
      ],
      true,
    );
  }
}

/** Called only after the class-management permission gate; one transaction for name/status/enrollments. */
export async function endClassWithName(actor: TermActor, request: TermRequest) {
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
