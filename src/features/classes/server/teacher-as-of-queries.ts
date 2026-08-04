import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { fetchAllPaged } from "@/lib/supabase/batch";
import {
  buildTeacherAsOfIndex,
  historyWindowStart,
  type MonthlyWriter,
  type TeacherAsOfIndex,
  type TeacherTransition,
} from "../teacher-as-of";

/**
 * "그 주 담임" 복원 인덱스 — 인수인계 감사로그(사실) + 그 달 보고서 작성자(추정), **최근 2개월**만.
 *
 * 원장 2026-08-04: *"보고서를 기준으로 이전담임을 추측하는건 현명한것같네"* + *"전부 할 필요는 없고
 * 최근 2개월치면"*. 스키마를 늘리지 않고 이미 있는 기록으로 복원한다.
 *
 * 규모(실측 2026-08-04): 인수인계 적용 로그 29건 · **반이 연결된** 보고서 539행(이관분은 class_id가
 * 비어 있어 애초에 대상이 아니다) — 2개월로 좁히면 더 작다. 그래서 시간표 한 번에 끌어와도 가볍다.
 *
 * ⚠️ React `cache` — 한 요청에서 시간표 여러 뷰가 같이 쓴다(중복 왕복 방지).
 * ⚠️ **지난 주를 볼 때만** 호출할 것(이번 주·미래는 현재 담임이 정답이라 복원이 필요 없다).
 */
export const getTeacherAsOfIndex = cache(async (): Promise<TeacherAsOfIndex> => {
  const supabase = await createClient();
  const since = historyWindowStart(kstToday());

  const [logs, reports] = await Promise.all([
    // 담임 전이 — 이 반이 이 날부터 이 사람. metadata에 classId·newTeacherId가 **둘 다** 있는 것만
    // 쓸 수 있다(없던 시절 로그는 반이나 사람을 특정할 수 없어 제외 — 잘못 붙이느니 비우는 게 낫다).
    fetchAllPaged<{ metadata: Record<string, unknown> | null; created_at: string }>((from, to) =>
      supabase
        .from("audit_logs")
        .select("metadata, created_at")
        // 인수인계 적용 + **폼에서 담임을 바꾼 것**(class_update, 2026-08-04 신설) 둘 다가 전이다.
        .in("action", ["class_handover_apply", "class_update"])
        .gte("created_at", since)
        .order("created_at")
        .range(from, to),
    ).catch(() => []),
    // 반이 연결된 보고서의 작성자 — 월별 집계는 JS(539행 전체보다도 작은 2개월분이라 RPC 불필요).
    fetchAllPaged<{ class_id: string; report_date: string; teacher_name: string | null }>((from, to) =>
      supabase
        .from("lesson_reports")
        .select("class_id, report_date, teacher_name")
        .not("class_id", "is", null)
        .gte("report_date", since)
        .order("report_date")
        .range(from, to),
    ).catch(() => []),
  ]);

  const teacherIds = [
    ...new Set(
      logs
        .map((l) => (l.metadata?.newTeacherId as string | undefined) ?? null)
        .filter((v): v is string => !!v),
    ),
  ];
  const nameOf = new Map<string, string>();
  if (teacherIds.length > 0) {
    const { data } = await supabase.from("users").select("id, display_name").in("id", teacherIds);
    for (const u of data ?? []) nameOf.set(u.id as string, (u.display_name as string) ?? "");
  }

  const transitions: TeacherTransition[] = logs
    .map((l) => ({
      classId: (l.metadata?.classId as string | undefined) ?? "",
      date: String(l.created_at).slice(0, 10),
      teacherName: nameOf.get((l.metadata?.newTeacherId as string) ?? "") ?? null,
    }))
    .filter((t) => !!t.classId);

  const counts = new Map<string, MonthlyWriter>();
  for (const r of reports) {
    const name = (r.teacher_name ?? "").trim();
    if (!name) continue;
    const key = `${r.class_id}|${String(r.report_date).slice(0, 7)}|${name}`;
    const cur = counts.get(key);
    if (cur) cur.count += 1;
    else
      counts.set(key, {
        classId: r.class_id,
        month: String(r.report_date).slice(0, 7),
        teacherName: name,
        count: 1,
      });
  }

  return buildTeacherAsOfIndex({ transitions, writers: [...counts.values()], since });
});
