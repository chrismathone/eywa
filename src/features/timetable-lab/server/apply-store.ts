import 'server-only';
import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { openMasterDb } from '@/features/timetable/server/master-sheet-store';
import { lockAttendanceMigration, loadAttendanceLinks } from '@/features/timetable/server/master-sheet-attendance';
import { mergeViewPrefs, parseViewPrefs, serializeViewPrefs, type TimetableViewPrefs } from '@/features/timetable/lib/view-prefs';
import { mergeMovedTeacherOrder } from '../teacher-order-merge';
import { teacherColumns } from '../editor/teachers';
import { appearanceOf } from '../editor/appearance';
import { timeLabel, type Draft } from '../editor/model';
import { buildApplyPlan, type ApplyPlan } from '../apply-plan';
import { rebaseDraft } from '../apply-rebase';
import { fingerprint, contextFingerprint, readApplyContext, type ApplyContext } from './apply-context';
import { shiftDays } from '@/features/timetable/lib/week';
import { parseEditorViewPref, type TimetableEditorView } from '@/features/timetable/lib/editor-view-prefs';

export type ApplyJob = { id: string; tenant_id: string; actor_id: string; actor_role: string; policy_hash: string; baseline_hash: string; request_hash: string; effective_date: string; apply_at: string; payload: Draft; status: string; summary: { teacherNames?: number; students?: number } | null };
export const policyHash = (settings: Record<string, unknown>, role: string) => fingerprint({ role, permissions: settings.permissions, modules: settings.modules });
const equal = (a: unknown, b: unknown) => fingerprint(a ?? null) === fingerprint(b ?? null);

export async function lockLabApply(tx: postgres.TransactionSql) {
  await lockAttendanceMigration(tx);
  await tx`lock table makeup_cases,makeup_sessions,makeup_participants,seat_period_pins,seat_period_moves in share mode`;
}

/** 다른 화면·과목을 지우지 않고 변경한 표시 항목만 저장한다. */
export function appliedViewPatch(draft: Draft, raw: unknown, slotIds: Map<string, string>): Partial<TimetableViewPrefs> {
  const current = parseViewPrefs(raw), initial = draft.source?.initialAppearance, wanted = appearanceOf(draft);
  const patch: Partial<TimetableViewPrefs> = {}, view: TimetableEditorView = {};
  if (!initial) throw new Error('표시 설정의 원본이 없습니다. 시간표를 다시 불러와 주세요.');
  if (wanted.hideStudents !== initial.hideStudents) patch.hideStudents = wanted.hideStudents;
  if (wanted.hideEmptyDays !== initial.hideEmptyDays) patch.hideEmptyDays = wanted.hideEmptyDays;
  for (const key of ['hidePeriods', 'hideSaturday', 'showSunday'] as const) if (!!wanted[key] !== !!initial[key]) view[key] = !!wanted[key];
  if (!equal(wanted.groups, initial.groups)) view.groups = wanted.groups;
  if ((wanted.scale ?? 1) !== (initial.scale ?? 1)) view.scale = wanted.scale ?? 1;
  const colors = Object.fromEntries(Object.entries(wanted.teacherColors).filter(([name, color]) => !equal(color, initial.teacherColors[name])));
  if (Object.keys(colors).length) view.teacherColors = colors;
  const originalOrder = draft.source?.initialTeacherOrder ?? [], desiredOrder = teacherColumns(draft);
  if (!equal(originalOrder, desiredOrder)) patch.teacherOrder = { english: { teacherview: mergeMovedTeacherOrder(current.teacherOrder?.english?.teacherview ?? originalOrder, originalOrder, desiredOrder) } };
  const metadata: NonNullable<TimetableEditorView['slotMetadata']> = {};
  for (const item of draft.placements) {
    const id = slotIds.get(item.id) ?? item.sourceScheduleId;
    if (!id) continue;
    const wanted = { note: item.note ?? '', locked: !!item.locked };
    const before = item.sourceScheduleId ? draft.source?.initialSlotMetadata?.[item.sourceScheduleId] : undefined;
    if (!equal(wanted, before ?? { note: '', locked: false })) metadata[id] = wanted;
    else if (slotIds.has(item.id) && item.sourceScheduleId) metadata[id] = current.editorView?.english?.slotMetadata?.[item.sourceScheduleId] ?? wanted;
  }
  if (Object.keys(metadata).length) view.slotMetadata = metadata;
  if (Object.keys(metadata).length > 5000) throw new Error('수업 메모가 너무 많습니다. 연습본을 다시 확인해 주세요.');
  if (Object.keys(view).length) {
    if (!parseEditorViewPref({ english: view })) throw new Error('반 배치·색상·수업 메모의 형식을 확인해 주세요.');
    patch.editorView = { english: view };
  }
  return patch;
}

