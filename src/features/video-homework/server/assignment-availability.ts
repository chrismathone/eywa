import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { addDays } from "@/lib/date-kst";
import { isVideoAssignableToDate, videoAssignmentRange } from "../video-assignment";
import { ledgerPairKey } from "../ledger";
import { isVideoHomeworkDate } from "../types";

type AssignmentRow = { classId: string; studentId: string; assignedDates: string[] };
type AssignmentCandidate = { id: string; studentId: string; postedAt: string };

/** 배정일이 정해지거나 집계에서 제외된 영상은 빼고 읽는다. 자동 배정 여부는 장부 판정 후 확인한다. */
export async function loadVideoAssignmentCandidates(tenantId: string, rows: AssignmentRow[]): Promise<AssignmentCandidate[] | null> {
  const candidates = rows.filter(row => row.assignedDates.length);
  const range = videoAssignmentRange(candidates.flatMap(row => row.assignedDates));
  if (!range) return [];
  try {
    const db = createAdminClient();
    const videos = await fetchAllPagedInChunks<{ id: string; student_id: string; posted_at: string; route: unknown }>(
      [...new Set(candidates.map(row => row.studentId))], (chunk, from, to) => db.from("homework_video_ledger_videos")
        .select("id,student_id,posted_at,route").eq("tenant_id", tenantId).in("student_id", chunk).eq("status", "uploaded")
        .not("drive_file_id", "is", null)
        .gte("posted_at", `${range.from}T00:00:00+09:00`).lt("posted_at", `${addDays(range.to, 1)}T00:00:00+09:00`)
        .order("id").range(from, to));
    return videos.flatMap(video => {
      const route = video.route && typeof video.route === "object" ? video.route as Record<string, unknown> : {};
      if (route.excluded === true || (typeof route.classId === "string" && route.classId
        && typeof route.homeworkDate === "string" && isVideoHomeworkDate(route.homeworkDate))) return [];
      return [{ id: video.id, studentId: video.student_id, postedAt: video.posted_at }];
    });
  } catch (e) {
    console.warn(JSON.stringify({ level: "warn", scope: "videoHomeworkLedger.assignmentAvailability", message: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}

/** 기간 안의 숙제에 붙일 미배정 영상이 남은 줄만. 다른 반이나 조회 기간 밖 숙제에 자동 연결된 영상도 다시 세지 않는다. */
export function unassignedVideoPairs(rows: AssignmentRow[], videos: AssignmentCandidate[], assignedVideoIds: ReadonlySet<string>): Set<string> {
  const byStudent = new Map<string, string[]>();
  for (const video of videos) {
    if (assignedVideoIds.has(video.id)) continue;
    const dates = byStudent.get(video.studentId) ?? [];
    dates.push(video.postedAt);
    byStudent.set(video.studentId, dates);
  }
  return new Set(rows.filter(row => (byStudent.get(row.studentId) ?? []).some(postedAt =>
    row.assignedDates.some(date => isVideoAssignableToDate(postedAt, date)))).map(ledgerPairKey));
}
