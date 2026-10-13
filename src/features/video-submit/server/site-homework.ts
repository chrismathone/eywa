import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { addDays } from "@/lib/date-kst";
import { buildLedgerRounds, roundPairKey, videoArrivedAt, videoFingerprint, videoMatchRange } from "@/features/video-homework/rounds";
import { videoHomeworkColumnReady } from "@/features/video-homework/server/assignments";
import { isVideoHomeworkDate, type VideoArrival, type VideoHomeworkMark, type VideoHomeworkStatus } from "@/features/video-homework/types";
import { homeworkVideoLinks } from "@/features/students/homework-videos";
import { SITE_HOMEWORK_DAYS } from "../site";
import { homeworkVideoSource } from "@/features/video-homework/server/video-source";
import { findExtraIssue, listExtraIssuesFor } from "@/features/video-homework/server/extra-issues";

type Db = ReturnType<typeof createAdminClient>;
export type HomeworkPair = { studentId: string; classId: string };

/**
 * 한 조회가 받는 행의 상한 — 학생 몇 명의 70여 일치라 닿을 일이 없다. 닿으면 조용히 자르지 않고 던진다(B2).
 * 🔴 PostgREST는 1,000행에서 자른다 — 그보다 큰 상한은 걸릴 수 없는 가드다. 상한보다 한 줄 더 받아 "넘쳤다"를 본다.
 */
const ROW_LIMIT = 500;

/**
 * 그 학생 × 반에 선생님이 낸 **영상 숙제 중 아직 안 낸 것**(숙제일, 최신순) — 원장 2026-10-03 *"사전에 선생님이 숙제로 낸 리스트가
 * 있어야 업로드 링크 보이도록 하고, 숙제 리스트에서 고르도록"*.
 *
 * 🔑 판정은 영상 제출 현황과 **같은 함수**(`buildLedgerRounds`)다 — 숙제 = 보고서의 '영상 과제 있음'(`video_homework = true`),
 *    낸 것 = 짝지어진 영상. 직접 찍은 완료만으로는 학생의 업로드를 막지 않는다. 재료도 같은 범위(`videoMatchRange`)로 읽어야 "가장 오래된 미확인 숙제부터"의
 *    짝이 장부와 같게 나온다(범위가 다르면 사이트는 안 냈다는데 장부는 냈다고 한다).
 *  · 올릴 수 있는 숙제 = 숙제일이 오늘에서 `SITE_HOMEWORK_DAYS`(7일) 안(원장 2026-10-03 *"숙제날짜 기준 7일"*) — 장부가 영상을 그 숙제로
 *    세는 창(`VIDEO_MATCH_WINDOW_DAYS`, 2주)보다 짧아, 사이트로 올린 영상은 늘 그 숙제 칸에 닿는다.
 *  · 미수행(✕)으로 찍힌 숙제도 목록에 선다(늦게라도 올릴 수 있다 — 칸의 표시는 선생님이 찍은 기록이 그대로 이긴다).
 *    🔴 다만 **그 숙제를 골라 올린 영상이 이미 있으면 뺀다** — ✕ 칸은 영상을 받아도 완료로 바뀌지 않아(직접 찍은 기록이 이긴다),
 *    빼지 않으면 올린 숙제가 기한 내내 목록에 남아 학생이 같은 영상을 되풀이해 올린다(화면은 "이미 낸 숙제는 나오지 않는다"고 말한다).
 * 🔴 로그인 없는 화면이 부른다 — 전부 그 지점·그 학생·그 반으로 좁힌다(admin은 RLS를 우회한다, [[#104]]).
 * `null` = 보고서의 영상 과제 칸을 읽을 수 없다(0308a 전, [[#95]]) — 호출부는 "지금은 받을 수 없다"로 닫는다(숙제 없음으로 읽지 않는다).
 * 영상 표를 못 읽으면 영상 없이 판정한다(장부와 같다 — 이미 낸 숙제가 목록에 남을 수 있을 뿐이다).
 * 영상도 그 반으로 분류된 것만 받는다(다른 과목 반에 올린 영상이 행 상한을 먹지 않게 — 다른 반 영상은 이 반 칸에 안 붙고, 같은 파일 판정도 반 × 학생 단위다).
 */