export async function validateOperatingLinks(tx: postgres.TransactionSql, tenant: string, date: string, plan: ApplyPlan) {
  const scheduleClasses = new Set([...plan.schedules.map(row => row.item.classId), ...plan.removedSchedules.map(row => row.classId), ...plan.closedClasses.map(row => row.id)]);
  const rosterPairs = new Set(plan.enrollments.filter(row => row.before).map(row => `${row.classId}:${row.studentId}`));
  const structuralClasses = [...new Set([...scheduleClasses, ...plan.classes.filter(row => row.before && row.teacherId !== row.before.teacherId).map(row => row.id)])];
  if (structuralClasses.length) {
    const pendingTeacher = await tx`select id from classes where tenant_id=${tenant} and id=any(${structuralClasses}::uuid[]) and pending_teacher_id is not null limit 1`;
    if (pendingTeacher.length) throw new Error('변경할 반에 인수인계 예약이 있습니다. 반 정보를 먼저 확인해 주세요.');
  }
  if (!scheduleClasses.size && !rosterPairs.size && !plan.classes.length) return;
  const pending = await tx`select id from timetable_snapshots s where tenant_id=${tenant} and reference_date>=${date}::date and reference_date>(now() at time zone 'Asia/Seoul')::date and payload->>'kind'='english_structure' and not exists(select 1 from timetable_import_logs l where l.tenant_id=${tenant} and l.snapshot_id=s.id and l.restored_at is not null) limit 1`;
  if (pending.length) throw new Error('적용일 이후 시간표 가져오기 예약이 있습니다. 기존 예약을 먼저 확인해 주세요.');
  const attendance = await tx<{ classId: string; studentId: string }[]>`select class_id as "classId",student_id as "studentId" from attendance_records where tenant_id=${tenant} and session_date>=${date}::date`;
  const links = await loadAttendanceLinks(tx, tenant, date);
  if ([...attendance, ...links].some(row => scheduleClasses.has(row.classId) || rosterPairs.has(`${row.classId}:${row.studentId}`))) throw new Error('적용일 이후 출결·보고서·보강 예약이 연결되어 있습니다. 기록을 확인하거나 적용일을 뒤로 바꿔 주세요.');
  const nativeLinks = await tx<{ classId: string | null; studentId: string | null }[]>`
    select original_class_id as "classId",student_id as "studentId" from makeup_cases where tenant_id=${tenant} and original_date>=${date}::date and lifecycle<>'closed'
    union all select class_id,null::uuid from makeup_sessions where tenant_id=${tenant} and session_date>=${date}::date and state in ('confirmed','finished')
    union all select anchor_class_id,student_id from makeup_participants where tenant_id=${tenant} and session_date>=${date}::date and status<>'cancelled'
    union all select class_id,student_id from seat_period_pins where tenant_id=${tenant}
    union all select class_id,student_id from seat_period_moves where tenant_id=${tenant} and session_date>=${date}::date`;
  if (nativeLinks.some(row => !!row.classId && (scheduleClasses.has(row.classId) || rosterPairs.has(`${row.classId}:${row.studentId}`)))) throw new Error('변경할 반이나 학생에 보강 일정·교시 고정·자리 이동이 연결되어 있습니다. 해당 내역을 먼저 확인해 주세요.');
}

