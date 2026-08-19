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
 * 기록은 영어 시트 JJ 칸과 같은 `class_sheet_student_marks`. 랩실(칸이 없는 자리)에서는 거부.
 * 🔴 듣기·단어를 동시에 적으면 둘 다 "새 행"으로 보이므로 **upsert**(select+insert는 unique 충돌).
 *
 * 🔵 **공개 PIN(비로그인)도 쓴다**(2026-08-19) — 로그인 없이 그 칸을 적는 게 `/seat/jj` 화면의 목적이다.
 *    화면이 그리는 칸을 서버가 거절하면 "되는 것처럼 보이는데 저장이 안 되는 칸"이 남는다. 보호는 출결
 *    쓰기와 **똑같이** 붙는다: 같은 PIN 쿠키(`gateSeatWrite`) · 오늘만 · 그날 그 교시 **명단 화이트리스트**.
 *    작성자는 키오스크와 같은 정직함으로 `updated_by = null`(로그인 없이 찍었다는 사실을 지어내지 않는다).
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

  const slot = hhmm(input.slotStart);
  // 공개 PIN 경로는 세션이 없어 RLS로 명단을 못 읽는다 → admin + 쿠키의 tenantId(출결 쓰기와 같은 규약).
  const roster = await rosterKeys(input.seat, input.date, slot, g.via === "pin" ? g.tenantId : null);
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
      // 로그인 없이 적었으면 null — "누가 적었나"를 지어내지 않는다(키오스크·자리 출결과 같은 규약).
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
  revalidatePath("/seat");
  revalidatePath("/ecs");
  return { ok: true };
}
