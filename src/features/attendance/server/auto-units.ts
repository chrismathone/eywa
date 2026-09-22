import "server-only";
/**
 * 수학 자동 시수 **서버 조회** — 출결 INSERT 경로 전부(단건·일괄·범위·일별 폼·키오스크)가 이 함수 하나를 지난다.
 * 규칙(과목·분 → 시수)은 순수 모듈 [`auto-units.ts`](../auto-units.ts) 한 벌.
 *
 * 🔴 **조회가 실패하면 자동값을 넣지 않는다**(빈 맵 = 종전처럼 null 저장) + console.error. 돈에 닿는 기본값을
 *    모르는 채로 지어내지 않는다 — 출결 저장 자체는 막지 않는다(출결이 진짜 기록이고 시수는 그 위의 값).
 * ⚠️ admin(service_role) 클라이언트는 RLS를 우회한다 → `tenantId`를 넘겨 두 조회에 모두 `tenant_id` 필터를 건다.
 * ⚠️ B2·B3 — 반이 수십 개일 수 있어 `.in()`은 청크, `class_schedules`는 **이력을 담는 표**라(#88)
 *    청크 안에서도 1,000행을 넘을 수 있어 `fetchAllPagedInChunks`(+ `order("id")`). 두 조회는 서로 독립이라 병렬(B4).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { createClient } from "@/lib/supabase/server";
import { getLessonProfile } from "@/features/owner/server/lesson-profile";
import {
  autoUnitsKey,
  planAutoUnits,
  toAutoUnitsSchedule,
  type AutoUnitsSchedule,
  type AutoUnitsTrack,
} from "../auto-units";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

type ScheduleRow = {
  class_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  valid_from: string;
  valid_to: string | null;
  slot_teacher_label: string | null;
  lab_separate?: boolean;
};

/**
 * (반, 날짜) 칸들 → `autoUnitsKey(반, 날짜)` → 자동 시수. 대상이 아니거나 1이면 키가 없다.
 * 호출부는 `autoUnitsApply`(숫자 안 고름 · 그날 전체 행 · 소비 상태)가 참인 **새 행**에 대해서만 부른다.
 */
export async function resolveAutoUnits(
  client: SupabaseClient,
  cells: readonly { classId: string; date: string }[],
  opts: { tenantId?: string } = {},
): Promise<Map<string, number>> {
  const valid = cells.filter((c) => !!c.classId && YMD.test(c.date));
  if (valid.length === 0) return new Map();
  // 새 학원(일반판)은 자동 시수가 없다 — 새 칸은 기본값(1). 침산 프로필은 켜져 있어 종전과 같다(lesson-profile.ts).
  if (!(await getLessonProfile(opts.tenantId)).autoUnits) return new Map();
  const classIds = [...new Set(valid.map((c) => c.classId))];
  const dates = [...new Set(valid.map((c) => c.date))].sort();
  const from = dates[0]!;
  const to = dates[dates.length - 1]!;
  try {
    const [classes, schedules] = await Promise.all([
      fetchInChunks<{ id: string; subject: string | null; english_track: string | null; class_name: string }>(classIds, (chunk) => {
        const q = client.from("classes").select("id, subject, english_track, class_name").in("id", chunk);
        return opts.tenantId ? q.eq("tenant_id", opts.tenantId) : q;
      }),
      fetchAllPagedInChunks<ScheduleRow>(classIds, (chunk, f, t) => {
        const q = client
          .from("class_schedules")
          .select("class_id, day_of_week, start_time, end_time, valid_from, valid_to, slot_teacher_label, lab_separate")
          .in("class_id", chunk)
          .lte("valid_from", to)
          .or(`valid_to.is.null,valid_to.gte.${from}`);
        return (opts.tenantId ? q.eq("tenant_id", opts.tenantId) : q)
          .order("id", { ascending: true })
          .range(f, t);
      }),
    ]);
    const subjectOf = new Map(classes.map((c) => [c.id, c.subject ?? null] as const));
    const trackOf = new Map<string, AutoUnitsTrack | null>(
      classes.map((c) => [c.id, c.english_track === "eie" || c.english_track === "injaewon" ? c.english_track : null]),
    );
    const schedulesOf = new Map<string, AutoUnitsSchedule[]>();
    for (const r of schedules) {
      const list = schedulesOf.get(r.class_id) ?? [];
      list.push(toAutoUnitsSchedule(r));
      schedulesOf.set(r.class_id, list);
    }
    return planAutoUnits(valid, subjectOf, schedulesOf, trackOf, new Map(classes.map((c) => [c.id, c.class_name])));
  } catch (e) {
    console.error("[auto-units] 수업 길이 조회 실패 — 자동 시수 없이 저장합니다:", e);
    return new Map();
  }
}

/** 한 반·한 날짜의 자동 시수(일별 입력 폼의 기본값 표시용). null = 자동 없음(=빈 칸은 1). */
export async function getAutoUnitsForClassDay(classId: string, date: string): Promise<number | null> {
  const supabase = await createClient();
  const map = await resolveAutoUnits(supabase, [{ classId, date }]);
  return map.get(autoUnitsKey(classId, date)) ?? null;
}
