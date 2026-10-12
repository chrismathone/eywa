import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { addDays } from "@/lib/date-kst";
import { isVideoAssignableToDate, videoAssignmentRange } from "../video-assignment";
import { ledgerPairKey } from "../ledger";

/** 장부에 보이는 숙제에 배정할 영상이 있는 줄만 찾는다. 다른 반·반 미지정 영상도 후보이므로 자동 집계 조회와 분리한다. */
export async function loadVideoAssignmentAvailability(tenantId: string,
  rows: { classId: string; studentId: string; assignedDates: string[] }[],
): Promise<Set<string> | null> {
  const candidates = rows.filter(row => row.assignedDates.length);
  const range = videoAssignmentRange(candidates.flatMap(row => row.assignedDates));
  if (!range) return new Set();
  try {
    const db = createAdminClient();
    const videos = await fetchAllPagedInChunks<{ student_id: string; posted_at: string }>(
      [...new Set(candidates.map(row => row.studentId))], (chunk, from, to) => db.from("homework_video_ledger_videos")
        .select("student_id,posted_at").eq("tenant_id", tenantId).in("student_id", chunk).eq("status", "uploaded")
        .not("drive_file_id", "is", null)
        .gte("posted_at", `${range.from}T00:00:00+09:00`).lt("posted_at", `${addDays(range.to, 1)}T00:00:00+09:00`)
        .order("id").range(from, to));
    const byStudent = new Map<string, string[]>();
    for (const video of videos) {
      const dates = byStudent.get(video.student_id) ?? [];
      dates.push(video.posted_at);
      byStudent.set(video.student_id, dates);
    }
    return new Set(candidates.filter(row => (byStudent.get(row.studentId) ?? []).some(postedAt =>
      row.assignedDates.some(date => isVideoAssignableToDate(postedAt, date)))).map(ledgerPairKey));
  } catch (e) {
    console.warn(JSON.stringify({ level: "warn", scope: "videoHomeworkLedger.assignmentAvailability", message: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}
