import "server-only";

import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { getTenantSettings } from "@/features/owner/server/queries";
import { classnoteModuleOn } from "@/features/owner/classnote-gate";
import { buildCnMatchMap, CN_UNAVAILABLE, type CnMatchMap, type CnMemberRow } from "../classnote-match";

/**
 * 원스크린 'C.N' 라벨 재료 — 0302a 두 표를 읽는다(학원 단위, 수백 행).
 *
 * 🔴 원스크린은 강사 전원이 매일 여는 핫패스다([[#95]]) — 로스터 쿼리에 섞지 않고 **따로** 부르며,
 *    표가 없거나(SQL 미적용) 조회가 실패하면 **예외 없이 `available:false`**(라벨만 안 그린다).
 * ⚠️ 행 수가 1,000을 넘을 수 있어(반 × 원아) 페이지네이션으로 전건(B2).
 */
export async function getClassnoteMatchMap(): Promise<CnMatchMap> {
  try {
    // ClassNote 기능이 꺼진 학원은 라벨 자체가 없다(조회 0회 — 설정은 요청 캐시라 추가 비용 없음).
    if (!classnoteModuleOn(await getTenantSettings())) return CN_UNAVAILABLE;
    const supabase = await createClient();
    const today = kstToday();
    const [members, boards, eligible] = await Promise.all([
      fetchAllPaged<CnMemberRow>((from, to) =>
        supabase
          .from("classnote_class_board_members")
          .select("class_id, student_id, status, child_name, reason")
          .order("id")
          .range(from, to),
      ),
      fetchAllPaged<{ class_id: string; board_name: string }>((from, to) =>
        supabase.from("classnote_class_boards").select("class_id, board_name").order("class_id").range(from, to),
      ),
      // 반 보드 대상 반 — 반 보드를 만든 기준(scripts/_classnote/math-class-boards-load.mjs)과 같은 조건.
      // 특강도 대상(원장 2026-09-30 — 특강 반 보드도 만든다). 종강 반은 연결이 남아 있는 동안만(아래).
      fetchAllPaged<{ id: string; class_name: string; is_special: boolean | null; closed_at: string | null }>((from, to) =>
        supabase
          .from("classes")
          .select("id, class_name, is_special, closed_at")
          .in("subject", ["math", "subject_1"])
          .eq("is_active", true)
          .eq("report_optout", false)
          .order("id")
          .range(from, to),
      ),
    ]);
    // 반 보드 연결이 하나도 없으면 아직 동기화 전이다 — 전원 빨간불로 겁주지 않는다.
    if (boards.length === 0) return CN_UNAVAILABLE;
    // 종강 반 = 연결이 남아 있으면(ClassNote 보드가 살아 있으면 매일 동기화가 지킨다) 그대로 대상 — 워커 isClassRouteEligible과 같은 규칙.
    const linked = new Set(boards.map((b) => b.class_id));
    const eligibleIds = eligible.filter((c) => !c.closed_at || c.closed_at >= today || linked.has(c.id)).map((c) => c.id);
    // 기록은 대상 반 것만 — 2026-11-03부터 동기화가 보고서 미발송 반(JJ)도 연결·기록한다. 그 기록이 섞이면 수학 반 줄이
    // 보류일 때 "배정된 반 보드: JJ…"(물음표)로 잘못 뜬다(그 학생의 보고서는 JJ 반 보드로 가지 않는다).
    const eligibleSet = new Set(eligibleIds);
    return buildCnMatchMap(members.filter((m) => eligibleSet.has(m.class_id)), boards, eligibleIds);
  } catch {
    return CN_UNAVAILABLE;
  }
}
