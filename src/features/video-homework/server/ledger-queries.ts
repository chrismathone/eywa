import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { addDays, kstToday } from "@/lib/date-kst";
import { buildVideoHomeworkLessonPairs, type LedgerClass, type LedgerEnrollment, type LedgerSchedule } from "../ledger-roster";
import { videoMatchRange } from "../rounds";
import type { VideoArrival, VideoHomeworkMark, VideoHomeworkRosterRow, VideoHomeworkStatus } from "../types";
import { getAssignedVideoHomework } from "./assignments";
import { loadBlankFacts } from "./blank-facts";
import type { BlankFacts } from "../no-homework";

type DbMark = { class_id: string; student_id: string; check_date: string; homework_date: string | null;
  submitted_date: string | null; status: string; updated_at: string | null };
type DbVideo = { id: string; student_id: string; posted_at: string; class_id: string | null };
export type VideoHomeworkLedgerBaseRow = VideoHomeworkRosterRow & { assignedDates: string[] };

/**
 * 학부모 숙제 영상(0315a `student_homework_videos`) — **반이 확인된 것만**(`route.classId`, 워커가 분류한 값)·게시 시각만 읽는다.
 * 🔴 표가 없거나(미적용 지점) 못 읽으면 null — 자동 집계만 빠지고 장부는 그대로 돈다(화면이 그 사실을 알린다).
 */
async function loadClassVideos(tenantId: string, studentIds: string[], fromDate: string, toDate: string): Promise<VideoArrival[] | null> {
  if (!studentIds.length) return [];
  try {
    const db = createAdminClient();
    const rows = await fetchAllPagedInChunks<DbVideo>(studentIds, (chunk, from, to) => db
      .from("student_homework_videos")
      .select("id,student_id,posted_at,class_id:route->>classId")
      .eq("tenant_id", tenantId).in("student_id", chunk)
      .not("route->>classId", "is", null)
      .gte("posted_at", `${fromDate}T00:00:00+09:00`).lt("posted_at", `${addDays(toDate, 1)}T00:00:00+09:00`)
      .order("id", { ascending: true }).range(from, to));
    return rows.map((row) => ({ id: row.id, studentId: row.student_id, classId: row.class_id, postedAt: row.posted_at }));
  } catch (e) {
    console.warn(JSON.stringify({ level: "warn", scope: "videoHomeworkLedger.videos", message: e instanceof Error ? e.message : String(e) }));
    return null;
  }
}

/**
 * 영상 제출 현황 — 기간의 반 명단 + 숙제가 나간 수업 + 검사 기록 + 반이 확인된 학부모 영상.
 * 회차와 완료 판정은 `rounds.ts`가 한다(여기는 재료만). 짝을 맞추려면 기간 앞뒤의 숙제·영상도 알아야 해서
 * 숙제·기록·영상은 `videoMatchRange`(오늘 기준 고정 시작점 ~ 기간 끝 + 2주)로 넓혀 읽는다 — 화면에는 기간 안의 회차만 선다.
 */
