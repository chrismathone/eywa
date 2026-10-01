import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { buildBlankFacts, type BlankAttendanceRow, type BlankFacts } from "../no-homework";
import type { LedgerEnrollment } from "../ledger-roster";

const MAX_IN_DAYS = 100;

/**
 * 장부 빈 칸 사유(결석·숙제없음)의 재료 — 반 × 기간 범위로 **한 번에** 읽는다(학생·날짜별 요청 없음, 청크 × 페이징).
 * 🔴 `class_id` 청크 안에서도 1,000행에서 잘리므로 `fetchAllPagedInChunks`(+ 안정 정렬 id)를 쓴다.
 * 실패하면 null — 사유 칸만 빠지고(그 칸은 '—') 장부는 그대로 돈다.
 */
export async function loadBlankFacts(tenantId: string, input: {
  /** 반별 '숙제가 나간 날'(조회 기간 안) */
  classDates: Map<string, Set<string>>;
  /** (반 × 학생)별로 이미 회차가 있는 날 */
  ownDates: Map<string, Set<string>>;
  enrollments: LedgerEnrollment[];
}): Promise<BlankFacts | null> {
  const targets = [...input.ownDates].flatMap(([pair, own]) => {
    const [classId, studentId] = pair.split(":");
    const dates = [...input.classDates.get(classId) ?? []].filter((date) => !own.has(date)).sort();
    return dates.length ? [{ classId, studentId, dates }] : [];
  });
  if (!targets.length) return {};
  const classIds = [...new Set(targets.map((target) => target.classId))];
  const days = [...new Set(targets.flatMap((target) => target.dates))].sort();
  try {
    const db = createAdminClient();
    const records = await fetchAllPagedInChunks<BlankAttendanceRow>(classIds, (chunk, from, to) => {
      const query = db.from("attendance_records")
        .select("id,student_id,class_id,session_date,slot_start,status,recorded_at")
        .eq("tenant_id", tenantId).in("class_id", chunk);
      // 필요한 날(반에 숙제가 나간 날)만 — 기간 전체 출결을 끌어오지 않는다. 날이 너무 많으면(URL 길이) 범위로 폴백.
      const narrowed = days.length <= MAX_IN_DAYS ? query.in("session_date", days)
        : query.gte("session_date", days[0]).lte("session_date", days[days.length - 1]);
      return narrowed.order("id", { ascending: true }).range(from, to);
    });
    return buildBlankFacts({ targets, enrollments: input.enrollments, records });
  } catch (e) {
    console.warn(JSON.stringify({ level: "warn", scope: "videoHomeworkLedger.blankFacts", message: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}
