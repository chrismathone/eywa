import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { assignmentKey } from "../assignment";

type Db = ReturnType<typeof createAdminClient>;

/**
 * 원스크린 첫 화면용 — 그날 취소 기록 + **읽기 시작한 시각**(`readAt`, 화면 공급자의 `seenAt`). 시각은 조회 **전에** 잡는다 —
 * 조회와 같은 순간에 취소돼도 화면은 그 취소를 모른 쪽으로 판정된다(다시 켜 보내면 한 번 되돌린 뒤부터 받는다).
 */
export async function readVideoHomeworkCancels(tenantId: string, studentIds: string[], date: string): Promise<{ cancels: Map<string, string>; readAt: string }> {
  const readAt = new Date().toISOString();
  return { cancels: await getVideoHomeworkCancels(createAdminClient(), tenantId, studentIds, date), readAt };
}

/**
 * 장부에서 **취소한 영상 숙제**의 취소 시각(20261016130000 `video_homework_cancels`, 원장 2026-10-16) — `학생|날짜|반` → ISO 시각.
 * 원스크린 세션 초안은 보고서 값보다 이긴다(roster ⑤ 규약). 그래서 취소한 뒤에도 초안의 '있음'이 화면에 남고 발송 때 다시 적혔다 —
 * 원스크린을 열 때 이 기록이 있고 보고서가 '없음'이면 '없음'이 이긴다(`onescreen/page.tsx`).
 * 🔴 전원 핫패스(원스크린 첫 화면)라 실패는 삼켜 빈 지도로 둔다 — 표가 없는 DB(SQL 적용 전)도 종전 동작 그대로다(#95).
 */
export async function getVideoHomeworkCancels(db: Db, tenantId: string, studentIds: string[], date: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!studentIds.length) return out;
  try {
    const rows = await fetchAllPagedInChunks<{ class_id: string; student_id: string; homework_date: string; cancelled_at: string }>(
      [...new Set(studentIds)],
      (chunk, from, to) => db.from("video_homework_cancels").select("class_id,student_id,homework_date,cancelled_at")
        .eq("tenant_id", tenantId).eq("homework_date", date).in("student_id", chunk)
        .order("student_id").order("class_id").range(from, to),
    );
    for (const r of rows) out.set(assignmentKey(r.student_id, r.homework_date, r.class_id), r.cancelled_at);
  } catch (e) {
    console.warn(JSON.stringify({ level: "warn", scope: "getVideoHomeworkCancels", message: e instanceof Error ? e.message : String(e) }));
  }
  return out;
}

/**
 * 장부에서 취소한 뒤 **다시 내지 않은** 숙제인가 — 취소 기록이 있고, 그날 보고서 '있음'도 따로 낸 숙제도 없다.
 * 원스크린 '지난 수업 영상 숙제' 검사가 열어 둔 화면에서 그 숙제에 기록을 만들지 않게 한다(만들면 '검사 기록 칸'으로 되살아난다).
 * 못 읽으면 false(종전 동작 — 검사를 막지 않는다).
 */
export async function isCancelledHomework(db: Db, tenantId: string, key: { classId: string; studentId: string; date: string }): Promise<boolean> {
  const cancel = await db.from("video_homework_cancels").select("cancelled_at").eq("tenant_id", tenantId)
    .eq("class_id", key.classId).eq("student_id", key.studentId).eq("homework_date", key.date).limit(1);
  if (cancel.error || !cancel.data?.length) return false;
  const [report, extra] = await Promise.all([
    db.from("lesson_reports").select("id").eq("tenant_id", tenantId).eq("class_id", key.classId).eq("student_id", key.studentId)
      .eq("report_date", key.date).eq("video_homework", true).limit(1),
    db.from("video_homework_extra_issues").select("homework_date").eq("tenant_id", tenantId).eq("class_id", key.classId)
      .eq("student_id", key.studentId).eq("homework_date", key.date).limit(1),
  ]);
  if (report.error || extra.error) return false;
  return !report.data?.length && !extra.data?.length;
}

/**
 * 이 화면이 그 취소를 **모른 채** 보낸 '있음'인가 — 취소 기록이 있고, 화면이 영상 과제 값을 읽은 시각(`seenAt`)이 취소보다 이르다.
 * `seenAt`을 안 보낸 화면(이 판 전에 열어 둔 창)은 모른 것으로 본다. 기록을 못 읽으면 종전 동작(그대로 적기)으로 둔다.
 */
export async function cancelledAfterSeen(db: Db, tenantId: string, key: { classId: string; studentId: string; date: string },
  seenAt: string | null | undefined): Promise<boolean> {
  const { data, error } = await db.from("video_homework_cancels").select("cancelled_at").eq("tenant_id", tenantId)
    .eq("class_id", key.classId).eq("student_id", key.studentId).eq("homework_date", key.date).maybeSingle();
  if (error) {
    console.warn(JSON.stringify({ level: "warn", scope: "cancelledAfterSeen", message: error.message }));
    return false;
  }
  if (!data?.cancelled_at) return false;
  const seen = seenAt ? Date.parse(seenAt) : NaN;
  return Number.isNaN(seen) || Date.parse(String(data.cancelled_at)) > seen;
}