export async function openHomeworkDates(db: Db, tenantId: string, pairs: readonly HomeworkPair[], today: string): Promise<Map<string, string[]> | null> {
  const out = new Map<string, string[]>();
  if (!pairs.length) return out;
  if (!(await videoHomeworkColumnReady(db))) return null;
  const students = [...new Set(pairs.map((p) => p.studentId))];
  const classes = [...new Set(pairs.map((p) => p.classId))];
  const wanted = new Set(pairs.map(roundPairKey));
  const from = addDays(today, -SITE_HOMEWORK_DAYS);
  const wide = videoMatchRange(from, today, today);
  const videoSource = await homeworkVideoSource(db);
  const [reports, extra, marks, videos] = await Promise.all([
    db.from("lesson_reports").select("student_id,class_id,report_date")
      .eq("tenant_id", tenantId).eq("video_homework", true).in("student_id", students).in("class_id", classes)
      .gte("report_date", wide.from).lt("report_date", addDays(today, 1)).order("id", { ascending: true }).limit(ROW_LIMIT + 1),
    // 보고서 없이 따로 낸 숙제(원장 2026-10-13)도 같은 숙제다 — 학생이 골라 올릴 수 있어야 한다.
    listExtraIssuesFor(db, tenantId, { studentIds: students, classIds: classes, fromDate: wide.from, toDate: today, limit: ROW_LIMIT + 1 }),
    db.from("video_homework_marks").select("class_id,student_id,check_date,homework_date,submitted_date,status,updated_at")
      .eq("tenant_id", tenantId).in("student_id", students).in("class_id", classes)
      .gte("check_date", wide.from).order("id", { ascending: true }).limit(ROW_LIMIT + 1),
    db.from(videoSource).select("id,student_id,post_id,posted_at,created_at,uploaded_at,md5,bytes,route,drive_file_id")
      .eq("tenant_id", tenantId).in("student_id", students).in("route->>classId", classes)
      .eq("status", "uploaded").not("drive_file_id", "is", null)
      .or(`posted_at.gte.${wide.from}T00:00:00+09:00,route->>manualAssignment.eq.true`).order("id", { ascending: true }).limit(ROW_LIMIT + 1),
  ]);
  if (reports.error) throw new Error("영상 숙제 조회 실패");
  if (marks.error) throw new Error("영상 숙제 기록 조회 실패");
  const reportRows = (reports.data ?? []) as Array<{ student_id: string; class_id: string | null; report_date: string }>;
  const markRows = (marks.data ?? []) as Array<{ class_id: string; student_id: string; check_date: string; homework_date: string | null;
    submitted_date: string | null; status: string; updated_at: string | null }>;
  const videoRows = videos.error ? [] : ((videos.data ?? []) as Array<{ id: string; student_id: string; post_id?: number | null; posted_at: string;
    created_at?: string | null; uploaded_at?: string | null; md5?: string | null; bytes?: number | string | null; route: unknown; drive_file_id: string | null }>);
  if (reportRows.length > ROW_LIMIT || extra.length > ROW_LIMIT || markRows.length > ROW_LIMIT || videoRows.length > ROW_LIMIT) throw new Error("영상 숙제 조회 범위 초과");

  const assigned = new Map<string, Set<string>>();
  const issued = [...reportRows.map((r) => ({ classId: r.class_id, studentId: r.student_id, date: r.report_date })), ...extra];
  for (const r of issued) {
    if (!r.classId) continue;
    const key = roundPairKey({ classId: r.classId, studentId: r.studentId });
    if (wanted.has(key)) (assigned.get(key) ?? assigned.set(key, new Set()).get(key)!).add(r.date);
  }
  const videoArrivals = videoRows.flatMap((row): VideoArrival[] => {
    const route = row.route && typeof row.route === "object" && !Array.isArray(row.route) ? (row.route as Record<string, unknown>) : {};
    const links = homeworkVideoLinks(row.drive_file_id);
    if (!links || route.excluded === true) return [];
    const classId = typeof route.classId === "string" ? route.classId : null;
    const picked = typeof route.homeworkDate === "string" && route.homeworkDate ? route.homeworkDate : null;
    const arrivedAt = videoArrivedAt({ createdAt: row.created_at, postedAt: row.posted_at, uploadedAt: row.uploaded_at, fromClassnote: row.post_id != null, picked: !!picked });
    return classId ? [{ id: row.id, studentId: row.student_id, classId, postedAt: row.posted_at, arrivedAt, homeworkDate: picked,
      playback: { ...links, uploadedAt: row.uploaded_at ?? null },
      manuallyAssigned: route.manualAssignment === true, free: route.free === true,
      fingerprint: videoFingerprint(row.md5, row.bytes) }] : [];
  });
  const rounds = buildLedgerRounds({
    rows: pairs.map((p) => ({ classId: p.classId, studentId: p.studentId, assignedDates: [...(assigned.get(roundPairKey(p)) ?? [])].sort(), tracked: true })),
    marks: markRows.map((row): VideoHomeworkMark => ({ classId: row.class_id, studentId: row.student_id, checkDate: row.check_date,
      homeworkDate: row.homework_date, submittedDate: row.submitted_date ?? null, status: row.status as VideoHomeworkStatus, updatedAt: row.updated_at })),
    videos: videoArrivals,
    fromDate: from,
    toDate: today,
  });
  for (const p of pairs) {
    const key = roundPairKey(p);
    const dates = (rounds.get(key) ?? [])
      .filter((round) => round.assigned && !!round.homeworkDate && !round.videoId)
      .map((round) => round.homeworkDate!)
      .sort((a, b) => b.localeCompare(a));
    if (dates.length) out.set(key, dates);
  }
  return out;
}

