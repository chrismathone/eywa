import "server-only";
import { prepareClassTerms, applyClassTerms, rollbackClassTerms, type TermBackup } from "@/features/classes/server/class-term-store";
import postgres from "postgres";
import { createHash, randomUUID } from "node:crypto";
import { buildMasterPlan } from "../import/master/plan";
import { buildRosterReview } from "../import/master/roster-review";
import { enrollmentOnHoldForStatus } from "@/features/enrollments/eligibility";
import { shiftDays } from "../lib/week";
import type {
  MasterContext,
  MasterGrids,
  MasterInput,
  MasterPlan,
  MasterPreview,
} from "../import/master/types";
import { CLASS_UPDATES_APPLIED_KIND } from "../due-class-updates";
import {
  loadMasterAttendance,
  loadAttendanceLinks,
  attendanceBackups,
  applyAttendanceMoves,
  rollbackAttendanceMoves,
  lockAttendanceMigration,
  type AttendanceBackup,
} from "./master-sheet-attendance";
import { nativeAttendanceLinks } from "@/features/makeups/server/adapters/participants";

export function openMasterDb() {
  if (!process.env.DATABASE_URL)
    throw new Error(
      "시간표 반영 DB 연결이 설정되지 않았습니다. 관리자에게 연결 설정을 요청해 주세요.",
    );
  return postgres(process.env.DATABASE_URL, {
    prepare: false,
    max: 1,
    connect_timeout: 15,
    idle_timeout: 10,
  });
}
type Sql = postgres.Sql | postgres.TransactionSql;
export type MasterActor = { id: string; tenantId: string; displayName: string };

/** All tables are explicitly scoped, including joins. Called again inside the apply transaction. */
export async function loadMasterContext(
  sql: Sql,
  tenant: string,
  date: string,
): Promise<MasterContext> {
  const [
    classes,
    teachers,
    classrooms,
    students,
    schedules,
    enrollments,
    settings,
    blocks,
    attendance,
    pending,
    attendanceLinks,
  ] = await Promise.all([
    sql<
      MasterContext["classes"]
    >`select id,class_name as "className",subject,teacher_id as "teacherId",classroom_id as "classroomId",is_active as active,closed_at::text as "closedAt",english_track as track from classes where tenant_id=${tenant} and subject='english' order by id`,
    sql<
      MasterContext["teachers"]
    >`select id,display_name as "displayName",english_name as "englishName",system_role as "systemRole" from users where tenant_id=${tenant} and status='active' order by id`,
    sql<
      MasterContext["classrooms"]
    >`select id,name from classrooms where tenant_id=${tenant} and archived_at is null order by id`,
    sql<
      MasterContext["students"]
    >`select id as "studentId",name,school,grade,status from students where tenant_id=${tenant} order by id`,
    sql<
      MasterContext["schedules"]
    >`select s.id,s.class_id as "classId",c.class_name as "className",s.day_of_week as day,to_char(s.start_time,'HH24:MI') as "startTime",to_char(s.end_time,'HH24:MI') as "endTime",s.teacher_id as "teacherId",s.classroom_id as "classroomId",s.slot_teacher_label as "slotTeacherLabel",s.slot_room_label as "slotRoomLabel",s.merge_group as "mergeGroup",s.valid_from::text as "validFrom",s.valid_to::text as "validTo" from class_schedules s join classes c on c.id=s.class_id and c.tenant_id=s.tenant_id where s.tenant_id=${tenant} and c.is_active and (c.closed_at is null or c.closed_at>=${date}::date) and (s.valid_to is null or s.valid_to>=${date}::date) order by s.id`,
    sql<
      MasterContext["enrollments"]
    >`select id,student_id as "studentId",class_id as "classId",start_date::text as "startDate",end_date::text as "endDate",coalesce(on_hold,false) as "onHold",coalesce(is_transferred,false) as "isTransferred",attendance_days as "attendanceDays" from enrollments where tenant_id=${tenant} and (end_date is null or end_date>=${date}::date) order by id`,
    sql<
      { groups: MasterContext["groups"] }[]
    >`select s->'integrationGroups' as groups from tenant_settings,jsonb_array_elements(data->'operations'->'subjects') s where tenant_id=${tenant} and s->>'key'='english'`,
    sql<
      MasterContext["blocks"]
    >`select id,teacher_label as "teacherName",day_of_week as day,to_char(start_time,'HH24:MI') as "startTime",to_char(end_time,'HH24:MI') as "endTime",kind,label,valid_from::text as "validFrom",valid_to::text as "validTo" from teacher_schedule_blocks where tenant_id=${tenant} and subject='english' and (valid_to is null or valid_to>=${date}::date) order by id`,
    loadMasterAttendance(sql, tenant, date),
    sql<
      MasterContext["pending"]
    >`select s.id,s.reference_date::text as date,s.label from timetable_snapshots s where s.tenant_id=${tenant} and s.reference_date>=${date}::date and s.reference_date>(now() at time zone 'Asia/Seoul')::date and s.payload->>'kind'='english_structure' and not exists(select 1 from timetable_import_logs l where l.tenant_id=${tenant} and l.snapshot_id=s.id and l.restored_at is not null) order by s.id`,
    loadAttendanceLinks(sql, tenant, date),
  ]);
  if (!settings.length)
    throw new Error(
      "학원 설정에서 영어 과목을 찾을 수 없습니다. 과목 설정을 확인해 주세요.",
    );
  const nativeLinks = await nativeAttendanceLinks(date);
  return {
    classes,
    teachers,
    classrooms,
    students,
    schedules,
    enrollments,
    groups: settings[0]!.groups ?? [],
    blocks,
    attendance,
    pending,
    attendanceLinks: [...attendanceLinks, ...nativeLinks],
  };
}

