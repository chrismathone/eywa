'use server';

import { getCurrentUser } from '@/lib/auth/current-user';
import { canManageTenant } from '@/lib/auth/perm-matrix';
import { tenantViewWriteError } from '@/lib/auth/tenant-view';
import { logAction } from '@/features/audit/server/log';
import { canUseTimetableEditor } from './access';
import { draftSnapshotSchema, boundedJson } from '../draft-schema';
import { openMasterDb } from '@/features/timetable/server/master-sheet-store';
import { normalizeApplyTime } from '../apply-time';
import { buildApplyPlan } from '../apply-plan';
import { rebaseDraft } from '../apply-rebase';
import { readApplyContext, contextFingerprint, fingerprint } from './apply-context';
import { policyHash, runApplyJob, validateOperatingLinks, lockLabApply, appliedViewPatch } from './apply-store';
import { timeLabel } from '../editor/model';
import type { AttendanceMove } from '@/features/timetable/import/master/attendance-types';
import type { Draft } from '../editor/model';

export type ApplyReview = { hash: string; at: string; date: string; hour: number; summary: ReturnType<typeof buildApplyPlan>['summary']; changes: string[]; warnings: string[]; skipped: string[]; notices: string[] };
export type ApplyJobSummary = { id: string; at: string; status: 'pending' | 'applied' | 'failed' | 'cancelled'; error: string | null; skipped?: string[] };
type Request = { draft: Draft; date: string; hour: number };
const friendly = (error: unknown) => error instanceof Error && !('code' in error) ? error.message : '자료를 읽거나 저장하지 못했습니다. 잠시 후 다시 확인해 주세요.';