export async function getVideoHomeworkLedger(tenantId: string, fromDate: string, toDate: string): Promise<{
  rows: VideoHomeworkLedgerBaseRow[]; marks: VideoHomeworkMark[]; videos: VideoArrival[];
  /** 빈 칸 사유(결석·숙제없음) — `classId:studentId` → 날짜 → 사유. 못 읽었으면 빈 객체(그 칸은 '—'). */
  blankFacts: BlankFacts;
  /** 보고서의 '영상 과제' 값을 읽었나 — 못 읽었으면 기록이 있는 회차만 보인다. */
  assignedKnown: boolean;
  /** 학부모 영상을 읽었나 — 못 읽었으면 자동 집계가 빠진다. */
  videosKnown: boolean;
}> {
  const db = createAdminClient();
  const today = kstToday();
  const { from: wideFrom, to: wideTo } = videoMatchRange(fromDate, toDate, today);
  const [classes, enrollments, schedules, markRows, assigned] = await Promise.all([
    fetchAllPaged<LedgerClass>((from, to) => db.from("classes")
      .select("id,class_name,subject,is_active,closed_at").eq("tenant_id", tenantId).order("id").range(from, to)),
    fetchAllPaged<LedgerEnrollment>((from, to) => db.from("enrollments")
      .select("class_id,student_id,start_date,end_date,on_hold,is_transferred,attendance_days")
      .eq("tenant_id", tenantId).or(`start_date.is.null,start_date.lte.${toDate}`)
      .or(`end_date.is.null,end_date.gte.${fromDate}`).order("id").range(from, to)),
    fetchAllPaged<LedgerSchedule>((from, to) => db.from("class_schedules")
      .select("class_id,day_of_week,valid_from,valid_to").eq("tenant_id", tenantId)
      .or(`valid_from.is.null,valid_from.lte.${toDate}`).or(`valid_to.is.null,valid_to.gte.${fromDate}`)
      .order("id").range(from, to)),
    // 기록은 검사일이 아니라 **숙제일**로 고른다(같은 숙제를 다음 달 수업에서 검사해도 그 숙제 칸에 붙는다). 숙제일 없는 옛 기록은 검사일로.
    fetchAllPaged<DbMark>((from, to) => db.from("video_homework_marks")
      .select("class_id,student_id,check_date,homework_date,submitted_date,status,updated_at").eq("tenant_id", tenantId)
      .gte("check_date", wideFrom)
      .or(`and(homework_date.gte.${wideFrom},homework_date.lte.${wideTo}),and(homework_date.is.null,check_date.lte.${wideTo})`)
      .order("id").range(from, to)),
    getAssignedVideoHomework(tenantId, wideFrom, wideTo),
  ]);
  const marks = markRows.map((row): VideoHomeworkMark => ({ classId: row.class_id, studentId: row.student_id,
    checkDate: row.check_date, homeworkDate: row.homework_date, submittedDate: row.submitted_date ?? null,
    status: row.status as VideoHomeworkStatus, updatedAt: row.updated_at }));
  const occurrences = [
    ...(assigned ?? []).map((row) => ({ class_id: row.classId, student_id: row.studentId, date: row.date })),
    ...marks.map((mark) => ({ class_id: mark.classId, student_id: mark.studentId, date: mark.homeworkDate ?? mark.checkDate })),
  ];
  // 기간 안에 숙제도 기록도 없는 반은 세울 회차가 없다 — 그 반은 명단부터 읽지 않는다.
  const activeClasses = new Set(occurrences.filter((row) => row.date >= fromDate && row.date <= toDate).map((row) => row.class_id));
  // 명단 = 기간에 그 반 수업이 있는 수강생 + (수강이 끝났어도) 기간 안에 숙제·기록이 있는 학생.
  const pairs = buildVideoHomeworkLessonPairs({ classes, enrollments, schedules, fromDate, toDate, today, occurrences })
    .filter((pair) => activeClasses.has(pair.classId));
  const assignedByPair = new Map<string, string[]>();
  for (const row of assigned ?? []) {
    const key = `${row.classId}:${row.studentId}`;
    assignedByPair.set(key, [...(assignedByPair.get(key) ?? []), row.date]);
  }
  const shownPairs = new Set(pairs.map((pair) => `${pair.classId}:${pair.studentId}`));
  const studentIds = [...new Set(pairs.map((row) => row.studentId))];
  // 영상은 숙제가 나간 적이 있는 학생만 — 숙제가 없으면 채울 칸도 없다.
  const homeworkStudents = [...new Set(pairs.filter((row) => assignedByPair.has(`${row.classId}:${row.studentId}`)).map((row) => row.studentId))];
  // 빈 칸 사유 재료 — 반별 숙제 날짜(기간 안) · 학생별 이미 있는 회차 날짜. 출결은 반·기간 범위로 한 번에(blank-facts.ts).
  const classDates = new Map<string, Set<string>>();
  const ownDates = new Map<string, Set<string>>();
  const addDate = (classId: string, studentId: string, date: string) => {
    if (date < fromDate || date > toDate) return;
    (classDates.get(classId) ?? classDates.set(classId, new Set()).get(classId)!).add(date);
    (ownDates.get(`${classId}:${studentId}`) ?? ownDates.set(`${classId}:${studentId}`, new Set()).get(`${classId}:${studentId}`)!).add(date);
  };
  for (const row of assigned ?? []) addDate(row.classId, row.studentId, row.date);
  for (const mark of marks) if (mark.homeworkDate) addDate(mark.classId, mark.studentId, mark.homeworkDate);
  for (const pair of pairs) ownDates.set(`${pair.classId}:${pair.studentId}`, ownDates.get(`${pair.classId}:${pair.studentId}`) ?? new Set());
  const [students, videos, blankFacts] = await Promise.all([
    fetchAllPagedInChunks<{ id: string; name: string; school: string | null; grade: string | null }>(studentIds,
      (chunk, from, to) => db.from("students").select("id,name,school,grade").eq("tenant_id", tenantId)
        .in("id", chunk).order("id").range(from, to)),
    loadClassVideos(tenantId, homeworkStudents, wideFrom, wideTo),
    loadBlankFacts(tenantId, { classDates, ownDates: new Map([...ownDates].filter(([pair]) => shownPairs.has(pair))), enrollments }),
  ]);
  const byClass = new Map(classes.map((row) => [row.id, row]));
  const byStudent = new Map(students.map((row) => [row.id, row]));
  const rows = pairs.flatMap((pair): VideoHomeworkLedgerBaseRow[] => {
    const cls = byClass.get(pair.classId);
    const student = byStudent.get(pair.studentId);
    return cls && student ? [{ classId: pair.classId, studentId: pair.studentId, className: cls.class_name, subject: cls.subject,
      studentName: student.name, school: student.school, grade: student.grade,
      assignedDates: [...new Set(assignedByPair.get(`${pair.classId}:${pair.studentId}`) ?? [])].sort() }] : [];
  });
  // 화면으로는 명단에 선 (반 × 학생)의 기록만 — 넓혀 읽은 지점 전체 기록을 내려보내지 않는다.
  const shown = new Set(rows.map((row) => `${row.classId}:${row.studentId}`));
  return { rows, marks: marks.filter((mark) => shown.has(`${mark.classId}:${mark.studentId}`)), videos: videos ?? [], blankFacts: blankFacts ?? {},
    assignedKnown: assigned !== null, videosKnown: videos !== null };
}
