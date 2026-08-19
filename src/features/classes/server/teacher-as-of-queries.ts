import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { fetchAllPaged } from "@/lib/supabase/batch";
import {
  buildHomeroomSinceIndex,
  buildTeacherAsOfIndex,
  buildUniqueClassNameIndex,
  historyWindowStart,
  resolveTransitionClassId,
  type HomeroomSinceIndex,
  type MonthlyWriter,
  type TeacherAsOfIndex,
  type TeacherTransition,
} from "../teacher-as-of";

/**
 * 담임 전이(감사로그) — **두 질문의 공용 원자료**(이름 기준 `getTeacherAsOfIndex` · id 기준
 * `getHomeroomSinceIndex`). 조회를 두 벌로 짜면 창·매칭 규칙이 갈라진다.
 *
 * 🔴 **`class_handover_apply`는 metadata에 classId를 남기지 않는다**(실측 2026-08-19: 최근 2개월 전건).
 *    그래서 옛 코드처럼 `metadata.classId`만 보면 인계 기록이 **통째로** 버려졌고, "그 주 담임" 복원은
 *    사실 등급(①) 없이 보고서 작성자 추정(②)만으로 돌고 있었다. `target_label`(반 이름)로 잇되
 *    **이름이 유일할 때만** 쓴다(resolveTransitionClassId 주석 — 잘못 붙이느니 비운다).
 * ⚠️ React `cache` — 한 요청에서 시간표·출석부가 같이 물어도 왕복 1회.
 */
const loadTeacherTransitions = cache(
  async (): Promise<{ transitions: TeacherTransition[]; since: string }> => {
    const supabase = await createClient();
    const since = historyWindowStart(kstToday());

    // 로그와 반 이름 인덱스는 서로 독립이라 병렬(B4).
    const [logs, classRows] = await Promise.all([
      fetchAllPaged<{ metadata: Record<string, unknown> | null; target_label: string | null; created_at: string }>(
        (from, to) =>
          supabase
            .from("audit_logs")
            .select("metadata, target_label, created_at")
            // 인수인계 적용 + **폼에서 담임을 바꾼 것**(class_update, 2026-08-04 신설) 둘 다가 전이다.
            .in("action", ["class_handover_apply", "class_update"])
            .gte("created_at", since)
            .order("created_at")
            .range(from, to),
      ).catch(() => []),
      // 🔴 whitelist(이름→id)라 무페이징 select 금지(B2). 활성/비활성 **전부** 담는다 —
      //    종강한 반의 옛 인계도 이력이고, 중복 이름 판정은 좁게 보면 거짓 유일이 된다.
      fetchAllPaged<{ id: string; class_name: string | null }>((from, to) =>
        supabase.from("classes").select("id, class_name").order("id").range(from, to),
      ).catch(() => []),
    ]);

    const classIdByUniqueName = buildUniqueClassNameIndex(
      classRows.map((c) => ({ id: c.id, name: c.class_name })),
    );

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
      .map((l) => {
        const teacherId = (l.metadata?.newTeacherId as string | undefined) ?? null;
        return {
          classId:
            resolveTransitionClassId({
              metaClassId: (l.metadata?.classId as string | undefined) ?? null,
              targetLabel: l.target_label,
              classIdByUniqueName,
            }) ?? "",
          date: String(l.created_at).slice(0, 10),
          teacherId,
          teacherName: teacherId ? (nameOf.get(teacherId) ?? null) : null,
        };
      })
      // 담임이 안 바뀐 `class_update`(강의실만 고침 등)는 전이가 아니다 — newTeacherId가 없다.
      .filter((t) => !!t.classId && !!t.teacherId);

    return { transitions, since };
  },
);

/**
 * "이 사람이 이 반 담임이 된 날" 인덱스(id 기준) — 강사 축 출석부가 **담임 이전 칸**을 가리는 데 쓴다.
 *
 * 🔴 원장 제보 2026-08-19: *"김주현 선생님이 출결한것도 아닌데 보이는것도 같이 수정해야겠네."*
 *    `classes.teacher_id`는 **현재** 담임이라 시간 축이 없다 → 인수인계(8/10·8/14) 이전인 8/3~8/10
 *    기록(전임이 넣은 것)이 새 담임 출석부에 그대로 떴다.
 * ⚠️ 보고서 작성자 폴백은 **쓰지 않는다**(teacher-as-of.ts 주석 — 작성자는 담임이 아니다). 그래서 이
 *    로더는 `lesson_reports`를 아예 읽지 않는다(출석부에 얹히는 왕복도 그만큼 적다).
 */
export const getHomeroomSinceIndex = cache(async (): Promise<HomeroomSinceIndex> => {
  const { transitions, since } = await loadTeacherTransitions();
  return buildHomeroomSinceIndex(transitions, since);
});

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

  // 전이(공용 로더)와 보고서 작성자는 서로 독립이라 병렬(B4).
  const [{ transitions, since }, reports] = await Promise.all([
    loadTeacherTransitions(),
    // 반이 연결된 보고서의 작성자 — 월별 집계는 JS(539행 전체보다도 작은 2개월분이라 RPC 불필요).
    fetchAllPaged<{ class_id: string; report_date: string; teacher_name: string | null }>((from, to) =>
      supabase
        .from("lesson_reports")
        .select("class_id, report_date, teacher_name")
        .not("class_id", "is", null)
        .gte("report_date", historyWindowStart(kstToday()))
        .order("report_date")
        .range(from, to),
    ).catch(() => []),
  ]);

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