async function prepare(input: Request) {
  const user = await getCurrentUser();
  if (!user) throw new Error('로그인 후 다시 시도해 주세요.');
  // 운영 콘솔의 '지점 보기'(읽기 전용)에서는 적용하지 않는다 — 이 파일은 DB에 직접 접속해 데이터 접근 층의 쓰기 차단을 지나지 않는다.
  const viewError = await tenantViewWriteError();
  if (viewError) throw new Error(viewError);
  if (!(await canUseTimetableEditor(user.systemRole))) throw new Error('시간표와 반을 관리할 권한이 필요합니다.');
  if (!boundedJson(input.draft)) throw new Error('연습본이 너무 크거나 형식이 올바르지 않습니다.');
  const text = JSON.stringify(input.draft);
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error('연습본이 너무 크거나 형식이 올바르지 않습니다.');
  const parsed = draftSnapshotSchema.safeParse(input.draft);
  if (!parsed.success) throw new Error('연습본의 형식을 확인해 주세요.');
  const saved = parsed.data as Draft;
  if (saved.source?.tenantId !== user.tenantId) throw new Error('현재 학원의 시간표만 적용할 수 있습니다.');
  const time = normalizeApplyTime(input.date, input.hour);
  if ('error' in time) throw new Error(time.error);
  const sql = openMasterDb();
  try {
    const context = await readApplyContext(sql, user.tenantId), version = contextFingerprint(context);
    const latest = rebaseDraft(saved, context, time.date, version !== saved.source.baselineHash), draft = latest.draft;
    const plan = buildApplyPlan(draft, latest.context, time.date);
    if (plan.people.length && !(await canManageTenant(user.systemRole, 'staff'))) throw new Error('강사 이름 변경은 직원관리 권한이 필요합니다.');
    if (plan.students.length && !(await canManageTenant(user.systemRole, 'students'))) throw new Error('학생 등록·이름 변경은 원생관리 권한이 필요합니다.');
    const actor = context.people.find(person => person.id === user.id);
    if (!actor || actor.status !== 'active') throw new Error('현재 계정 정보를 다시 확인해 주세요.');
    const policy = policyHash(context.settings, actor.role);
    const [account] = await sql<{ prefs: unknown }[]>`select ui_prefs as prefs from users where tenant_id=${user.tenantId} and id=${user.id}`;
    const viewPatch = appliedViewPatch(draft,account?.prefs,new Map()), display = viewPatch.editorView?.english;
    const hash = fingerprint({ draft: saved, plan, skipped: latest.skipped, viewPatch, time, user: user.id, tenant: user.tenantId, policy });
    const changes = [
      ...plan.schedules.map(row => `${row.before ? '수업 변경' : '수업 추가'} · ${row.item.name} · ${row.item.day} ${timeLabel(row.item.start)}~${timeLabel(row.item.end)} · ${row.item.teacher}${row.item.labSeparate && row.item.teacher==='LAB' ? ' (*LAB)' : ''} · ${row.item.room || '강의실 미정'}`),
      ...plan.removedSchedules.map(row => `수업 삭제 · ${context.classes.find(group => group.id === row.classId)?.name ?? '반'}`),
      ...plan.classes.map(row => `${row.before ? '반 변경' : '반 등록'} · ${row.name}`),
      ...plan.closedClasses.map(row => `반 종료 · ${row.name}`),
      ...plan.enrollments.map(row => `${row.remove ? '수강 종료' : row.before ? '등원 요일 변경' : '학생 배정'} · ${draft.people?.[row.studentId] ?? '학생'} · ${context.classes.find(group => group.id === row.classId)?.name ?? plan.classes.find(group => group.id === row.classId)?.name ?? '반'}`),
      ...plan.people.map(row => `강사 이름 · ${row.beforeName} → ${row.name}`),
      ...plan.students.map(row => `${row.beforeName ? '학생 이름 변경' : '학생 등록'} · ${row.name}`),
      ...plan.blocks.map(row => `일정 변경 · ${row.item.name}`),
      ...plan.removedBlocks.map(row => `일정 삭제 · ${row.label}`),
      ...(display?.groups ? [`반 위치 · ${display.groups.groups.map(group=>group.classIds.map(id=>draft.classes?.[id]?.name??context.classes.find(row=>row.id===id)?.name??'반').join(' → ')).join(' / ')}`] : []),
      ...(viewPatch.teacherOrder?.english?.teacherview ? [`강사 순서 · ${viewPatch.teacherOrder.english.teacherview.join(' → ')}`] : []),
      ...Object.keys(display?.teacherColors??{}).map(name=>`강사 색상 · ${name}`),
      ...Object.keys(display?.slotMetadata??{}).map(id=>`수업 메모·잠금 · ${draft.placements.find(item=>item.sourceScheduleId===id)?.classId ? draft.cells[draft.placements.find(item=>item.sourceScheduleId===id)!.row][0].text : '일정'}`),
      ...(display?.hidePeriods!==undefined ? [`교시 ${display.hidePeriods?'접기':'펼치기'}`] : []),
      ...(display?.hideSaturday!==undefined ? [`토요일 ${display.hideSaturday?'숨기기':'보이기'}`] : []),
      ...(display?.showSunday!==undefined ? [`일요일 ${display.showSunday?'보이기':'숨기기'}`] : []),
      ...(display?.scale!==undefined ? [`시간표 크기 · ${Math.round(display.scale*100)}%`] : []),
      ...(viewPatch.hideStudents!==undefined ? [`학생 명단 ${viewPatch.hideStudents?'접기':'펼치기'}`] : []),
      ...(viewPatch.hideEmptyDays!==undefined ? [`빈 요일 ${viewPatch.hideEmptyDays?'접기':'펼치기'}`] : []),
    ];
    const review: ApplyReview = { hash, at: time.at, date: time.date, hour: time.hour, summary: plan.summary, changes, warnings: [...new Set(plan.warnings)], skipped: latest.skipped, notices: latest.notices };
    if (!changes.length) throw new Error(latest.skipped.length ? `적용할 변경 사항이 없습니다. ${latest.skipped.join(' ')}` : '적용할 변경 사항이 없습니다. 연습본을 수정한 뒤 검사해 주세요.');
    return { user, actorRole: actor.role, draft: saved, time, plan, context: latest.context, version, policy, review };
  } finally { await sql.end({ timeout: 5 }); }
}

