import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchInChunks } from "@/lib/supabase/batch";
import { getSplitsTouchingClasses } from "@/features/class-splits/server/queries";
import type { ClassSplit } from "@/features/class-splits/rules";
import type { SplitClassNames } from "../lib/split-roster";

/**
 * ECS 시트(주간·오늘)가 쓰는 **수업 나누기 재료** — 그 반이 보내거나 받는 나눔(기간 [from, to]) + 상대 반 이름·담임.
 * 🔴 fail-soft — 표 미적용·조회 실패면 빈 결과다(강사 전원의 홈이라 이 기능 때문에 죽으면 안 된다, [[#95]]).
 * ⚠️ admin 클라이언트는 RLS를 우회한다 → 반 이름 조회에 `tenant_id` 필터 필수.
 */
export async function loadSplitsForSheet(
  admin: SupabaseClient,
  tenantId: string,
  classIds: readonly string[],
  from: string,
  to: string,
): Promise<{ splits: ClassSplit[]; names: SplitClassNames }> {
  try {
    const splits = await getSplitsTouchingClasses(classIds, from, to);
    if (splits.length === 0) return { splits, names: new Map() };
    const ids = [...new Set(splits.flatMap((s) => [s.sourceClassId, s.targetClassId]))];
    type Cls = { id: string; class_name: string; teacher?: { display_name?: string } | { display_name?: string }[] | null };
    const rows = await fetchInChunks<Cls>(ids, (c) =>
      admin
        .from("classes")
        .select("id, class_name, teacher:teacher_id ( display_name )")
        .eq("tenant_id", tenantId)
        .in("id", c),
    ).catch(() => [] as Cls[]);
    const names = new Map(
      rows.map((r) => {
        const t = Array.isArray(r.teacher) ? r.teacher[0] : r.teacher;
        return [r.id, { name: r.class_name, teacherName: t?.display_name ?? null }] as const;
      }),
    );
    return { splits, names };
  } catch (e) {
    console.error("[class-sheets] 수업 나누기 조회 실패 — 나눔 없이 표시", e);
    return { splits: [], names: new Map() };
  }
}

/** 쓰기 게이트 — 단일 소스는 class-splits(출석부 저장 게이트와 같은 함수). */
export { hasSplitInto } from "@/features/class-splits/server/queries";
