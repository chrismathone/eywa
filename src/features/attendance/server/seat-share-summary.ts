import "server-only";
import { getTenantSettings } from "@/features/owner/server/queries";
import { monthRange } from "@/lib/date-kst";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { createClient } from "@/lib/supabase/server";
import { parseSeatShareStudents, parseSeatShareUnits } from "../seat-share-adjust";
import { axisSlotFromRow, isSeatSlot } from "../teacher-axis";
import { attendanceUnitSuffix } from "../unit-suffix";
import { attendanceSalaryAdminOrNull } from "./salary-rates";
import { SEAT_SHARE_TABLE, seatShareTableMissing } from "./seat-share-adjust";

/**
 * 회차 확정의 **자리 몫 줄** 재료(원장 2026-10-07 *"어떤반의 수업/JJ 비율을 19/5를 20/4로 변경할 수 있으면"* · *"LAB도 마찬가지"*) —
 * 그 달 자리(JJ실·랩실) 교시가 있는 영어 반과, 반마다 선생님에게 돌린 시수. 줄을 세울지와 한 줄 요약만 정한다 —
 * 계획 몫과 학생 목록은 창을 열 때 읽는다(`loadSeatShareSheet`).
 *
 * 🔴 권한이 없으면 null — 줄 자체를 세우지 않는다(급여 비율을 고칠 수 있는 사람만 · 급여 기능이 꺼진 지점 · '다른 강사 뷰' 제외).
 * 🔑 줄은 **등록 차수를 시간표 몫으로 나누는 반**(시수 단위 U = 영어 갈래)에만 선다 — 그 밖의 반은 조정해도 읽는 곳이 없다.
 * ⚠️ 조회 실패는 null로 접는다 — 회차 확정 표는 그대로 열리고 이 줄만 안 선다(사무실이 매일 쓰는 표라 이 조회 하나로 죽지 않게).
 */
export type SeatShareSummary = {
  /** 그 달 자리 교시가 있는 반(조정값이 남아 있는 반 포함 — 되돌릴 수 있어야 한다). */
  classIds: string[];
  /** 반 id → 선생님에게 돌린 값(반 전체 시수 · 따로 정한 학생 수). */
  adjusted: Record<string, { teacherId: string; name: string; units: number; students: number }[]>;
};

type ScheduleRow = {
  class_id: string; day_of_week: string; start_time: string | null; teacher_id: string | null;
  slot_teacher_label: string | null; valid_from: string; valid_to: string | null;
};
type AdjustRow = { class_id: string; teacher_id: string; units: number | string | null; student_units: unknown };

export async function loadSeatShareSummary(period: string): Promise<SeatShareSummary | null> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return null;
  try {
    // 🔴 이동 없는 문으로 본다 — 출석부 메뉴가 닫힌 수납 계정이 회차 확정을 열어도 화면이 튕기지 않는다(줄만 안 선다).
    const user = await attendanceSalaryAdminOrNull();
    if (!user) return null;
    const { from, to } = monthRange(period);
    const supabase = await createClient();
    const admin = createAdminClient();
    const [schedules, adjustRes, settings] = await Promise.all([
      // 그 달과 겹치는 교시 전부(지점 전체 — 세션 클라이언트의 RLS가 지점을 가른다). 이력을 담는 표라 페이지로 읽는다([[#88]]).
      fetchAllPaged<ScheduleRow>((f, t) => supabase.from("class_schedules")
        .select("class_id, day_of_week, start_time, teacher_id, slot_teacher_label, valid_from, valid_to")
        .lte("valid_from", to).or(`valid_to.is.null,valid_to.gte.${from}`)
        .order("id", { ascending: true }).range(f, t)),
      // 조정값 — 한 지점 한 달이라 줄 수가 적다(반 × 선생님). 표가 아직 없으면 '없음'으로 읽는다([[#95]]).
      admin.from(SEAT_SHARE_TABLE).select("class_id, teacher_id, units, student_units").eq("tenant_id", user.tenantId).eq("period", period).limit(1000),
      getTenantSettings(),
    ]);
    if (adjustRes.error && !seatShareTableMissing(adjustRes.error)) throw adjustRes.error;
    const adjustRows = (adjustRes.data ?? []) as AdjustRow[];
    const seatClassIds = new Set<string>();
    for (const s of schedules) {
      const slot = axisSlotFromRow({
        day_of_week: String(s.day_of_week), start_time: s.start_time ?? null, teacher_id: s.teacher_id, slot_teacher_label: s.slot_teacher_label ?? null,
        valid_from: String(s.valid_from), valid_to: s.valid_to ?? null,
      });
      if (isSeatSlot(slot)) seatClassIds.add(s.class_id);
    }
    for (const r of adjustRows) seatClassIds.add(r.class_id);
    const [classes, users] = await Promise.all([
      fetchInChunks<{ id: string; subject: string | null }>([...seatClassIds], (chunk) => supabase.from("classes").select("id, subject").in("id", chunk)),
      fetchInChunks<{ id: string; display_name: string | null }>([...new Set(adjustRows.map((r) => r.teacher_id))], (chunk) =>
        supabase.from("users").select("id, display_name").in("id", chunk)),
    ]);
    const shareClasses = new Set(classes.filter((c) => attendanceUnitSuffix(c.subject, settings.operations.subjects) === "U").map((c) => c.id));
    const nameOf = new Map(users.map((u) => [u.id, u.display_name ?? "선생님"]));
    const adjusted: SeatShareSummary["adjusted"] = {};
    for (const r of adjustRows) {
      if (!shareClasses.has(r.class_id)) continue;
      const units = parseSeatShareUnits(r.units ?? 0) ?? 0;
      const students = Object.keys(parseSeatShareStudents(r.student_units) ?? {}).length;
      if (units === 0 && students === 0) continue;
      (adjusted[r.class_id] ??= []).push({ teacherId: r.teacher_id, name: nameOf.get(r.teacher_id) ?? "선생님", units, students });
    }
    for (const list of Object.values(adjusted)) list.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    return { classIds: [...shareClasses], adjusted };
  } catch (error) {
    console.error("[seat-share-summary] 자리 몫 줄 재료 조회 실패 — 줄을 세우지 않는다:", error instanceof Error ? error.message : error);
    return null;
  }
}