// Stable property order even after a jsonb round trip. The token binds input, source, and every DB prerequisite.
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stable(v)]),
    );
  return value;
}
export function masterPreview(
  input: MasterInput,
  grids: MasterGrids,
  ctx: MasterContext,
  source: MasterPlan["source"],
): MasterPreview {
  const plan = buildMasterPlan(input, grids, ctx, source);
  const hash = createHash("sha256")
    .update(JSON.stringify(stable({ rulesVersion: 5, input, grids, ctx })))
    .digest("hex");
  return {
    ...plan,
    hash,
    rosterReview: buildRosterReview(input, grids, ctx),
    classes: ctx.classes
      .filter(
        (c) => c.active && (!c.closedAt || c.closedAt >= input.effectiveDate),
      )
      .map((c) => ({ id: c.id, name: c.className })),
    teachers: ctx.teachers.map((t) => ({
      id: t.id,
      name: `${t.displayName}${t.englishName ? ` (${t.englishName})` : ""}`,
    })),
    classrooms: ctx.classrooms,
  };
}

export class MasterApplyError extends Error {
  constructor(
    message: string,
    public preview?: MasterPreview,
  ) {
    super(message);
  }
}

/** Existing RPCs + blocks + names + groups + roster commit together or all roll back. */
export async function applyMasterTransaction(
  sql: postgres.Sql,
  actor: MasterActor,
  input: MasterInput,
  grids: MasterGrids,
  source: MasterPlan["source"],
  hash: string,
  acknowledgements: string[],
) {
  return sql.begin("isolation level serializable", async (tx) => {
    await lockAttendanceMigration(tx);
    await tx`select pg_advisory_xact_lock(hashtextextended(${`${actor.tenantId}:english-master`},0))`;
    await tx`set local timezone to 'Asia/Seoul'`;
    await tx`select set_config('request.jwt.claims',${JSON.stringify({ sub: actor.id, role: "authenticated" })},true)`;
    const [owner] =
      await tx`select id from users where id=${actor.id} and tenant_id=${actor.tenantId} and status='active'`;
    if (!owner) throw new Error("로그인 정보를 다시 확인해 주세요.");
    const ctx = await loadMasterContext(
      tx,
      actor.tenantId,
      input.effectiveDate,
    );
    const plan = masterPreview(input, grids, ctx, source);
    if (plan.hash !== hash)
      throw new MasterApplyError(
        "시트 또는 에이와 정보가 변경되었습니다. 새 미리보기를 확인해 주세요.",
        plan,
      );
    if (plan.issues.some((i) => i.severity === "error"))
      throw new MasterApplyError(
        "적용할 수 없는 항목을 수정한 뒤 다시 검사해 주세요.",
        plan,
      );
    const needed = plan.issues
      .filter((i) => i.severity === "confirm")
      .map((i) => i.key)
      .sort();
    if (
      JSON.stringify(needed) !==
      JSON.stringify([...new Set(acknowledgements)].sort())
    )
      throw new MasterApplyError(
        "확인이 필요한 항목을 모두 확인해 주세요.",
        plan,
      );
    const date = input.effectiveDate;
    const [clock] = await tx<
      { today: string }[]
    >`select (now() at time zone 'Asia/Seoul')::date::text as today`;
    if (date < clock!.today)
      throw new MasterApplyError(
        "날짜가 바뀌었습니다. 적용일을 오늘 이후로 바꾸고 다시 검사해 주세요.",
        plan,
      );
    // No later row may be overwritten by a monthly replacement.
    if (
      ctx.schedules.some(
        (s) =>
          ctx.classes.some((c) => c.id === s.classId) && s.validFrom > date,
      ) ||
      ctx.blocks.some((b) => b.validFrom > date)
    )
      throw new Error(
        "적용일 이후에 시작하는 배치가 있습니다. 기존 예약을 먼저 정리해 주세요.",
      );
    const changed = plan.report.planItems.filter((p) => p.action !== "keep");
    const closes = changed
      .filter((p) => p.scheduleId)
      .map((p) => ({
        id: p.scheduleId!,
        prevValidTo:
          ctx.schedules.find((s) => s.id === p.scheduleId)?.validTo ?? null,
      }));
    const inserts = changed
      .filter(
        (p) => (p.action === "create" || p.action === "update") && p.classId,
      )
      .map((p) => ({
        id: randomUUID(),
        classId: p.classId!,
        day: p.day,
        startTime: p.startTime,
        endTime: p.endTime,
        teacherId: p.teacherId ?? null,
        classroomId: p.classroomId ?? null,
        slotTeacherLabel: p.teacherNames[0] ?? null,
        slotRoomLabel: p.room,
        validTo: null,
      }));
    const beforeBlocks =
      await tx`select * from teacher_schedule_blocks where tenant_id=${actor.tenantId} and subject='english' and (valid_to is null or valid_to>=${date}::date)`;
    const blockIds = plan.blocks.map(() => randomUUID());
    const attendance = attendanceBackups(
      plan.attendanceMigration.moves,
      ctx.attendance,
    );
    const terms = await prepareClassTerms(tx, actor.tenantId,
      (plan.termClosures ?? []).map((t) => ({ classId: t.classId, date: t.closedAt, name: t.toName })),
      plan.roster.moves.map((m) => m.enrollmentId));
    const payload = {
      label: `영어 시트 반영 ${date} (${input.teacherTab})`,
      hash,
      summary: plan.report.plan,
      closes,
      inserts,
      classUpdates: plan.classUpdates,
      planItems: plan.report.planItems,
      integrationGroups: {
        subject: "english",
        groups: plan.groups,
        from: ctx.groups,
        showOthers: true,
      },
      masterSource: {
        ...source,
        version: 3,
        terms,
        attendance,
        beforeBlocks,
        blockIds,
        acknowledgements,
      },
    };
    await applyClassTerms(tx, actor, terms);
    const [applied] = await tx<
      { r: { snapshotId: string; closed: number; inserted: number } }[]
    >`select public.apply_english_structure(${tx.json(payload as never)}::jsonb,${date}::date) as r`;
    const snapshotId = applied!.r.snapshotId;
    await tx`delete from teacher_schedule_blocks where tenant_id=${actor.tenantId} and subject='english' and valid_from=${date}::date`;
    await tx`update teacher_schedule_blocks set valid_to=${shiftDays(date, -1)}::date where tenant_id=${actor.tenantId} and subject='english' and valid_from<${date}::date and (valid_to is null or valid_to>=${date}::date)`;
    for (const [i, b] of plan.blocks.entries()) {
      const teacher = ctx.teachers.find((t) =>
        [t.englishName, t.displayName].some(
          (n) => n?.toLowerCase() === b.teacherName.toLowerCase(),
        ),
      );
      await tx`insert into teacher_schedule_blocks(id,tenant_id,subject,teacher_label,teacher_id,day_of_week,start_time,end_time,kind,label,valid_from) values(${blockIds[i]!},${actor.tenantId},'english',${b.teacherName},${teacher?.id ?? null},${b.day}::day_of_week,${b.startTime}::time,${b.endTime}::time,${b.kind},${b.label},${date}::date)`;
    }
    let rosterSnapshotId: string | null = null;
    const diff = structuredClone(plan.roster);
    if (diff.moves.length || diff.adds.length) {
      const [snap] = await tx<
        { id: string }[]
      >`insert into timetable_snapshots(tenant_id,label,reference_date,summary,payload,created_by) values(${actor.tenantId},${`영어 시트 명단 ${date}`},${date}::date,${tx.json({ moves: diff.moves.length, adds: diff.adds.length, removes: 0 })},${tx.json(diff as never)},${actor.id}) returning id`;
      rosterSnapshotId = snap!.id;
      if (diff.moves.length) {
        const moves = diff.moves.map((m) => ({
          enrollmentId: m.enrollmentId,
          newClassId: m.toClassId,
          attendanceDays:
            ctx.enrollments.find((e) => e.id === m.enrollmentId)
              ?.attendanceDays ?? [],
        }));
        const [result] = await tx<
          {
            r: {
              enrollmentId: string;
              newEnrollmentId?: string;
              ok: boolean;
              error?: string;
            }[];
          }[]
        >`select public.move_enrollments_batch(p_moves=>${tx.json(moves)},p_effective_date=>${date}::date) as r`;
        if (result!.r.length !== moves.length)
          throw new Error(
            "학생 이동 결과가 요청과 다릅니다. 전체 반영을 취소했습니다.",
          );
        for (const r of result!.r) {
          const m = diff.moves.find((m) => m.enrollmentId === r.enrollmentId)!;
          if (!r.ok || !r.newEnrollmentId)
            throw new Error(
              `${m.studentName} 이동 실패: ${r.error ?? "새 수강을 만들지 못했습니다"}`,
            );
          m.newEnrollmentId = r.newEnrollmentId;
        }
      }
      for (const a of diff.adds) {
        const [row] = await tx<
          { id: string }[]
        >`insert into enrollments(tenant_id,student_id,class_id,start_date,on_hold) values(${actor.tenantId},${a.studentId},${a.classId},${date}::date,${enrollmentOnHoldForStatus(ctx.students.find((s) => s.studentId === a.studentId)?.status)}) returning id`;
        a.enrollmentId = row!.id;
      }
      await tx`update timetable_snapshots set payload=${tx.json(diff as never)} where id=${rosterSnapshotId} and tenant_id=${actor.tenantId}`;
      await tx`insert into timetable_import_logs(tenant_id,week_label,snapshot_id,result,details,actor_id) values(${actor.tenantId},${date},${rosterSnapshotId},${tx.json({ moved: diff.moves.length, added: diff.adds.length, removed: 0 })},${tx.json(diff as never)},${actor.id})`;
    }
    await applyAttendanceMoves(tx, actor.tenantId, attendance);
    await tx`update timetable_snapshots set payload=jsonb_set(payload,'{apply,masterSource,rosterSnapshotId}',${tx.json(rosterSnapshotId)},true) where id=${snapshotId} and tenant_id=${actor.tenantId}`;
    if (date === clock!.today) {
      for (const u of plan.classUpdates) {
        if (u.className) {
          const changed =
            await tx`update classes set class_name=${u.className} where tenant_id=${actor.tenantId} and id=${u.classId} and class_name=${u.prevClassName ?? ""} returning id`;
          if (changed.length !== 1)
            throw new Error(
              "반 이름이 변경되어 전체 반영을 중단했습니다. 다시 검사해 주세요.",
            );
        }
        const changes = [
          ...(u.className
            ? [{ field: "반 이름", from: u.prevClassName, to: u.className }]
            : []),
          ...(u.teacherId
            ? [{ field: "담임", from: u.prevTeacherId, to: u.teacherId }]
            : []),
          ...(u.classroomId
            ? [{ field: "강의실", from: u.prevClassroomId, to: u.classroomId }]
            : []),
        ];
        await tx`insert into audit_logs(tenant_id,actor_id,actor_name,action,target_type,target_label,metadata) values(${actor.tenantId},${actor.id},${actor.displayName},'class_update','class',${u.className ?? ctx.classes.find((c) => c.id === u.classId)?.className ?? ""},${tx.json({ classId: u.classId, changes, snapshotId })})`;
      }
      await tx`update tenant_settings set data=jsonb_set(data,'{operations,subjects}',(select jsonb_agg(case when s->>'key'='english' then s||${tx.json({ integrationGroupsEnabled: true, integrationGroups: plan.groups, integrationShowOthers: true })}::jsonb else s end order by ord) from jsonb_array_elements(data->'operations'->'subjects') with ordinality t(s,ord))) where tenant_id=${actor.tenantId}`;
      await tx`insert into timetable_import_logs(tenant_id,week_label,snapshot_id,result,actor_id) values(${actor.tenantId},${date},${snapshotId},${tx.json({ kind: CLASS_UPDATES_APPLIED_KIND })},${actor.id})`;
    }
    await tx`insert into audit_logs(tenant_id,actor_id,actor_name,action,target_type,target_label,metadata) values(${actor.tenantId},${actor.id},${actor.displayName},'timetable_structure_apply','timetable','영어 시트 반영',${tx.json({ snapshotId, rosterSnapshotId, effectiveDate: date, scheduled: date > clock!.today, closed: applied!.r.closed, inserted: applied!.r.inserted, source, acknowledgedConflicts: acknowledgements.length, attendanceCells: plan.attendanceMigration.moves.length, attendanceRecords: attendance.length })})`;
    return {
      snapshotId,
      rosterSnapshotId,
      effectiveDate: date,
      scheduled: date > clock!.today,
      closed: applied!.r.closed,
      inserted: applied!.r.inserted,
      moved: diff.moves.length,
      added: diff.adds.length,
      attendanceCells: plan.attendanceMigration.moves.length,
      closedClasses: terms.length,
    };
  });
}

