import 'server-only';
import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { openMasterDb } from '@/features/timetable/server/master-sheet-store';

export type LabSql = postgres.Sql | postgres.TransactionSql;
export type NativeClass = { id: string; name: string; teacherId: string | null; roomId: string | null; active: boolean; closedAt: string | null; bg: string | null; text: string | null; special?: boolean | null };
export type NativeSchedule = { id: string; classId: string; day: string; start: string; end: string; teacherId: string | null; roomId: string | null; teacherLabel: string | null; roomLabel: string | null; validFrom: string; validTo: string | null; labSeparate: boolean | null; mergeGroup: string | null; periodLabel: string | null };
export type NativeEnrollment = { id: string; studentId: string; classId: string; start: string; end: string | null; hold: boolean; transferred: boolean; days: string[] | null; salaryTier: string | null };
export type NativePerson = { id: string; name: string; englishName: string | null; role: string; status: string; bg: string | null; text: string | null };
export type NativeStudent = { id: string; name: string; school: string | null; grade: string | null; status: string };
export type NativeBlock = { id: string; teacherLabel: string; teacherId: string | null; day: string; start: string; end: string; kind: string; label: string; validFrom: string; validTo: string | null };
export type OutsideSlot = { id: string; classId: string; name: string; teacher: string; teacherId: string | null; room: string; roomId: string | null; day: string; start: string; end: string; validFrom: string; validTo: string | null; students: string[] };
export type ApplyContext = { classes: NativeClass[]; schedules: NativeSchedule[]; enrollments: NativeEnrollment[]; people: NativePerson[]; students: NativeStudent[]; rooms: { id: string; name: string }[]; blocks: NativeBlock[]; outside?: OutsideSlot[]; settings: Record<string, unknown>;
  /** 앞선 적용으로 운영에 들어간 새 수업의 연습본 식별자 — 운영에서 옮겨졌어도 다시 넣지 않는다. */ appliedNewIds?: string[] };

export function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, stableValue(value)]));
  return value;
}
export const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');

