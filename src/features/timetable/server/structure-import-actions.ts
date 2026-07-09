"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
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

export type PreviewStructureState = { error?: string; report?: DryRunReport };

/**
 * 강사별 그리드 시트 → class_schedules 변경 **미리보기**(dry-run). **DB 미변경**.
 * ⚠️ master 전용(시트 전체를 읽음, syncSheetsNow와 대칭 B5). Phase 2 apply는 이 report를 신뢰하지 않고
 * 서버가 재계산(hash 대조)하므로, 이 액션은 순수 조회.
 */
export async function previewStructureImport(subject: string = SUBJECT): Promise<PreviewStructureState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (user.systemRole !== "master") return { error: "구조 가져오기는 원장(master)만 할 수 있습니다" };
  if (!supportsStructureImport(subject)) return { error: "구조 가져오기는 영어 시간표만 지원합니다" };

  const supabase = await createClient();
  const { data } = await supabase
    .from("user_integrations")
    .select("spreadsheet_id, sync_enabled")
    .eq("provider", sheetsProvider(subject))
    .maybeSingle();
  if (data?.sync_enabled !== true) return { error: "구글 시트 연동이 꺼져 있습니다(학원 설정 › 연동에서 켜세요)" };
  const spreadsheetId = data?.spreadsheet_id?.trim();
  if (!spreadsheetId) return { error: "대상 구글 시트가 설정되지 않았습니다(관리자에게 문의)" };

  try {
    const grid = await readSheetGridWithMerges(spreadsheetId, TEACHER_SHEET_NAME);
    const parsed = parseEywaTeacherGrid(grid);
    if (parsed.slots.length === 0) return { error: `'${TEACHER_SHEET_NAME}' 탭에 데이터가 없습니다(시트를 확인하세요).` };
    const { ctx, existing } = await loadStructureContext(supabase);
    const match = matchStructure(parsed, ctx);
    return { report: computeStructureDiff(match, existing) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "시트 읽기 실패" };
  }
}
