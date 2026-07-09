"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { sheetsProvider, supportsStructureImport } from "@/features/integrations/sheets-provider";
import { readSheetGridWithMerges } from "@/features/integrations/google-sheets";
import { TEACHER_SHEET_NAME } from "@/features/exports/english-timetable/teacher-grid-sheet";
import { parseEywaTeacherGrid } from "@/features/timetable/import/structure/parse-eywa-grid";
import { matchStructure } from "@/features/timetable/import/structure/match";
import { computeStructureDiff } from "@/features/timetable/import/structure/diff";
import type { DayOfWeek } from "@/features/timetable/lib/periods";
import type {
  DryRunReport,
  ExistingContext,
  ExistingSchedule,
  MatchResult,
} from "@/features/timetable/import/structure/types";

const SUBJECT = "english"; // 구조 import 지원 과목(현재 영어 전용).

/**
 * 강사별 그리드 시트(마스터) + 현 class_schedules(영어·활성·현재 유효)를 로드해 매칭 컨텍스트를 만든다.
 * RLS로 테넌트 자동 격리 + subject='english' 명시 스코프. `fetchAllPaged`(B2 절단 방지).
 */
async function loadStructureContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ ctx: ExistingContext; existing: ExistingSchedule[] }> {
  const today = kstToday();
  const hm = (t: string | null) => (t ? String(t).slice(0, 5) : null);

  const [classes, users, rooms, sched] = await Promise.all([
    fetchAllPaged<{ id: string; class_name: string; subject: string; teacher_id: string | null; classroom_id: string | null }>(
      (from, to) =>
        supabase.from("classes").select("id, class_name, subject, teacher_id, classroom_id").eq("subject", SUBJECT).eq("is_active", true).range(from, to),
    ),
    fetchAllPaged<{ id: string; display_name: string; english_name: string | null; system_role: string }>(
      (from, to) => supabase.from("users").select("id, display_name, english_name, system_role").eq("status", "active").range(from, to),
    ),
    fetchAllPaged<{ id: string; name: string }>((from, to) => supabase.from("classrooms").select("id, name").range(from, to)),
    fetchAllPaged<{
      id: string; class_id: string; day_of_week: string; start_time: string; end_time: string;
      teacher_id: string | null; classroom_id: string | null; slot_teacher_label: string | null;
      slot_room_label: string | null; merge_group: string | null; valid_from: string; valid_to: string | null;
      class?: { class_name?: string; subject?: string; is_active?: boolean } | { class_name?: string }[];
    }>((from, to) =>
      supabase
        .from("class_schedules")
        .select(
          "id, class_id, day_of_week, start_time, end_time, teacher_id, classroom_id, slot_teacher_label, slot_room_label, merge_group, valid_from, valid_to, class:class_id!inner ( class_name, subject, is_active )",
        )
        .eq("class.subject", SUBJECT)
        .eq("class.is_active", true)
        .lte("valid_from", today)
        .or(`valid_to.is.null,valid_to.gte.${today}`)
        .range(from, to),
    ),
  ]);

  const ctx: ExistingContext = {
    classes: classes.map((c) => ({ id: c.id, className: c.class_name, subject: c.subject, teacherId: c.teacher_id, classroomId: c.classroom_id })),
    teachers: users.map((u) => ({ id: u.id, englishName: u.english_name, displayName: u.display_name, systemRole: u.system_role })),
    classrooms: rooms.map((r) => ({ id: r.id, name: r.name })),
  };
  const existing: ExistingSchedule[] = sched.map((s) => {
    const cl = (Array.isArray(s.class) ? s.class[0] : s.class) as { class_name?: string } | undefined;
    return {
      id: s.id, classId: s.class_id, className: cl?.class_name ?? "", day: s.day_of_week as DayOfWeek,
      startTime: hm(s.start_time)!, endTime: hm(s.end_time), teacherId: s.teacher_id, classroomId: s.classroom_id,
      slotTeacherLabel: s.slot_teacher_label, slotRoomLabel: s.slot_room_label, mergeGroup: s.merge_group,
      validFrom: s.valid_from, validTo: s.valid_to,
    };
  });
  return { ctx, existing };
}

/**
 * 시트+DB를 지금 다시 읽어 diff를 재계산(무쓰기). preview·apply의 단일 소스 —
 * apply는 이 결과의 hash를 클라 미리보기 hash와 대조하고, 이 결과로 payload를 만든다(클라 계획 불신).
 */
async function computeFresh(
  supabase: Awaited<ReturnType<typeof createClient>>,
  subject: string,
): Promise<
  | { error: string }
  | { report: DryRunReport; match: MatchResult; existing: ExistingSchedule[]; ctx: ExistingContext }