/** Used by the existing date badge too: restore non-lesson blocks in the same transaction. */
export async function rollbackMasterBlocks(
  tx: postgres.TransactionSql,
  tenant: string,
  snapshotId: string,
  actor?: MasterActor,
) {
  const [snap] = await tx<
    {
      source: {
        blockIds: string[];
        beforeBlocks: postgres.Row[];
        attendance?: AttendanceBackup[];
        terms?: TermBackup[];
      } | null;
    }[]
  >`select payload->'apply'->'masterSource' as source from timetable_snapshots where id=${snapshotId} and tenant_id=${tenant}`;
  if (!snap?.source) return;
  const [restored] =
    await tx`select id from timetable_import_logs where tenant_id=${tenant} and snapshot_id=${snapshotId} and restored_at is not null`;
  if (restored) return;
  if (snap.source.terms?.length) {
    if (!actor) throw new Error("종강 예약을 취소할 사용자 정보를 확인해 주세요.");
    await rollbackClassTerms(tx, actor, snap.source.terms);
  }
  const firstAttendanceDate = (snap.source.attendance ?? []).map((row) => String(row.before.session_date)).sort()[0];
  const nativeLinks = firstAttendanceDate ? await nativeAttendanceLinks(firstAttendanceDate) : [];
  await rollbackAttendanceMoves(tx, tenant, snap.source.attendance ?? [], nativeLinks);
  if (snap.source.blockIds.length)
    await tx`delete from teacher_schedule_blocks where tenant_id=${tenant} and id=any(${snap.source.blockIds}::uuid[])`;
  for (const row of snap.source.beforeBlocks) {
    await tx`insert into teacher_schedule_blocks select * from jsonb_populate_record(null::teacher_schedule_blocks,${tx.json(row)}) on conflict(id) do update set valid_to=excluded.valid_to where teacher_schedule_blocks.tenant_id=${tenant}`;
  }
}

