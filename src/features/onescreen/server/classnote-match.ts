import "server-only";

import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstToday, resolveReportDate } from "@/lib/date-kst";
import { getTenantSettings } from "@/features/owner/server/queries";
import { classnoteModuleOn } from "@/features/owner/classnote-gate";
import { isEnrollmentOnRosterOn } from "@/features/enrollments/eligibility";
import {
  buildCnMatchMap,
  CN_UNAVAILABLE,
  cnMatchVersion,
  cnMatchVersionOf,
  type CnMatchLoad,
  type CnMemberRow,
} from "../classnote-match";

const UNAVAILABLE_LOAD: CnMatchLoad = { map: CN_UNAVAILABLE, attending: [] };

/**
 * 원스크린 'C.N' 라벨 재료 — 0302a 두 표를 읽는다(학원 단위, 수백 행).
 *
 * 🔴 원스크린은 강사 전원이 매일 여는 핫패스다([[#95]]) — 로스터 쿼리에 섞지 않고 **따로** 부르며,
 *    표가 없거나(SQL 미적용) 조회가 실패하면 **예외 없이 `available:false`**(라벨만 안 그린다).
 * ⚠️ 행 수가 1,000을 넘을 수 있어(반 × 원아) 페이지네이션으로 전건(B2).
 *
 * `rosterDate` = 로스터가 보는 날짜(과거 날짜 허용 · 오늘 이후·잘못된 값은 오늘 — `resolveReportDate`, 로스터와 같은 해석).
 * '그날 다니는 반'(물음표 판정 재료)만 이 날짜로 보고, 종강 반 대상 판정은 **오늘** 기준이다(연결이 남은 종강 반 = 워커 규칙).
 * 🔴 오늘로 세면 지난 날짜 로스터에서 반을 옮긴 학생의 옛 반 줄이 물음표 대신 회색 + "관리자에게 알려 주세요"로 바뀐다
 *    (그 줄은 다음 동기화가 고치지 않는다 — 적대 리뷰 2026-11-04).
 * 돌려주는 `attending`은 서버 전용이다 — 페이지·라우트가 `pickCnForRoster`로 좁힐 때만 쓰고 클라이언트로 내려보내지 않는다.
 */
