import "server-only";
import { explainDbError } from "@/lib/supabase/db-error";
import type { createClient } from "@/lib/supabase/server";
import type { GridApplyPlan, GridApplyState, GridCreatedClass } from "@/features/timetable/import/math-grid/apply-plan";

type Db = Awaited<ReturnType<typeof createClient>>;

export type Created = GridCreatedClass & { key: string };

/**
 * ① 반 + 수업 시간 만들기. 하나라도 실패하면 이번에 만든 반을 지우고 이유를 돌려준다(변경 없음).
 * `undo`는 뒤 단계(되돌리기 기록)가 실패했을 때 호출부가 부른다 — 못 지운 반 이름을 돌려준다.
 */
export async function createGridClasses(
  supabase: Db,
  tenantId: string,
  plan: GridApplyPlan,
  effective: string,
): Promise<{ created: Created[]; abort: (reason: string) => Promise<GridApplyState> } & ({ ok: true } | { ok: false; state: GridApplyState })> {
  const created: Created[] = [];
  /** 이번에 만든 반을 지운다(수업 시간은 함께 지워진다). 못 지운 반 이름을 돌려준다. */
  const undo = async (): Promise<string[]> => {
    const left: string[] = [];
    for (const c of created) {
      const { error } = await supabase.from("classes").delete().eq("id", c.classId);
      if (error) left.push(c.name);
    }
    return left;
  };
  const abort = async (reason: string): Promise<GridApplyState> => {
    const left = await undo();
    return {
      error: left.length
        ? `${reason} 만들던 반(${left.join(", ")})을 지우지 못해 남아 있습니다 — 수업목록에서 확인해 주세요.`
        : `${reason} 변경은 적용되지 않았습니다.`,
    };
  };
  for (const cls of plan.classes) {
    const { data, error } = await supabase
      .from("classes")
      .insert({
        tenant_id: tenantId,
        class_name: cls.name,
        subject: "math",
        teacher_id: cls.teacherId,
        classroom_id: cls.classroomId,
        is_active: true,
      })
      .select("id")
      .single();
    if (error || !data) {
      const info = explainDbError(error, { scope: "timetable.mathGrid.createClass", fallback: "저장에 실패했습니다" });
      return { ok: false, created, abort, state: await abort(`"${cls.name}" 반을 만들지 못했습니다(${info.message}).`) };
    }
    created.push({ key: cls.key, classId: data.id as string, name: cls.name, scheduleIds: [] });
    const { data: rows, error: slotErr } = await supabase
      .from("class_schedules")
      .insert(
        cls.slots.map((s) => ({
          tenant_id: tenantId,
          class_id: data.id,
          day_of_week: s.day,
          start_time: s.startTime,
          end_time: s.endTime,
          valid_from: effective,
        })),
      )
      .select("id");
    if (slotErr || !rows) {
      const info = explainDbError(slotErr, { scope: "timetable.mathGrid.createSlots", fallback: "저장에 실패했습니다" });
      return { ok: false, created, abort, state: await abort(`"${cls.name}" 반의 수업 시간을 저장하지 못했습니다(${info.message}).`) };
    }
    created[created.length - 1]!.scheduleIds = rows.map((r) => r.id as string);
  }
  return { ok: true, created, abort };
}