export async function previewTimetableLabApply(input: Request): Promise<{ review: ApplyReview } | { error: string }> {
  try {
    const prepared = await prepare(input), sql = openMasterDb();
    let moves: AttendanceMove[] = [];
    try { await sql.begin(async tx => { await lockLabApply(tx); moves = (await validateOperatingLinks(tx, prepared.user.tenantId, prepared.time.date, prepared.plan, prepared.context)).moves; }); }
    finally { await sql.end({ timeout: 5 }); }
    const lines = moves.map(move => `출결 이동 · ${move.studentName} · ${move.date} ${move.fromClassName} ${move.fromTime ?? ''} → ${move.toClassName} ${move.toTime ?? ''}`);
    return { review: { ...prepared.review, changes: [...prepared.review.changes, ...lines], notices: moves.length ? [...prepared.review.notices, `이미 입력된 출결 ${moves.length}칸을 새 교시로 옮깁니다. 상태·메모·입력자는 그대로입니다.`] : prepared.review.notices } };
  } catch (error) { return { error: friendly(error) }; }
}

export async function queueTimetableLabApply(input: Request & { expectedHash: string; acknowledgeWarnings: boolean }): Promise<{ job: ApplyJobSummary } | { error: string }> {
  try {
    const prepared = await prepare(input);
    if (prepared.review.hash !== input.expectedHash) throw new Error('변경 내용이 달라졌습니다. 다시 검사해 주세요.');
    if ((prepared.review.warnings.length || prepared.review.skipped.length) && !input.acknowledgeWarnings) throw new Error('경고를 확인한 뒤 적용해 주세요.');
    const sql = openMasterDb();
    try {
      const job = await sql.begin('isolation level serializable', async tx => {
        await lockLabApply(tx);
        await tx`select pg_advisory_xact_lock(hashtextextended(${`${prepared.user.tenantId}:english-master`},0))`;
        const context = await readApplyContext(tx, prepared.user.tenantId);
        if (contextFingerprint(context) !== prepared.version || policyHash(context.settings, prepared.actorRole) !== prepared.policy) throw new Error('검사 이후 자료 또는 권한이 변경되었습니다. 다시 검사해 주세요.');
        await validateOperatingLinks(tx, prepared.user.tenantId, prepared.time.date, prepared.plan, prepared.context);
        const [row] = await tx<{ id: string; at: string; status: ApplyJobSummary['status']; error: string | null }[]>`insert into timetable_lab_apply_jobs(tenant_id,actor_id,actor_role,policy_hash,request_hash,baseline_hash,apply_at,effective_date,payload,summary) values(${prepared.user.tenantId},${prepared.user.id},${prepared.actorRole},${prepared.policy},${prepared.review.hash},${prepared.version},${prepared.time.at}::timestamptz,${prepared.time.date}::date,${tx.json(prepared.draft as never)}::jsonb,${tx.json(prepared.review.summary)}::jsonb) on conflict(tenant_id,actor_id,request_hash,apply_at) where status='pending' do update set request_hash=excluded.request_hash returning id,apply_at::text as at,status,error`;
        return row!;
      });
      if (new Date(job.at).getTime() <= Date.now() && job.status === 'pending') {
        await runApplyJob(job.id); // 즉시 적용 — 적용 자체는 runApplyJob이 timetable_structure_apply로 남긴다
        return { job: { ...job, status: 'applied' } };
      }
      // 나중에 적용할 예약 — 적용 때까지 기록이 없어 예약 자체를 남긴다(누가 · 언제 적용할지).
      await logAction({
        action: 'timetable_lab_apply_schedule',
        targetType: 'timetable',
        targetLabel: '시간표 연습본 적용 예약',
        metadata: { jobId: job.id, applyAt: job.at, effectiveDate: prepared.time.date },
      });
      return { job };
    } finally { await sql.end({ timeout: 5 }); }
  } catch (error) { return { error: friendly(error) }; }
}

