"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

export type LogActionState = { ok?: boolean; error?: string } | undefined;

/**
 * 이탈 방어 조치 기록 → eywa 학생상담(student_consultations)에 적재.
 * 부원장의 "조치 타임라인"을 별도 테이블 없이 eywa 상담 기록과 한 몸으로 만든다.
 * follow_up_date를 주면 그게 곧 다음 연락 예정일(브리핑·캘린더 연동).
 */
export async function logRetentionAction(
  _prev: LogActionState,
  formData: FormData,
): Promise<LogActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const summary = String(formData.get("summary") ?? "").trim();
  const followUpDate = String(formData.get("followUpDate") ?? "").trim() || null;

  if (!studentId) return { error: "학생 ID가 누락되었습니다" };
  if (summary.length < 2) return { error: "조치 내용을 입력해주세요" };

  const supabase = await createClient();
  const { error } = await supabase.from("student_consultations").insert({
    tenant_id: user.tenantId,
    student_id: studentId,
    counselor_id: user.id,
    consulted_at: new Date().toISOString(),
    category: "general",
    audience: "parent",
    summary,
    follow_up_date: followUpDate,
    follow_up_done: false,
  });
  if (error) return { error: error.message };

  revalidatePath("/retention");
  revalidatePath("/retention/messages");
  revalidatePath(`/students/${studentId}`);
  return { ok: true };
}
