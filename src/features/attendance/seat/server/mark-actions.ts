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

function fieldLabel(field: "listeningLevel" | "memorizedWords"): string {
  return jjSeatTextCols().find((c) => c.field === field)?.label ?? "입력";
}

/**
 * JJ실 전용 칸 한 개 저장. 출결 행은 건드리지 않고, 자리 시수도 안 박는다.
 *
 * 기록은 영어 시트 JJ 칸과 같은 `class_sheet_student_marks`. PIN·랩실에서는 거부.
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
  if (readErr) return { error: `저장에 실패했습니다: ${readErr.message}` };

  const now = new Date().toISOString();
  if (existing?.id) {
    const { error } = await admin
      .from("class_sheet_student_marks")
      .update({ [col]: value, updated_by: g.userId, updated_at: now })
      .eq("id", existing.id)
      .eq("tenant_id", g.tenantId);
    if (error) return { error: `저장에 실패했습니다: ${error.message}` };
    const next = {
      status: existing.status,
      progress_note: existing.progress_note,
      score: existing.score,
      listening_level: field === "listeningLevel" ? value : existing.listening_level,
      memorized_words: field === "memorizedWords" ? value : existing.memorized_words,
    };
    if (Object.values(next).every((v) => v == null)) {
      await admin
        .from("class_sheet_student_marks")
        .delete()
        .eq("id", existing.id)
        .eq("tenant_id", g.tenantId);
    }
  } else if (value !== null) {
    const { error } = await admin.from("class_sheet_student_marks").insert({
      tenant_id: g.tenantId,
      class_id: input.classId,
      student_id: input.studentId,
      mark_date: input.date,
      slot_start: slot,
      [col]: value,
      updated_by: g.userId,
      updated_at: now,
    });
    if (error) return { error: `저장에 실패했습니다: ${error.message}` };
  }

  revalidatePath("/attendance/seat");
  revalidatePath("/ecs");
  return { ok: true };
}