/**
 * 그날이 그 학생 × 반에 **실제로 나간 영상 숙제**이고 아직 올릴 수 있는 기간(숙제일 + 7일) 안인가 — 업로드 시작·제출 화면이 주소의 숙제일을
 * 그대로 믿지 않고 여기서 다시 확인한다. 이미 낸 숙제여도 참이다(같은 숙제에 영상을 한 번 더 올리는 것을 막지 않는다).
 * 🔴 영상 과제 칸을 읽을 수 없으면(0308a 전·순간 오류) **던진다** — "숙제가 아니다"로 읽으면 올리기 사이트 링크가 "숙제를 다시 고르라"며
 *    학생을 돌려보낸다(조회 쪽은 같은 상황을 "지금은 받을 수 없다"로 닫는다 — 같은 원칙).
 */
export async function isAssignedHomeworkDate(db: Db, tenantId: string, pair: HomeworkPair, date: unknown, today: string): Promise<boolean> {
  if (typeof date !== "string" || !isVideoHomeworkDate(date)) return false;
  if (date > today || date < addDays(today, -SITE_HOMEWORK_DAYS)) return false;
  if (!(await videoHomeworkColumnReady(db))) throw new Error("영상 과제 값을 읽을 수 없습니다");
  const [{ data, error }, extra] = await Promise.all([
    db.from("lesson_reports").select("id")
      .eq("tenant_id", tenantId).eq("student_id", pair.studentId).eq("class_id", pair.classId)
      .eq("report_date", date).eq("video_homework", true).limit(1),
    findExtraIssue(db, tenantId, { classId: pair.classId, studentId: pair.studentId, date }),
  ]);
  if (error) throw new Error("영상 숙제 확인 실패");
  return (data ?? []).length > 0 || extra !== null;
}