async function commitPlan(tx: postgres.TransactionSql, job: ApplyJob, context: ApplyContext, plan: ApplyPlan, skipped: string[]) {
  const tenant = job.tenant_id, date = job.effective_date, dayBefore = shiftDays(date, -1), draft = job.payload;
  const actor = context.people.find(person => person.id === job.actor_id)!;
  const slotIds = new Map<string, string>(), studentIds = new Map<string, string>();
  for (const person of plan.people) await tx`update users set display_name=${person.name} where tenant_id=${tenant} and id=${person.id} and display_name=${person.beforeName}`;
  for (const student of plan.students) {
    if (student.beforeName === null) {
      const id = student.id.slice(4); studentIds.set(student.id, id);
      const assigned = draft.placements.some(item => item.studentIds?.includes(student.id)) || Object.values(draft.students).some(students => students.includes(student.id));
      await tx`insert into students(id,tenant_id,name,school,grade,status,enrolled_at) values(${id},${tenant},${student.name},${student.school},${student.grade},${assigned ? 'enrolled' : 'prospect'}::student_status,${assigned ? date : null}::date)`;
    } else await tx`update students set name=${student.name},updated_at=now() where tenant_id=${tenant} and id=${student.id} and name=${student.beforeName}`;
  }
  for (const group of plan.classes) {
    if (!group.before) await tx`insert into classes(id,tenant_id,class_name,subject,teacher_id,classroom_id,bg_color,text_color) values(${group.id},${tenant},${group.name},'english',${group.teacherId},${group.roomId},${group.bg},${group.text})`;
    else await tx`update classes set class_name=${group.name},teacher_id=${group.teacherId},bg_color=${group.bg},text_color=${group.text} where tenant_id=${tenant} and id=${group.id} and subject='english'`;
  }
  for (const group of plan.closedClasses) await tx`update classes set closed_at=${dayBefore}::date where tenant_id=${tenant} and id=${group.id} and subject='english'`;
  const closeSchedule = async (row: { id: string; validFrom: string }) => {
    if (row.validFrom >= date) await tx`delete from class_schedules where tenant_id=${tenant} and id=${row.id} and valid_from>=${date}::date`;
    else await tx`update class_schedules set valid_to=${dayBefore}::date where tenant_id=${tenant} and id=${row.id}`;
  };
  for (const row of plan.removedSchedules) await closeSchedule(row);
  for (const row of plan.schedules) {
    if (row.before) await closeSchedule(row.before);
    const id = randomUUID(); slotIds.set(row.item.id, id);
    await tx`insert into class_schedules(id,tenant_id,class_id,day_of_week,start_time,end_time,valid_from,valid_to,teacher_id,classroom_id,slot_teacher_label,slot_room_label,lab_separate,merge_group,period_label) values(${id},${tenant},${row.item.classId},${row.day}::day_of_week,${timeLabel(row.item.start)}::time,${timeLabel(row.item.end)}::time,${date}::date,${row.before?.validTo ?? null}::date,${row.teacherId},${row.roomId},${row.teacherLabel},${row.roomLabel},${row.item.teacher === 'LAB' && !!row.item.labSeparate},${row.before?.mergeGroup ?? null},${row.before?.periodLabel ?? null})`;
  }
  const closeBlock = async (row: { id: string; validFrom: string }) => {
    if (row.validFrom >= date) await tx`delete from teacher_schedule_blocks where tenant_id=${tenant} and id=${row.id} and subject='english'`;
    else await tx`update teacher_schedule_blocks set valid_to=${dayBefore}::date where tenant_id=${tenant} and id=${row.id} and subject='english'`;
  };
  for (const row of plan.removedBlocks) await closeBlock(row);
  for (const row of plan.blocks) {
    if (row.before) await closeBlock(row.before);
    const id = randomUUID(); slotIds.set(row.item.id, `block:${id}`);
    await tx`insert into teacher_schedule_blocks(id,tenant_id,subject,teacher_label,teacher_id,day_of_week,start_time,end_time,kind,label,valid_from,valid_to) values(${id},${tenant},'english',${row.teacherLabel},${row.teacherId},${row.day}::day_of_week,${timeLabel(row.item.start)}::time,${timeLabel(row.item.end)}::time,${row.before?.kind ?? 'meeting'},${row.item.name},${date}::date,${row.before?.validTo ?? null}::date)`;
  }
  // 기존 수강은 날짜로 종료하고 새 수강을 만든다. 급여 티어·보류 상태를 유지하고 기록 식별자를 바꾸지 않는다.
  for (const row of plan.enrollments) if (row.before) await tx`update enrollments set end_date=${date}::date,is_transferred=true where tenant_id=${tenant} and id=${row.before.id}`;
  for (const row of plan.enrollments) {
    if (row.remove) continue;
    const source = row.before ?? plan.enrollments.find(other => other.studentId === row.studentId && other.before && other.remove)?.before;
    await tx`insert into enrollments(tenant_id,student_id,class_id,start_date,end_date,on_hold,is_transferred_in,attendance_days,salary_tier) values(${tenant},${studentIds.get(row.studentId) ?? row.studentId},${row.classId},${date}::date,${row.before?.end ?? null}::date,${source?.hold ?? false},${!!source},${row.days}::text[],${source?.salaryTier ?? null})`;
  }
  const [user] = await tx<{ prefs: Record<string, unknown> | null }[]>`select ui_prefs as prefs from users where tenant_id=${tenant} and id=${job.actor_id} for update`;
  if (!user) throw new Error('계정 정보를 다시 확인해 주세요.');
  const raw = user.prefs ?? {}, patch = appliedViewPatch(draft, raw, slotIds), prefs = serializeViewPrefs(mergeViewPrefs(parseViewPrefs(raw), patch));
  await tx`update users set ui_prefs=${tx.json({ ...raw, timetable: prefs } as never)}::jsonb where tenant_id=${tenant} and id=${job.actor_id}`;
  const result = { ...plan.summary, skipped, effectiveDate: date, appliedAt: new Date().toISOString() };
  await tx`insert into audit_logs(tenant_id,actor_id,actor_name,action,target_type,target_label,metadata) values(${tenant},${job.actor_id},${actor.name},'timetable_structure_apply','timetable','시간표 연습본 적용',${tx.json({ jobId: job.id, ...result } as never)}::jsonb)`;
  // 실제로 넣은 새 수업만 남긴다 — 이번에 제외된 수업은 충돌이 풀리면 다시 넣을 수 있어야 한다(`appliedNewIds`).
  const newLessonIds = [...plan.schedules, ...plan.blocks].flatMap(row => row.before ? [] : [row.item.id]);
  await tx`update timetable_lab_apply_jobs set status='applied',finished_at=now(),result=${tx.json({ ...result, newLessonIds })}::jsonb,error=null where tenant_id=${tenant} and id=${job.id} and status='pending'`;
  return result;
}

