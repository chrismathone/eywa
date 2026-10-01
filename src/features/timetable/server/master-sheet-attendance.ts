import "server-only";
import type postgres from "postgres";
import type {
  MasterAttendance,
  AttendanceLink,
  AttendanceMove,
} from "../import/master/attendance-types";

type Sql = postgres.Sql | postgres.TransactionSql;
/** Acquire before any SELECT establishes the serializable snapshot. Also covers writers that do not use our advisory lock. */
export async function lockAttendanceMigration(tx: postgres.TransactionSql) {
  await tx`set local lock_timeout='5s'`;
  await tx`lock table attendance_records in share row exclusive mode`;
  await tx`lock table lesson_reports,makeup_reservations in share mode`;
}
export async function loadMasterAttendance(
  sql: Sql,
  tenant: string,
  date: string,
) {
  // Keep subsecond precision while normalizing the preview/apply connections' different timezones.
  return sql<
    MasterAttendance[]
  >`select a.id,a.class_id as "classId",a.student_id as "studentId",a.session_date::text as date,to_char(a.slot_start,'HH24:MI') as "startTime",to_jsonb(a)||jsonb_build_object('recorded_at',to_char(a.recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) as record from attendance_records a where a.tenant_id=${tenant} and a.session_date>=${date}::date order by a.id`;
}
export async function loadAttendanceLinks(
  sql: Sql,
  tenant: string,
  date: string,
) {
  return sql<AttendanceLink[]>`
    select c as "classId",student_id as "studentId",report_date::text as date,'report' as kind
    from lesson_reports cross join lateral (values(class_id),(makeup_class_id),(classnote_class_id)) classes(c)
    where tenant_id=${tenant} and report_date>=${date}::date and c is not null
    union all
    select class_id,student_id,d::text,'reservation' from makeup_reservations cross join lateral (values(absence_date),(makeup_date)) dates(d)
    where tenant_id=${tenant} and d>=${date}::date
    union all
    select a.class_id,a.student_id,a.session_date::text,'reservation' from makeup_reservations r
    join attendance_records a on a.id=r.attendance_record_id and a.tenant_id=r.tenant_id
    where r.tenant_id=${tenant} and a.session_date>=${date}::date order by 1,2,3,4`;
}
export type AttendanceBackup = {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};
export function attendanceBackups(
  moves: AttendanceMove[],
  rows: MasterAttendance[],
): AttendanceBackup[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return moves.flatMap((m) =>
    m.ids.map((id) => {
      const row = byId.get(id);
      if (!row?.record.id)
        throw new Error("출결 원본을 확인하지 못했습니다. 다시 검사해 주세요.");
      return {
        before: row.record,
        after: {
          ...row.record,
          class_id: m.toClassId,
          slot_start: m.toTime ? `${m.toTime}:00` : null,
        },
      };
    }),
  );
}
/** Only the anchor changes. IDs, correction chains, notes, units and recording provenance stay intact. */
export async function applyAttendanceMoves(
  tx: postgres.TransactionSql,
  tenant: string,
  backups: AttendanceBackup[],
) {
  if (!backups.length) return 0;
  const updated = await tx`
    update attendance_records a set class_id=(b->'after'->>'class_id')::uuid,slot_start=(b->'after'->>'slot_start')::time
    from jsonb_array_elements(${tx.json(backups as never)}::jsonb) b
    where a.tenant_id=${tenant} and a.id=(b->'before'->>'id')::uuid and a is not distinct from jsonb_populate_record(null::attendance_records,b->'before') returning a.id`;
  if (updated.length !== backups.length)
    throw new Error(
      "출결이 변경되어 전체 반영을 취소했습니다. 다시 검사해 주세요.",
    );
  return updated.length;
}
/** A future reservation can be cancelled only while every migrated row and destination still agrees. */
export async function rollbackAttendanceMoves(
  tx: postgres.TransactionSql,
  tenant: string,
  backups: AttendanceBackup[],
) {
  if (!backups.length) return;
  const ids = backups.map((b) => String(b.before.id));
  const conflicts = await tx`
    select a.id from attendance_records a join jsonb_array_elements(${tx.json(backups as never)}::jsonb) b
    on a.student_id=(b->'before'->>'student_id')::uuid and a.session_date=(b->'before'->>'session_date')::date
    and ((a.class_id=(b->'before'->>'class_id')::uuid and (a.slot_start is null or b->'before'->>'slot_start' is null or a.slot_start=(b->'before'->>'slot_start')::time))
      or (a.class_id=(b->'after'->>'class_id')::uuid and (a.slot_start is null or b->'after'->>'slot_start' is null or a.slot_start=(b->'after'->>'slot_start')::time)))
    where a.tenant_id=${tenant} and not(a.id=any(${ids}::uuid[])) limit 1`;
  if (conflicts.length)
    throw new Error(
      "이관 이후 출결이 추가되어 예약을 취소할 수 없습니다. 출결을 먼저 확인해 주세요.",
    );
  const links = await loadAttendanceLinks(
    tx,
    tenant,
    backups.map((b) => String(b.before.session_date)).sort()[0]!,
  );
  if (
    links.some((l) =>
      backups.some(
        (b) =>
          l.studentId === b.before.student_id &&
          l.date === b.before.session_date &&
          [b.before.class_id, b.after.class_id].includes(l.classId),
      ),
    )
  )
    throw new Error(
      "이관 이후 수업보고서 또는 보강 예약이 연결되어 예약을 취소할 수 없습니다. 연결된 기록을 먼저 확인해 주세요.",
    );
  await applyAttendanceMoves(
    tx,
    tenant,
    backups.map((b) => ({ before: b.after, after: b.before })),
  );
}
