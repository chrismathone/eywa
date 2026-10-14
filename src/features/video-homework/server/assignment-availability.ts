import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { addDays } from "@/lib/date-kst";
import { isOtherSubjectVideo, isVideoAssignableToDate, videoAssignmentRange } from "../video-assignment";
import { ledgerPairKey } from "../ledger";
import { isVideoHomeworkDate } from "../types";

type AssignmentRow = { classId: string; studentId: string; assignedDates: string[] };
type AssignmentCandidate = { id: string; studentId: string; postedAt: string; classId?: string | null; subject?: string | null };

/** 배정일이 정해지거나 집계에서 제외된 영상은 빼고 읽는다. 자동 배정 여부는 장부 판정 후 확인한다. */
export async function loadVideoAssignmentCandidates(tenantId: string, rows: AssignmentRow[]): Promise<AssignmentCandidate[] | null> {
  const candidates = rows.filter(row => row.assignedDates.length);
  const range = videoAssignmentRange(candidates.flatMap(row => row.assignedDates));
  if (!range) return [];
  try {
    const db = createAdminClient();
    const videos = await fetchAllPagedInChunks<{ id: string; student_id: string; posted_at: string; route: unknown; subject: string | null }>(
      [...new Set(candidates.map(row => row.studentId))], (chunk, from, to) => db.from("homework_video_ledger_videos")
        .select("id,student_id,posted_at,route,subject").eq("tenant_id", tenantId).in("student_id", chunk).eq("status", "uploaded")
        .not("drive_file_id", "is", null)
        .gte("posted_at", `${range.from}T00:00:00+09:00`).lt("posted_at", `${addDays(range.to, 1)}T00:00:00+09:00`)
        .order("id").range(from, to));
    return videos.flatMap(video => {
      const route = video.route && typeof video.route === "object" ? video.route as Record<string, unknown> : {};
      if (route.excluded === true || (typeof route.classId === "string" && route.classId
        && typeof route.homeworkDate === "string" && isVideoHomeworkDate(route.homeworkDate))) return [];
      return [{ id: video.id, studentId: video.student_id, postedAt: video.posted_at,
        classId: typeof route.classId === "string" ? route.classId : null, subject: video.subject ?? null }];
    });
  } catch (e) {
    console.warn(JSON.stringify({ level: "warn", scope: "videoHomeworkLedger.assignmentAvailability", message: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}

/**
 * '영상 배정'을 띄울 줄 — 붙지 않은 영상이 **아직 영상이 없는 숙제 칸**(미확인 · 미수행 · 손으로 찍은 '수동' 완료 · 검사 기록 칸)에 들어갈 수 있을 때만.
 * 다른 반이나 조회 기간 밖 숙제에 자동 연결된 영상도 다시 세지 않는다. 호출부는 `assignedDates`에 그 칸의 숙제일만 넣는다(원장 2026-10-13
 * *"오해를 불러일으키겠는데"* — 숙제가 다 영상으로 채워졌는데도 지난 숙제의 옛 영상 하나 때문에 버튼이 떠서 "배정이 안 됐다"로 읽혔다 ·
 * 2026-10-14 *"수동 영상들 다 학생들이 업로드해서 배정하고 싶은데 배정이 불가능함"* — '수동' 완료 칸은 영상이 없어 붙일 자리다).
 * `subjectOf`(반 → 과목)를 주면 확실히 다른 과목 영상은 세지 않는다(배정 창 목록과 같은 판정).
 */
export function unassignedVideoPairs(rows: AssignmentRow[], videos: AssignmentCandidate[], assignedVideoIds: ReadonlySet<string>,
  subjectOf?: (classId: string) => string | null | undefined): Set<string> {
  const byStudent = new Map<string, AssignmentCandidate[]>();
  for (const video of videos) {
    if (assignedVideoIds.has(video.id)) continue;
    byStudent.set(video.studentId, [...(byStudent.get(video.studentId) ?? []), video]);
  }
  return new Set(rows.filter(row => (byStudent.get(row.studentId) ?? []).some(video =>
    !(subjectOf && isOtherSubjectVideo({ classSubject: video.classId ? subjectOf(video.classId) : null, subject: video.subject }, subjectOf(row.classId)))
    && row.assignedDates.some(date => isVideoAssignableToDate(video.postedAt, date)))).map(ledgerPairKey));
}
