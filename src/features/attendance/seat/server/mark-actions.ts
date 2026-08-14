"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePlanText } from "@/features/class-sheets/lib/plan-codec";
import { JJ_MARK_MAXLEN, jjSeatTextCols, parseJjMarkField, seatHasJjFields } from "../jj-fields";
import { hhmm, type SeatKey } from "../seat";
import { gateSeatWrite, rosterKeys } from "./gate";

const COL: Record<"listeningLevel" | "memorizedWords", "listening_level" | "memorized_words"> = {
  listeningLevel: "listening_level",
  memorizedWords: "memorized_words",
};
const ON_CONFLICT = "tenant_id,class_id,student_id,mark_date,slot_start";

function fieldLabel(field: "listeningLevel" | "memorizedWords"): string {
  return jjSeatTextCols().find((c) => c.field === field)?.label ?? "입력";
}

function isMissingColumn(err: { code?: string; message?: string } | null, column: string): boolean {
  if (!err) return false;
  if (err.code === "PGRST204" || err.code === "42703") return true;
  return (err.message ?? "").includes(column) && /column|컬럼/i.test(err.message ?? "");
}

/**
 * JJ실 전용 칸 한 개 저장. 출결 행은 건드리지 않고, 자리 시수도 안 박는다.
 *
 * 기록은 영어 시트 JJ 칸과 같은 `class_sheet_student_marks`. PIN·랩실에서는 거부.
 * 🔴 듣기·단어를 동시에 적으면 둘 다 "새 행"으로 보이므로 **upsert**(select+insert는 unique 충돌).
 */
export async function setSeatJjField(input: {
  seat: SeatKey;
  date: string;
  slotStart: string;
  classId: string;
  studentId: string;
  field: string;
  value: string | null;
}): Promise<{ ok: true } | { error: string }> {
  if (!seatHasJjFields(input.seat)) {
    return { error: "이 자리에는 듣기·단어 칸이 없습니다" };
  }
  const field = parseJjMarkField(input.field);
  if (!field) return { error: "잘못된 칸입니다" };

  const g = await gateSeatWrite(input.seat, input.date);
  if ("error" in g) return g;
  if (g.via === "pin" || !g.userId) {
    return { error: "듣기·단어는 로그인 출석부에서만 입력합니다" };
  }

  const slot = hhmm(input.slotStart);
  const roster = await rosterKeys(input.seat, input.date, slot, null);
  if (!roster) return { error: "그 시각에는 이 자리 수업이 없습니다" };
  if (!roster.keys.has(`${input.classId}|${input.studentId}`)) {
    return { error: "이 교시 명단에 없는 학생입니다" };
  }

  const value = normalizePlanText(input.value);
  if ((value?.length ?? 0) > JJ_MARK_MAXLEN) {
    return { error: `${fieldLabel(field)}은(는) ${JJ_MARK_MAXLEN}자 이내로 입력하세요` };
  }

  const admin = createAdminClient();
  const col = COL[field];
  const { data: existing, error: readErr } = await admin
    .from("class_sheet_student_marks")
    .select("id, status, progress_note, score, listening_level, memorized_words")
    .eq("tenant_id", g.tenantId)
    .eq("class_id", input.classId)
    .eq("student_id", input.studentId)
    .eq("mark_date", input.date)
    .eq("slot_start", slot)
    .maybeSingle();
  if (readErr) return { error: "저장에 실패했습니다" };
  if (!existing && value === null) return { ok: true };

  const now = new Date().toISOString();
  const { error } = await admin.from("class_sheet_student_marks").upsert(
    {
      tenant_id: g.tenantId,
      class_id: input.classId,
      student_id: input.studentId,
      mark_date: input.date,
      slot_start: slot,
      [col]: value,
      updated_by: g.userId,
      updated_at: now,
    },
    { onConflict: ON_CONFLICT },
  );
  if (error) {
    if (isMissingColumn(error, col)) {
      return { error: `'${fieldLabel(field)}' 칸은 아직 준비 중입니다` };
    }
    return { error: "저장에 실패했습니다" };
  }

  const next = {
    status: existing?.status ?? null,
    progress_note: existing?.progress_note ?? null,
    score: existing?.score ?? null,
    listening_level: field === "listeningLevel" ? value : (existing?.listening_level ?? null),
    memorized_words: field === "memorizedWords" ? value : (existing?.memorized_words ?? null),
  };
  if (Object.values(next).every((v) => v == null) && existing?.id) {
    await admin
      .from("class_sheet_student_marks")
      .delete()
      .eq("id", existing.id)
      .eq("tenant_id", g.tenantId);
  }

  revalidatePath("/attendance/seat");
  revalidatePath("/ecs");
  return { ok: true };
}