export async function cancelMasterDate(
  sql: postgres.Sql,
  actor: MasterActor,
  date: string,
) {
  return sql.begin("isolation level serializable", async (tx) => {
    await lockAttendanceMigration(tx);
    await tx`select pg_advisory_xact_lock(hashtextextended(${`${actor.tenantId}:english-master`},0))`;
    await tx`set local timezone to 'Asia/Seoul'`;
    await tx`select set_config('request.jwt.claims',${JSON.stringify({ sub: actor.id, role: "authenticated" })},true)`;
    const [owner] =
      await tx`select id from users where id=${actor.id} and tenant_id=${actor.tenantId} and status='active'`;
    if (!owner) throw new Error("로그인 정보를 다시 확인해 주세요.");
    const [clock] = await tx<
      { today: string }[]
    >`select (now() at time zone 'Asia/Seoul')::date::text as today`;
    if (date <= clock!.today)
      throw new Error("이미 시작된 변경은 예약 취소할 수 없습니다.");
    const snapshots = await tx<
      { id: string; kind: string | null }[]
    >`select s.id,s.payload->>'kind' as kind from timetable_snapshots s where s.tenant_id=${actor.tenantId} and s.reference_date=${date}::date and not exists(select 1 from timetable_import_logs l where l.tenant_id=${actor.tenantId} and l.snapshot_id=s.id and l.restored_at is not null) order by s.created_at desc,(s.payload ? 'kind') asc,s.id desc`;
    for (const snap of snapshots) {
      if (snap.kind) {
        await rollbackMasterBlocks(tx, actor.tenantId, snap.id, actor);
        await tx`select rollback_english_structure(${snap.id}::uuid)`;
      } else {
        const [r] = await tx<
          { r: { skipped?: number } }[]
        >`select rollback_enrollment_import(${snap.id}::uuid) as r`;
        if (r?.r.skipped)
          throw new Error(
            "이미 시작된 수강이 있어 전체 예약 취소를 중단했습니다. 학생 수강 내역을 확인해 주세요.",
          );
      }
    }
    await tx`insert into audit_logs(tenant_id,actor_id,actor_name,action,target_type,target_label,metadata) values(${actor.tenantId},${actor.id},${actor.displayName},'timetable_structure_rollback','timetable','영어 시트 예약 취소',${tx.json({ effectiveDate: date, snapshotIds: snapshots.map((s) => s.id) })})`;
    return { snapshots: snapshots.length };
  });
}
