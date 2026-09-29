import "server-only";

import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { isSpecialLecture } from "@/features/classes/special-lecture";
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
      // 특강 판정은 앱 단일소스 isSpecialLecture(토글 또는 이름에 '특강')와 같다.
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
    const eligibleIds = eligible
      .filter((c) => !isSpecialLecture({ isSpecial: c.is_special, className: c.class_name }))
      .filter((c) => !c.closed_at || c.closed_at >= today)
      .map((c) => c.id);
    return buildCnMatchMap(members, boards, eligibleIds);
  } catch {
    return CN_UNAVAILABLE;
  }
}
