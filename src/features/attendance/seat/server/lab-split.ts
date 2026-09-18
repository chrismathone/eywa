import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { loadLabSeparateIds } from "@/features/classes/server/lab-separate";
import { labSplitKey } from "../lab-split";

type Db = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>;

/**
 * LAB실 **'따로 수업(*LAB)' 배정 재료** — 그 날 켜진 교시(0271a) + 켠 수강(0271b).
 *
 * 🔴 **fail-soft · 따로 읽는다**([[#95]]) — 자리 출석부는 매일 도는 화면이다. 기존 select에 두 칸을 끼우면 칸이
 *    없는 DB(롤백·새 환경)에서 명단 조회가 통째로 죽는다. 둘 중 하나라도 모르면 null → 호출부는 배정 없이
 *    **지금까지 명단 그대로** 그린다(모름을 "아무도 안 켰다"로 단정하지 않는다).
 * 🔑 세션 경로는 RLS, 공개(PIN) 경로는 admin + **명시 tenantId**(RLS 우회라 필터가 필수).
 */
export async function loadLabSplitInputs(
  supabase: Db,
  args: { classIds: readonly string[]; date: string; tenantId: string | null },
): Promise<{ separateIds: Set<string>; flagged: Set<string> } | null> {
  if (args.classIds.length === 0) return null;
  const [separateIds, flagged] = await Promise.all([
    loadLabSeparateIds(supabase, {
      kind: "window",
      from: args.date,
      to: args.date,
      ...(args.tenantId ? { tenantId: args.tenantId } : {}),
    }),
    loadFlaggedCells(supabase, args),
  ]);
  if (!separateIds || !flagged) return null;
  return { separateIds, flagged };
}

/** 켠 수강의 `(반|학생)` — 그 날 살아 있는 수강만. 실패·칸 없음이면 null. */
async function loadFlaggedCells(
  supabase: Db,
  args: { classIds: readonly string[]; date: string; tenantId: string | null },
): Promise<Set<string> | null> {
  try {
    const rows = await fetchInChunks<{
      class_id: string;
      student_id: string;
      start_date: string;
      end_date: string | null;
      on_hold: boolean | null;
      is_transferred: boolean | null;
    }>([...args.classIds], (chunk) => {
      // 날짜 조건은 넓은 프리필터 — 최종 판정은 isEnrollmentActiveOn(명단 조회와 같은 규약, queries.ts 주석).
      let q = supabase
        .from("enrollments")
        .select("class_id, student_id, start_date, end_date, on_hold, is_transferred")
        .eq("lab_separate", true)
        .in("class_id", chunk)
        .lte("start_date", args.date)
        .or(`end_date.is.null,end_date.gte.${args.date}`);
      if (args.tenantId) q = q.eq("tenant_id", args.tenantId);
      return q;
    });
    const out = new Set<string>();
    for (const r of rows) {
      if (
        !isEnrollmentActiveOn(
          {
            startDate: r.start_date,
            endDate: r.end_date,
            onHold: r.on_hold === true,
            isTransferred: r.is_transferred === true,
          },
          args.date,
        )
      )
        continue;
      out.add(labSplitKey(r.class_id, r.student_id));
    }
    return out;
  } catch {
    return null;
  }
}