/** 개인 표시 설정·새 출결은 원본 버전에 포함하지 않는다. 버전이 달라도 막지 않고 최신 자료로 다시 맞춘다(apply-rebase). */
export async function readApplyContext(sql: LabSql, tenant: string): Promise<ApplyContext> {
  const [classes, schedules, enrollments, people, students, rooms, blocks, settings, outside, outsideBlocks, applied] = await Promise.all([
    sql<NativeClass[]>`select id,class_name as name,teacher_id as "teacherId",classroom_id as "roomId",is_active as active,closed_at::text as "closedAt",bg_color as bg,text_color as text,is_special as special from classes where tenant_id=${tenant} and subject='english' order by id`,
    sql<NativeSchedule[]>`select s.id,s.class_id as "classId",s.day_of_week as day,to_char(s.start_time,'HH24:MI') as start,to_char(s.end_time,'HH24:MI') as end,s.teacher_id as "teacherId",s.classroom_id as "roomId",s.slot_teacher_label as "teacherLabel",s.slot_room_label as "roomLabel",s.valid_from::text as "validFrom",s.valid_to::text as "validTo",s.lab_separate as "labSeparate",s.merge_group as "mergeGroup",s.period_label as "periodLabel" from class_schedules s join classes c on c.id=s.class_id and c.tenant_id=s.tenant_id where s.tenant_id=${tenant} and c.subject='english' order by s.id`,
    sql<NativeEnrollment[]>`select e.id,e.student_id as "studentId",e.class_id as "classId",e.start_date::text as start,e.end_date::text as end,e.on_hold as hold,e.is_transferred as transferred,e.attendance_days as days,e.salary_tier as "salaryTier" from enrollments e join classes c on c.id=e.class_id and c.tenant_id=e.tenant_id where e.tenant_id=${tenant} and c.subject='english' order by e.id`,
    sql<NativePerson[]>`select id,display_name as name,english_name as "englishName",system_role as role,status,bg_color as bg,text_color as text from users where tenant_id=${tenant} order by id`,
    sql<NativeStudent[]>`select id,name,school,grade,status from students where tenant_id=${tenant} order by id`,
    sql<{ id: string; name: string }[]>`select id,name from classrooms where tenant_id=${tenant} order by id`,
    sql<NativeBlock[]>`select id,teacher_label as "teacherLabel",teacher_id as "teacherId",day_of_week as day,to_char(start_time,'HH24:MI') as start,to_char(end_time,'HH24:MI') as end,kind,label,valid_from::text as "validFrom",valid_to::text as "validTo" from teacher_schedule_blocks where tenant_id=${tenant} and subject='english' order by id`,
    sql<{ data: Record<string, unknown> }[]>`select data from tenant_settings where tenant_id=${tenant}`,
    sql<OutsideSlot[]>`select s.id,s.class_id as "classId",c.class_name as name,coalesce(s.slot_teacher_label,u.display_name,'담당 미정') as teacher,coalesce(s.teacher_id,c.teacher_id) as "teacherId",coalesce(s.slot_room_label,r.name,'') as room,coalesce(s.classroom_id,c.classroom_id) as "roomId",s.day_of_week as day,to_char(s.start_time,'HH24:MI') as start,to_char(s.end_time,'HH24:MI') as end,s.valid_from::text as "validFrom",s.valid_to::text as "validTo",array(select e.student_id::text from enrollments e where e.tenant_id=s.tenant_id and e.class_id=s.class_id and not e.on_hold and (e.end_date is null or e.end_date>=(now() at time zone 'Asia/Seoul')::date) and (s.valid_to is null or e.start_date<=s.valid_to) and (e.attendance_days is null or cardinality(e.attendance_days)=0 or s.day_of_week::text=any(e.attendance_days)) order by e.student_id) as students from class_schedules s join classes c on c.id=s.class_id and c.tenant_id=s.tenant_id left join users u on u.id=coalesce(s.teacher_id,c.teacher_id) and u.tenant_id=s.tenant_id left join classrooms r on r.id=coalesce(s.classroom_id,c.classroom_id) and r.tenant_id=s.tenant_id where s.tenant_id=${tenant} and c.subject<>'english' and c.is_active order by s.id`,
    sql<OutsideSlot[]>`select id,'' as "classId",label as name,teacher_label as teacher,teacher_id as "teacherId",'' as room,null::uuid as "roomId",day_of_week as day,to_char(start_time,'HH24:MI') as start,to_char(end_time,'HH24:MI') as end,valid_from::text as "validFrom",valid_to::text as "validTo",array[]::text[] as students from teacher_schedule_blocks where tenant_id=${tenant} and subject is distinct from 'english' order by id`,
    // 넣은 수업 기록이 없는 옛 적용은 저장본의 새 수업 전체로 읽는다.
    sql<{ id: string }[]>`select distinct n.id from timetable_lab_apply_jobs j cross join lateral jsonb_array_elements_text(coalesce(j.result->'newLessonIds',(select coalesce(jsonb_agg(p->'id'),'[]'::jsonb) from jsonb_array_elements(j.payload->'placements') p where coalesce(p->>'sourceScheduleId','')=''))) as n(id) where j.tenant_id=${tenant} and j.status='applied'`,
  ]);
  if (!settings[0]) throw new Error('학원 설정을 읽지 못했습니다. 다시 불러와 주세요.');
  return { classes, schedules, enrollments, people, students, rooms, blocks, outside: [...outside,...outsideBlocks], settings: settings[0].data, appliedNewIds: applied.map(row => row.id) };
}

export function contextFingerprint(context: ApplyContext) {
  const relevant = new Set(context.enrollments.map(row => row.studentId));
  // 다른 과목 명단은 날짜가 지나면 저절로 바뀌고 특강 표시·적용 이력은 판정 재료일 뿐이다 — '운영이 바뀌었다'로 세지 않는다.
  const classes = context.classes.map(row => ({ ...row, special: undefined })), outside = context.outside?.map(row => ({ ...row, students: [] }));
  return fingerprint({ ...context, appliedNewIds: undefined, classes, outside, students: context.students.filter(student => relevant.has(student.id)), settings: context.settings.operations ?? null });
}

export async function readApplyFingerprint(tenant: string) {
  const sql = openMasterDb();
  try { return contextFingerprint(await readApplyContext(sql, tenant)); }
  finally { await sql.end({ timeout: 5 }); }
}
