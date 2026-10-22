import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstDateOf, monthRange } from "@/lib/date-kst";
import type { SubjectSetting } from "@/features/owner/settings-types";
import type { StatsPeriod } from "@/features/stats/period";
import { kstDayBounds } from "../kst-bounds";
import { bucketIntake, type IntakeTrend } from "../intake-trend";
import { intakeGroupsOf } from "../intake-groups";

/**
 * 신규 문의 추이 조회 — 기간 안 콜&상담의 **상담일·과목 두 칸만** 받는다(B2: 전건 페이징 `fetchAllPaged` · 1,000행 절단 없음).
 * 24개월이어도 침산 기준 천여 행이다. RLS(`tenant_id`)는 사용자 클라이언트가 건다 — 권한은 화면의 `enrollment` 게이트.
 * 실패는 던진다(화면이 '못 불러옴'으로 적는다 — 0건으로 위장하지 않는다).
 */
export async function loadIntakeTrend(period: StatsPeriod, subjects: readonly SubjectSetting[], today: string): Promise<IntakeTrend> {
  const from = period.grain === "month" ? `${period.months[0]}-01` : period.from;
  // 오늘에서 자른다 — 엑셀로 넣은 미래 상담일이 이번 달 월별 칸에만 들어가 일별 합과 갈리지 않게(리뷰 2026-10-20).
  const monthEnd = period.grain === "month" ? monthRange(period.months.at(-1)!).to : period.to;
  const to = monthEnd > today ? today : monthEnd;
  const db = await createClient();
  const rows = await fetchAllPaged<{ consulted_at: string; subject: string | null }>((a, b) =>
    db
      .from("enrollment_consultations")
      .select("consulted_at, subject")
      .gte("consulted_at", kstDayBounds(from).startIso)
      .lt("consulted_at", kstDayBounds(to).endIso)
      .order("id")
      .range(a, b),
  );
  const groupsOf = intakeGroupsOf(subjects);
  return bucketIntake(
    rows.flatMap((r) => {
      const date = kstDateOf(r.consulted_at);
      return date ? [{ date, subject: r.subject }] : [];
    }),
    period,
    groupsOf,
  );
}