> {
  const { data } = await supabase
    .from("user_integrations")
    .select("spreadsheet_id, sync_enabled")
    .eq("provider", sheetsProvider(subject))
    .maybeSingle();
  if (data?.sync_enabled !== true) return { error: "구글 시트 연동이 꺼져 있습니다(학원 설정 › 연동에서 켜세요)" };
  const spreadsheetId = data?.spreadsheet_id?.trim();
  if (!spreadsheetId) return { error: "대상 구글 시트가 설정되지 않았습니다(관리자에게 문의)" };

  const grid = await readSheetGridWithMerges(spreadsheetId, TEACHER_SHEET_NAME);
  const parsed = parseEywaTeacherGrid(grid);
  if (parsed.slots.length === 0) return { error: `'${TEACHER_SHEET_NAME}' 탭에 데이터가 없습니다(시트를 확인하세요).` };
  const { ctx, existing } = await loadStructureContext(supabase);
  const match = matchStructure(parsed, ctx);
  const report = computeStructureDiff(match, existing);
  return { report, match, existing, ctx };
}

export type PreviewStructureState = { error?: string; report?: DryRunReport };

/**
 * 강사별 그리드 시트 → class_schedules 변경 **미리보기**(dry-run). **DB 미변경**.
 * ⚠️ master 전용(시트 전체를 읽음, syncSheetsNow와 대칭 B5). apply는 이 report를 신뢰하지 않고
 * 서버가 재계산(hash 대조)하므로, 이 액션은 순수 조회.
 */
export async function previewStructureImport(subject: string = SUBJECT): Promise<PreviewStructureState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (user.systemRole !== "master") return { error: "구조 가져오기는 원장(master)만 할 수 있습니다" };
  if (!supportsStructureImport(subject)) return { error: "구조 가져오기는 영어 시간표만 지원합니다" };

  const supabase = await createClient();
  try {
    const fresh = await computeFresh(supabase, subject);
    if ("error" in fresh) return { error: fresh.error };
    return { report: fresh.report };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "시트 읽기 실패" };
  }
}

/** apply payload — RPC apply_english_structure(p_payload)가 원자 실행. 서버 재계산 결과에서만 구성. */
interface ApplyInsert {
  id: string; classId: string; day: DayOfWeek; startTime: string; endTime: string | null;
  teacherId: string | null; classroomId: string | null; slotTeacherLabel: string | null; slotRoomLabel: string | null;
}
interface ApplyClassUpdate {
  classId: string; teacherId: string | null; classroomId: string | null;
  prevTeacherId: string | null; prevClassroomId: string | null;
}

/**
 * classes 담임/기본강의실 계획 — 전 슬롯 **강사 이름 기준 최빈값**(apply-english-schedules.cjs 규칙:
 * 미해석 다수 강사가 해석 소수에게 담임을 뺏기지 않도록 이름으로 세고, 해석될 때만 반영). 강의실은 classroomId 최빈.
 * 해석·변경된 필드만(동률·미해석·기존동일은 제외). teacherId/classroomId=null이면 그 필드 미변경(RPC coalesce 유지).
 */
function buildClassUpdates(match: MatchResult, ctx: ExistingContext): ApplyClassUpdate[] {
  const prevById = new Map(ctx.classes.map((c) => [c.id, c]));
  const nameToTeacherId = new Map<string, string | null>();
  for (const s of match.resolved) if (!nameToTeacherId.has(s.teacherName)) nameToTeacherId.set(s.teacherName, s.teacherId);

  const per = new Map<string, { names: Map<string, number>; rooms: Map<string, number> }>();
  for (const s of match.resolved) {
    if (!s.classId) continue;
    const e = per.get(s.classId) ?? per.set(s.classId, { names: new Map(), rooms: new Map() }).get(s.classId)!;
    e.names.set(s.teacherName, (e.names.get(s.teacherName) ?? 0) + 1);
    if (s.classroomId) e.rooms.set(s.classroomId, (e.rooms.get(s.classroomId) ?? 0) + 1);
  }
  // 최빈값 — 동률(top2 동수)이면 null(모호 → 기존 유지).
  const modal = (m: Map<string, number>): string | null => {
    if (!m.size) return null;
    const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
    if (sorted.length > 1 && sorted[0]![1] === sorted[1]![1]) return null;
    return sorted[0]![0];
  };

  const updates: ApplyClassUpdate[] = [];
  for (const [classId, e] of per) {
    const prev = prevById.get(classId);
    if (!prev) continue;
    const modalName = modal(e.names);
    const modalTeacherId = modalName ? nameToTeacherId.get(modalName) ?? null : null; // 미해석 최빈 → null(유지)
    const modalRoomId = modal(e.rooms);
    const setTeacher = modalTeacherId && modalTeacherId !== prev.teacherId ? modalTeacherId : null;
    const setRoom = modalRoomId && modalRoomId !== prev.classroomId ? modalRoomId : null;
    if (setTeacher || setRoom)
      updates.push({ classId, teacherId: setTeacher, classroomId: setRoom, prevTeacherId: prev.teacherId, prevClassroomId: prev.classroomId });
  }
  return updates;
}

