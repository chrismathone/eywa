import "server-only";
import type { createClient } from "@/lib/supabase/server";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * 이 학생·과목의 **직전 보고서 글**(대상 날짜보다 앞선 가장 최근 한 건) — 매크로성 반복 금지(원장 2026-10-26 *"직전에 쓴 표현이라면 조금
 * 다른표현"*)의 재료. 코드 문장은 이 글에 이미 쓴 갈래를 피하고(ment-variants.ts), AI에는 '겹치지 않게 다른 표현으로'의 참고로만 준다.
 * 🔑 RLS(테넌트 격리)를 타는 세션 클라이언트 — '이전 진도' 조회(getPrevReports)와 같은 규약. 한 행·한 칸만 읽는다.
 * ⚠️ 실패·없음은 null(fail-soft) — 이 값이 없다고 자동작성이 막히면 안 된다(그냥 첫 갈래 순서로 고른다).
 */
export async function fetchPrevReportNotes(
  supabase: ServerClient,
  studentId: string,
  subject: string | null | undefined,
  beforeDate: string,
): Promise<string | null> {
  try {
    let q = supabase
      .from("lesson_reports")
      .select("notes")
      .eq("student_id", studentId)
      .lt("report_date", beforeDate)
      .not("notes", "is", null)
      .order("report_date", { ascending: false })
      .limit(1);
    if (subject) q = q.eq("subject", subject);
    const { data, error } = await q;
    if (error) return null;
    const notes = (data?.[0]?.notes as string | null | undefined) ?? null;
    return notes?.trim() ? notes : null;
  } catch {
    return null;
  }
}