/** 실행 시간을 DB에서 확인하고, 작업 잠금·검증·운영 변경·완료 기록을 한 트랜잭션에서 처리한다. */
export async function runApplyJob(id: string) {
  const sql = openMasterDb();
  let jobTenant: string | null = null;
  try {
    return await sql.begin('isolation level serializable', async tx => {
      await lockLabApply(tx);
      const [job] = await tx<ApplyJob[]>`select *,effective_date::text,apply_at::text from timetable_lab_apply_jobs where id=${id} and status='pending' and apply_at<=now() for update skip locked`;
      if (!job) return null;
      jobTenant = job.tenant_id;
      const [clock] = await tx<{ today: string }[]>`select (now() at time zone 'Asia/Seoul')::date::text as today`;
      if (job.effective_date < clock!.today) throw new Error('예약 적용일이 지났습니다. 날짜를 다시 선택해 적용해 주세요.');
      await tx`select pg_advisory_xact_lock(hashtextextended(${`${job.tenant_id}:english-master`},0))`;
      await tx`set local timezone to 'Asia/Seoul'`;
      await tx`select set_config('request.jwt.claims',${JSON.stringify({ sub: job.actor_id, role: 'authenticated' })},true)`;
      const context = await readApplyContext(tx, job.tenant_id), actor = context.people.find(person => person.id === job.actor_id);
      if (!actor || actor.status !== 'active' || actor.role !== job.actor_role || policyHash(context.settings, actor.role) !== job.policy_hash) throw new Error('예약 이후 계정 또는 권한이 변경되었습니다. 다시 확인해 주세요.');
      if (job.payload.source?.tenantId !== job.tenant_id) throw new Error('현재 학원의 시간표만 적용할 수 있습니다.');
      // 예약 뒤에 운영이 바뀌어도 막지 않는다 — 실행 시점의 최신 자료로 다시 맞춘다.
      const latest = rebaseDraft(job.payload, context, job.effective_date, contextFingerprint(context) !== job.payload.source?.baselineHash);
      const plan = buildApplyPlan(latest.draft, latest.context, job.effective_date);
      // 강사·학생 이름 변경은 예약할 때 권한을 봤다 — 그때보다 늘면 권한을 지나지 않은 쓰기다.
      if (plan.people.length > (job.summary?.teacherNames ?? 0) || plan.students.length > (job.summary?.students ?? 0)) throw new Error('예약 이후 강사·학생 이름 변경 내용이 달라졌습니다. 다시 검사해 주세요.');
      await validateOperatingLinks(tx, job.tenant_id, job.effective_date, plan);
      return await commitPlan(tx, { ...job, payload: latest.draft }, context, plan, latest.skipped);
    });
  } catch (error) {
    const message = error instanceof Error && !('code' in error) ? error.message : '자료가 변경되었거나 저장에 실패했습니다. 다시 불러와 확인해 주세요.';
    if (jobTenant) await sql`update timetable_lab_apply_jobs set status='failed',finished_at=now(),error=${message} where tenant_id=${jobTenant} and id=${id} and status='pending'`;
    throw new Error(message);
  } finally { await sql.end({ timeout: 5 }); }
}
