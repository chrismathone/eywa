import "server-only";
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import type { createClient } from "@/lib/supabase/server";

/**
 * 보고서를 붙일 **반** 찾기 — 모호하지 않을 때만.
 *
 * 왜 필요한가(0134a): 보고서 1건의 단위가 반이 되면서, 관리자가 직접 쓴 보고서에 반이 안 붙으면
 * 강사가 같은 날 같은 학생에게 쓴 **반 있는 보고서**와 별개 행이 된다 → 학부모에게 두 번 나간다.
 * 반대로 **추측해서** 붙이면 특강 보고서가 정규 반에 붙는 식으로 조용히 틀린다.
 * → 후보가 **정확히 1개**일 때만 붙이고, 아니면 null(예전과 동일한 과목 단위 동작).
 *
 * 후보 조건 = 0134a 백필과 **같은 규칙**이다(둘이 갈라지면 과거·현재 판정이 달라진다):
 *  · 그 학생이 그 날짜에 수강 중인 반
 *  · 반 과목 = 보고서 과목
 *  · 그 요일에 유효한 시간표(class_schedules)가 있음
 *  · teacherName이 주어지면 그 반 담당강사 이름과 일치
 *
 * 조회 실패·모호는 전부 null(fail-soft) — 반을 못 정하는 것이 저장을 막을 이유는 없다.
 */
const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export async function resolveReportClassId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: { studentId: string; reportDate: string; subject: string; teacherName?: string | null },
): Promise<string | null> {
  if (!input.subject) return null;
  // ⚠️ 요일은 KST 날짜 문자열에서 직접 계산한다 — `new Date("YYYY-MM-DD")`는 UTC 자정으로 파싱되지만
  //    getUTCDay()로 읽으면 시간대 이동이 없어 안전하다(로컬 getDay()는 -9h 밀려 하루 어긋난다).
  const dow = DOW[new Date(`${input.reportDate}T00:00:00Z`).getUTCDay()];
  if (!dow) return null;

  const { data, error } = await supabase
    .from("enrollments")
    .select(
      "class_id, end_date, is_transferred, classes!inner(id, subject, teacher_id, users:teacher_id(display_name))",
    )
    .eq("student_id", input.studentId)
    .eq("classes.subject", input.subject)
    .or(`start_date.is.null,start_date.lte.${input.reportDate}`)
    // ⚠️ 넓은 프리필터 — 종료 판정은 아래 `isEnrollmentEndedOn`이 한다(반이동은 종료일 당일 배타).
    .or(`end_date.is.null,end_date.gte.${input.reportDate}`);
  if (error || !data) return null;

  const wanted = input.teacherName?.trim();
  const ids = new Set<string>();
  for (const row of data) {
    // 반이동한 학생의 **옛 반**이 적용일 당일 후보로 남으면 그날 보고서가 떠난 반에 붙는다.
    if (isEnrollmentEndedOn(row.end_date as string | null, input.reportDate, row.is_transferred === true))
      continue;
    const cls = (Array.isArray(row.classes) ? row.classes[0] : row.classes) as
      | { id: string; users?: { display_name?: string | null } | { display_name?: string | null }[] | null }
      | null;
    if (!cls) continue;
    if (wanted) {
      const u = (Array.isArray(cls.users) ? cls.users[0] : cls.users) ?? null;
      if ((u?.display_name ?? "").trim() !== wanted) continue;
    }
    ids.add(cls.id);
  }
  if (ids.size === 0) return null;

  // 요일 확인 — 그날 수업이 없는 반은 후보가 아니다(주 2회 반과 주 1회 특강을 가르는 축).
  const { data: sched } = await supabase
    .from("class_schedules")
    .select("class_id")
    .in("class_id", [...ids])
    .eq("day_of_week", dow)
    .or(`valid_from.is.null,valid_from.lte.${input.reportDate}`)
    .or(`valid_to.is.null,valid_to.gte.${input.reportDate}`);
  const onDay = new Set((sched ?? []).map((s) => s.class_id as string));
  const candidates = [...ids].filter((id) => onDay.has(id));
  return candidates.length === 1 ? candidates[0]! : null;
}