export async function listTimetableLabApplyJobs(): Promise<{ jobs: ApplyJobSummary[] } | { error: string }> {
  try {
    const user = await getCurrentUser();
    if (!user || !(await canUseTimetableEditor(user.systemRole))) throw new Error('시간표를 관리할 권한이 필요합니다.');
    const sql = openMasterDb();
    try { return { jobs: await sql<ApplyJobSummary[]>`select id,apply_at::text as at,status,error,case when jsonb_typeof(result->'skipped')='array' then result->'skipped' else '[]'::jsonb end as skipped from timetable_lab_apply_jobs where tenant_id=${user.tenantId} and actor_id=${user.id} order by created_at desc limit 10` }; }
    finally { await sql.end({ timeout: 5 }); }
  } catch (error) { return { error: friendly(error) }; }
}

export async function cancelTimetableLabApplyJob(id: string): Promise<{ ok: true } | { error: string }> {
  try {
    const user = await getCurrentUser();
    if (!user || !(await canUseTimetableEditor(user.systemRole))) throw new Error('시간표를 관리할 권한이 필요합니다.');
    const viewError = await tenantViewWriteError();
    if (viewError) throw new Error(viewError);
    const sql = openMasterDb();
    try {
      const rows = await sql`update timetable_lab_apply_jobs set status='cancelled',finished_at=now() where tenant_id=${user.tenantId} and actor_id=${user.id} and id=${id}::uuid and status='pending' and apply_at>now() returning id`;
      if (!rows.length) throw new Error('이미 적용 시간이 지났거나 취소된 예약입니다.');
      await logAction({ action: 'timetable_lab_apply_cancel', targetType: 'timetable', targetLabel: '시간표 연습본 적용 예약', metadata: { jobId: id } });
      return { ok: true };
    } finally { await sql.end({ timeout: 5 }); }
  } catch (error) { return { error: friendly(error) }; }
}

export async function getTimetableLabApplyRevision(): Promise<string | null | undefined> {
  try {
    const user = await getCurrentUser();
    if (!user) return undefined;
    const sql = openMasterDb();
    // 예약·취소·실패도 시간표 배지를 바꾸므로 적용 완료만 보지 않는다.
    try { const [row] = await sql<{ id: string; status: string }[]>`select id,status from timetable_lab_apply_jobs where tenant_id=${user.tenantId} order by greatest(created_at,finished_at) desc,id desc limit 1`; return row ? `${row.id}:${row.status}` : null; }
    finally { await sql.end({ timeout: 5 }); }
  } catch { return undefined; }
}

export async function readTimetableLabApplyDraft(id: string): Promise<{ draft: Draft } | { error: string }> {
  try {
    const user = await getCurrentUser();
    if (!user || !(await canUseTimetableEditor(user.systemRole))) throw new Error('시간표를 관리할 권한이 필요합니다.');
    const sql = openMasterDb();
    try {
      const [row] = await sql<{ payload: unknown }[]>`select payload from timetable_lab_apply_jobs where tenant_id=${user.tenantId} and actor_id=${user.id} and id=${id}::uuid`;
      if (!row || !boundedJson(row.payload)) throw new Error('저장된 연습본을 찾지 못했습니다.');
      const parsed = draftSnapshotSchema.safeParse(row.payload);
      if (!parsed.success) throw new Error('저장된 연습본의 형식을 확인해 주세요.');
      return { draft: parsed.data as Draft };
    } finally { await sql.end({timeout:5}); }
  } catch (error) { return { error: friendly(error) }; }
}