export async function loadClassnoteMatch(rosterDate?: string | null): Promise<CnMatchLoad> {
  try {
    // ClassNote 기능이 꺼진 학원은 라벨 자체가 없다(조회 0회 — 설정은 요청 캐시라 추가 비용 없음).
    if (!classnoteModuleOn(await getTenantSettings())) return UNAVAILABLE_LOAD;
    const supabase = await createClient();
    const today = kstToday();
    const day = resolveReportDate(rosterDate, today);
    const [members, boards, eligible, enrollments] = await Promise.all([
      // `id`·`synced_at`은 버전 값 재료(cnMatchVersionOf) — 가벼운 확인(getClassnoteMatchVersion)과 같은 값을 내야 한다.
      fetchAllPaged<CnMemberRow & { id: number }>((from, to) =>
        supabase
          .from("classnote_class_board_members")
          .select("id, class_id, student_id, status, child_name, reason")
          .order("id")
          .range(from, to),
      ),
      fetchAllPaged<{ class_id: string; board_name: string; synced_at: string | null }>((from, to) =>
        supabase.from("classnote_class_boards").select("class_id, board_name, synced_at").order("class_id").range(from, to),
      ),
      // 반 보드 대상 반 — 반 보드를 만든 기준(scripts/_classnote/math-class-boards-load.mjs)과 같은 조건.
      // 특강도 대상(원장 2026-09-30 — 특강 반 보드도 만든다). 종강 반은 연결이 남아 있는 동안만(아래).
      // 🔴 보고서 미발송 반은 대상이 아니다(원장 2026-11-04 *"JJ 미발송반은 클래스노트 반배정도 할 필요없음"*) — 그 반 줄엔 아이콘이 없다.
      fetchAllPaged<{ id: string; closed_at: string | null }>((from, to) =>
        supabase
          .from("classes")
          .select("id, closed_at")
          .in("subject", ["math", "subject_1"])
          .eq("is_active", true)
          .eq("report_optout", false)
          .order("id")
          .range(from, to),
      ),
      // 그날 다니는 (반, 학생) — 물음표('다른 반 보드에 배정됨') 판정 재료. 그날 걸치는 수강만(학원 단위 수백 행 · 페이지네이션 전건 B2).
      fetchAllPaged<{ class_id: string; student_id: string; start_date: string | null; end_date: string | null; is_transferred: boolean | null }>(
        (from, to) =>
          supabase
            .from("enrollments")
            .select("class_id, student_id, start_date, end_date, is_transferred")
            .or(`start_date.is.null,start_date.lte.${day}`)
            .or(`end_date.is.null,end_date.gte.${day}`)
            .order("id")
            .range(from, to),
      ),
    ]);
    const version = cnMatchVersionOf(members, boards);
    // 반 보드 연결이 하나도 없으면 아직 동기화 전이다 — 전원 빨간불로 겁주지 않는다(버전은 싣는다 — 연결이 생기면 갱신이 안다).
    if (boards.length === 0) return { map: { ...CN_UNAVAILABLE, version }, attending: [] };
    // 종강 반 = 연결이 남아 있으면(ClassNote 보드가 살아 있으면 매일 동기화가 지킨다) 그대로 대상 — 워커 isClassRouteEligible과 같은 규칙.
    const linked = new Set(boards.map((b) => b.class_id));
    const eligibleIds = eligible.filter((c) => !c.closed_at || c.closed_at >= today || linked.has(c.id)).map((c) => c.id);
    // 기록은 대상 반 것만 — 보고서 미발송 반은 동기화 대상이 아니다(2026-11-04 되돌림: 11-03에 잠깐 미발송 반도 연결·기록했다).
    // 그때 남은 기록이 있어도 수학 반 줄의 물음표 근거로 새지 않게 여기서 거른다.
    const eligibleSet = new Set(eligibleIds);
    // 그날 다니는 반 = 명단 판정 단일 소스(`isEnrollmentOnRosterOn` — 반이동은 반열림 #125 · 휴원은 다니는 것으로 본다:
    // 그 반 보드 배정은 그대로 정당하다).
    const attending = enrollments
      .filter(
        (e) =>
          eligibleSet.has(e.class_id) &&
          isEnrollmentOnRosterOn({ startDate: e.start_date ?? "", endDate: e.end_date, isTransferred: e.is_transferred === true }, day),
      )
      .map((e) => ({ class_id: e.class_id, student_id: e.student_id }));
    const map = buildCnMatchMap(members.filter((m) => eligibleSet.has(m.class_id)), boards, eligibleIds, attending);
    return { map: { ...map, version }, attending };
  } catch {
    return UNAVAILABLE_LOAD;
  }
}

/**
 * 매칭 표 **버전만** — 원스크린이 새로고침 없이 갱신할 때(원장 2026-11-04) 60초마다 묻는다. 행을 받지 않는다
 * (행 수는 head 카운트 · 번호·시각은 맨 위 한 줄). 전체 조회(`loadClassnoteMatch`)와 **같은 값**을 낸다 — 같은 표 · 같은 RLS
 * (사용자 클라이언트 = 그 지점 행만) · 같은 `cnMatchVersion`. 기능이 꺼졌거나 못 읽으면 null(화면은 그대로 둔다).
 */
export async function getClassnoteMatchVersion(): Promise<string | null> {
  try {
    if (!classnoteModuleOn(await getTenantSettings())) return null;
    const supabase = await createClient();
    const [memberCount, memberTop, boardCount, boardTop] = await Promise.all([
      supabase.from("classnote_class_board_members").select("id", { count: "exact", head: true }),
      supabase.from("classnote_class_board_members").select("id").order("id", { ascending: false }).limit(1),
      supabase.from("classnote_class_boards").select("class_id", { count: "exact", head: true }),
      supabase.from("classnote_class_boards").select("synced_at").order("synced_at", { ascending: false }).limit(1),
    ]);
    if (memberCount.error || memberTop.error || boardCount.error || boardTop.error) return null;
    const topId = Number((memberTop.data as { id: number | string | null }[] | null)?.[0]?.id ?? NaN);
    const topAtRaw = (boardTop.data as { synced_at: string | null }[] | null)?.[0]?.synced_at;
    const topAt = topAtRaw ? Date.parse(topAtRaw) : NaN;
    return cnMatchVersion({
      memberCount: memberCount.count ?? 0,
      maxMemberId: Number.isFinite(topId) ? topId : null,
      boardCount: boardCount.count ?? 0,
      maxSyncedAt: Number.isFinite(topAt) ? topAt : null,
    });
  } catch {
    return null;
  }
}
