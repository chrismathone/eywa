import "server-only";
/**
 * 강사 전체 보기 저장의 **몫 판정 재료 조회** — 규칙은 순수 모듈 [`scope-ownership.ts`](../scope-ownership.ts) 한 벌.
 *
 * 🔴 클라이언트가 보낸 건 "어느 강사의 보기인가"(id)뿐이다 — 그 강사 몫이 어느 행인지는 **여기서 DB로 다시** 푼다(#77).
 * ⚠️ 세션 클라이언트(RLS: tenant 격리)로 읽는다 — 남의 학원 반·교시는 안 보인다. 그래서 스코프 강사가 이 반의
 *    담임·교시 담당으로 잡히면(`scopeTeaches`) 곧 "이 학원에서 그 반을 맡은 강사"라는 검증이다.
 * ⚠️ 저장마다 도는 조회라 **두 개뿐**이다: `classes`(그 반들의 담임) · `class_schedules`(그 달들과 겹치는 교시).
 *    둘은 서로 독립이라 병렬(B4)이고, 호출부는 기존 기록 조회와도 병렬로 부른다. `.in()`은 청크, `class_schedules`는
 *    이력을 담는 표라(#88) 청크 안에서도 페이지네이션(+ `order("id")`).
 * 🔴 담임 시작일(감사로그 12개월·반 전체·직원 이름)은 **읽지 않는다** — 반응속도 1순위(2026-09-11). 그 값이 가르던
 *    인계일 이전 칸은 격자가 막는다(`buildScopeOwner` 주석). 여기에 `getHomeroomSinceIndex`를 다시 붙이지 말 것.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { monthRange } from "@/lib/date-kst";
import type { ScopeClassFacts } from "../scope-ownership";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

type ScheduleRow = {
  class_id: string;
  day_of_week: string;
  start_time: string | null;
  teacher_id: string | null;
  slot_teacher_label: string | null;
  valid_from: string;
  valid_to: string | null;
};

/**
 * (반, 날짜) 칸들 → 반 id → 판정 재료(담임 + 그 달들과 겹치는 교시 전부).
 * 🔴 날짜를 `.or()`에 넣으므로 형식부터 잠근다 — 형식이 아닌 칸은 재료가 없다(= 스코프 저장 거절).
 * 조회 실패는 **던진다**(헬퍼 규약) — 호출부가 받아 저장을 거절한다(모르는 채로 나누지 않는다).
 */
export async function loadScopeFacts(
  client: SupabaseClient,
  cells: readonly { classId: string; date: string }[],
): Promise<Map<string, ScopeClassFacts>> {
  const valid = cells.filter((c) => !!c.classId && YMD.test(c.date));
  if (valid.length === 0) return new Map();
  const classIds = [...new Set(valid.map((c) => c.classId))];
  const months = [...new Set(valid.map((c) => c.date.slice(0, 7)))].sort();
  // 역할(그 달 교시 담당) 판정이 달 단위라 달 전체와 겹치는 교시를 받는다(월간 매트릭스와 같은 창).
  const from = monthRange(months[0]!).from;
  const to = monthRange(months[months.length - 1]!).to;
  const [classes, schedules] = await Promise.all([
    fetchInChunks<{ id: string; teacher_id: string | null }>(classIds, (chunk) =>
      client.from("classes").select("id, teacher_id").in("id", chunk),
    ),
    fetchAllPagedInChunks<ScheduleRow>(classIds, (chunk, f, t) =>
      client
        .from("class_schedules")
        .select("class_id, day_of_week, start_time, teacher_id, slot_teacher_label, valid_from, valid_to")
        .in("class_id", chunk)
        .lte("valid_from", to)
        .or(`valid_to.is.null,valid_to.gte.${from}`)
        .order("id", { ascending: true })
        .range(f, t),
    ),
  ]);
  const out = new Map<string, ScopeClassFacts>();
  for (const c of classes) out.set(c.id, { homeroomTeacherId: c.teacher_id ?? null, slots: [] });
  for (const r of schedules) {
    const facts = out.get(r.class_id);
    if (!facts) continue;
    facts.slots.push({
      dayOfWeek: r.day_of_week,
      startTime: r.start_time ?? null,
      teacherId: r.teacher_id ?? null,
      slotTeacherLabel: r.slot_teacher_label ?? null,
      validFrom: r.valid_from,
      validTo: r.valid_to ?? null,
    });
  }
  return out;
}
