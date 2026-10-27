"use server";
import { z } from "zod";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstDateOf } from "@/lib/date-kst";
import { getAssignedVideoHomework } from "@/features/video-homework/server/assignments";
import { loadClassVideos } from "@/features/video-homework/server/ledger-queries";
import { videoHomeworkOutcomes } from "@/features/video-homework/auto-outcomes";
import type { VideoHomeworkMark } from "@/features/video-homework/types";
import { getLiveContext } from "./live-context";
import { getContributionReadIdentity } from "./identity-query";
import { isMonth } from "../model/dates";

const inputSchema = z.object({ studentId: z.string().uuid(), month: z.string().refine(isMonth) });
/** 요청한 학생의 현재 원본만 읽는다. 저장된 월 실적이나 점수는 바꾸지 않는다. */
export async function readContributionVideoCheck(input: unknown) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { error: "학생과 조회 월을 확인해 주세요." };
  try {
    const { studentId, month } = parsed.data, c = await getLiveContext(studentId);
    if (!c) return { error: "이 학생의 기록을 열람할 수 없습니다." };
    if (month < "2026-01" || month > c.today.slice(0, 7)) return { error: "영상 숙제 판정은 2026년 이후 기록을 확인합니다." };
    const identity = await getContributionReadIdentity();
    const ids = identity.ids.filter(id => identity.resolve(id) === studentId && (c.readable === null || c.readable.has(id)));
    if (!ids.includes(studentId)) return { error: "학생의 연결 기록을 확인하지 못했습니다." };
    const db = createAdminClient();
    const from = "2026-01-01";
    const [assignmentGroups, videos, marks] = await Promise.all([
      Promise.all(ids.map(id => getAssignedVideoHomework(c.tenant, from, c.today, { studentId: id }))),
      loadClassVideos(c.tenant, ids, from, c.today, true),
      fetchAllPagedInChunks<{ class_id: string; student_id: string; check_date: string; homework_date: string; status: VideoHomeworkMark["status"] }>(ids, (chunk, a, b) => db
        .from("video_homework_marks").select("class_id,student_id,check_date,homework_date,status")
        .eq("tenant_id", c.tenant).in("student_id", chunk).gte("homework_date", from).lte("homework_date", c.today).order("id").range(a, b)),
    ]);
    if (assignmentGroups.some(group => group === null) || videos === null) return { error: "영상 숙제 원본을 읽지 못했습니다. 다시 시도해 주세요." };
    const assignments = assignmentGroups.flatMap(group => group ?? []);
    const remap = <T extends { studentId: string }>(rows: T[]) => rows.filter(r => ids.includes(r.studentId)).map(r => ({ ...r, studentId }));
    const { outcomes } = videoHomeworkOutcomes(remap(assignments), remap(videos), c.today, from, marks.map((m) => ({ classId: m.class_id, studentId,
      checkDate: m.check_date, homeworkDate: m.homework_date, status: m.status })));
    const rows = outcomes.filter((o) => o.homeworkDate.startsWith(`${month}-`)).sort((a, b) => a.homeworkDate.localeCompare(b.homeworkDate) || a.classId.localeCompare(b.classId));
    return { data: { checkedAt: c.checkedAt, current: month === c.today.slice(0, 7),
      uploaded: videos.filter((v) => v.playback && kstDateOf(v.postedAt)?.startsWith(`${month}-`)).length,
      rows: rows.map((r) => ({ classId: r.classId, date: r.homeworkDate, status: r.status, videoId: r.videoId })) } };
  } catch { return { error: "영상 숙제 원본을 확인하지 못했습니다. 다시 시도해 주세요." }; }
}