export type ApplyStructureState = {
  error?: string;
  staleHash?: string; // hash 불일치 시 서버 재계산 hash(클라가 재미리보기 유도)
  applied?: { closed: number; inserted: number; classUpdated: number };
  snapshotId?: string | null;
  noop?: boolean;
};

/**
 * 미리보기에서 확인한 변경 계획을 **적용**(class_schedules 쓰기). ⚠️ 프로덕션 반영.
 * 리뷰 3조건: ① 서버 재검증(시트+DB 재읽기·재계산, 클라 hash와 대조 — 불신), ② 원자 RPC,
 * ③ temporal(마감+삽입) + 스냅샷 + 롤백. tenant + subject='english' 스코프 밖 무변경.
 */
export async function applyStructureImport(expectedHash: string, subject: string = SUBJECT): Promise<ApplyStructureState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (user.systemRole !== "master") return { error: "구조 가져오기는 원장(master)만 할 수 있습니다" };
  if (!(await canWriteTenant(user.systemRole, "classes"))) return { error: "시간표 관리 권한이 없습니다" };
  if (!supportsStructureImport(subject)) return { error: "구조 가져오기는 영어 시간표만 지원합니다" };

  const supabase = await createClient();
  let fresh;
  try {
    fresh = await computeFresh(supabase, subject);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "시트 읽기 실패" };
  }
  if ("error" in fresh) return { error: fresh.error };
  const { report, match, existing, ctx } = fresh;

  // ① 서버 재검증 — 미리보기 이후 시트/시간표가 바뀌면 hash 불일치 → 중단(재미리보기 유도).
  if (report.hash !== expectedHash)
    return { error: "시트 또는 시간표가 미리보기 이후 변경되었습니다. 다시 미리보기 후 적용하세요.", staleHash: report.hash };

  const changeItems = report.planItems.filter((p) => p.action !== "keep");
  if (changeItems.length === 0) return { applied: { closed: 0, inserted: 0, classUpdated: 0 }, snapshotId: null, noop: true };

  // closes = update·remove 대상 기존 행(id + 이전 valid_to → 롤백 복원).
  const validToById = new Map(existing.map((e) => [e.id, e.validTo]));
  const closes = report.planItems
    .filter((p) => (p.action === "update" || p.action === "remove") && p.scheduleId)
    .map((p) => ({ id: p.scheduleId!, prevValidTo: validToById.get(p.scheduleId!) ?? null }));

  // inserts = create·update 신규 행(서버 생성 UUID — 롤백 식별). 신규 반(classId null)은 제외.
  const inserts: ApplyInsert[] = report.planItems
    .filter((p) => (p.action === "create" || p.action === "update") && p.classId)
    .map((p) => ({
      id: crypto.randomUUID(),
      classId: p.classId!,
      day: p.day,
      startTime: p.startTime,
      endTime: p.endTime,
      teacherId: p.teacherId ?? null,
      classroomId: p.classroomId ?? null,
      slotTeacherLabel: p.teacherNames[0] ?? null,
      slotRoomLabel: p.room,
    }));

  const classUpdates = buildClassUpdates(match, ctx);
  const today = kstToday();
  const payload = {
    label: "영어 시트 구조 import",
    hash: report.hash,
    summary: report.plan,
    closes,
    inserts,
    classUpdates,
    planItems: report.planItems,
  };

  const { data, error } = await supabase.rpc("apply_english_structure", { p_payload: payload, p_today: today });
  if (error) return { error: error.message };
  revalidatePath("/timetable");
  const res = (data ?? {}) as { snapshotId?: string; closed?: number; inserted?: number; classUpdated?: number };
  return {
    applied: { closed: res.closed ?? 0, inserted: res.inserted ?? 0, classUpdated: res.classUpdated ?? 0 },
    snapshotId: res.snapshotId ?? null,
  };
}

export type RollbackStructureState = {
  error?: string;
  reverted?: { deleted: number; restored: number; classReverted: number };
};

/** 구조 import 적용을 스냅샷으로 되돌린다(삽입행 삭제 + 마감행 valid_to 복원 + classes prev 복원). */
export async function rollbackStructureImport(snapshotId: string): Promise<RollbackStructureState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (user.systemRole !== "master") return { error: "구조 가져오기는 원장(master)만 할 수 있습니다" };
  if (!(await canWriteTenant(user.systemRole, "classes"))) return { error: "시간표 관리 권한이 없습니다" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rollback_english_structure", { p_snapshot_id: snapshotId });
  if (error) return { error: error.message };
  revalidatePath("/timetable");
  const res = (data ?? {}) as { deleted?: number; restored?: number; classReverted?: number };
  return { reverted: { deleted: res.deleted ?? 0, restored: res.restored ?? 0, classReverted: res.classReverted ?? 0 } };
}
