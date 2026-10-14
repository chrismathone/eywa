import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { addDays, kstToday } from "@/lib/date-kst";
import { buildVideoHomeworkLessonPairs, type LedgerClass, type LedgerEnrollment, type LedgerSchedule } from "../ledger-roster";
import { buildLedgerRounds, VIDEO_MATCH_WINDOW_DAYS, videoArrivedAt, videoFingerprint, videoMatchRange, type RoundOwners } from "../rounds";
import { type VideoArrival, type VideoHomeworkMark, type VideoHomeworkRosterRow, type VideoHomeworkStatus } from "../types";
import { getAssignedVideoHomework } from "./assignments";
import { loadBlankFacts } from "./blank-facts";
import type { BlankFacts } from "../no-homework";
import { homeworkVideoLinks } from "@/features/students/homework-videos";
import { homeworkVideoSource } from "./video-source";
import { loadVideoAssignmentCandidates, unassignedVideoPairs } from "./assignment-availability";

type DbMark = { class_id: string; student_id: string; check_date: string; homework_date: string | null;
  submitted_date: string | null; status: string; updated_at: string | null };
type DbVideo = { id: string; student_id: string; post_id: number | null; posted_at: string; created_at: string | null; uploaded_at: string | null;
  md5: string | null; bytes: number | string | null; status: string; drive_file_id: string | null;
  class_id: string | null; homework_date: string | null; manual_assignment?: string | null; excluded?: string | null; free?: string | null };
type DbLedgerClass = LedgerClass & { teacher: { display_name: string; tenant_id: string } | null };
export type VideoHomeworkLedgerBaseRow = VideoHomeworkRosterRow & {
  assignedDates: string[]; teacherName: string | null; hasAssignableVideos: boolean;
  /** 보고서 없이 따로 낸 숙제의 날짜(extra-issues.ts) — 조회 기간 안의 것만. 칸의 '따로 낸 숙제' 표시와 취소에 쓴다. */
  extraDates: string[];
  /** 반려한 숙제(숙제일 → 반려 시각, rejections.ts) — 칸을 짜는 쪽(화면)이 같은 칸을 세우게. */
  rejected?: Record<string, string>;
};

/**
 * 숙제 영상(0315a `student_homework_videos`) — 반이 확인된 것만 읽고 업로드 완료 파일의 검증된 미리보기를 붙인다.
 * 🔴 표가 없거나(미적용 지점) 못 읽으면 null — 자동 집계만 빠지고 장부는 그대로 돈다(화면이 그 사실을 알린다).
 */
export async function loadClassVideos(tenantId: string, studentIds: string[], fromDate: string, toDate: string, includeUnclassified = false): Promise<VideoArrival[] | null> {
  if (!studentIds.length) return [];
  try {
    const db = createAdminClient();
    const source = await homeworkVideoSource(db);
    const rows = await fetchAllPagedInChunks<DbVideo>(studentIds, (chunk, from, to) => {
      const query = db
      .from(source)
      .select("id,student_id,post_id,posted_at,created_at,uploaded_at,md5,bytes,status,drive_file_id,class_id:route->>classId,homework_date:route->>homeworkDate,manual_assignment:route->>manualAssignment,excluded:route->>excluded,free:route->>free")
      .eq("tenant_id", tenantId).in("student_id", chunk)
      .or(`and(posted_at.gte.${fromDate}T00:00:00+09:00,posted_at.lt.${addDays(toDate, 1)}T00:00:00+09:00),and(route->>manualAssignment.eq.true,route->>homeworkDate.gte.${fromDate},route->>homeworkDate.lte.${toDate})`)
      .order("id", { ascending: true });
      if (!includeUnclassified) query.not("route->>classId", "is", null);
      return query.range(from, to);
    });
    // 잘못된 지정 날짜도 그대로 둔다. 회차와 일치하지 않으면 미배정이며, 일반 게시글처럼 다른 숙제에 붙이지 않는다.
    return rows.filter(row => row.excluded !== "true").map((row) => {
      const homeworkDate = row.homework_date || null;
      const links = row.status === "uploaded" ? homeworkVideoLinks(row.drive_file_id) : null;
      return { id: row.id, studentId: row.student_id, classId: row.class_id, postedAt: row.posted_at, homeworkDate, fingerprint: videoFingerprint(row.md5, row.bytes),
        manuallyAssigned: row.manual_assignment === "true", free: row.free === "true",
        playback: links ? { ...links, uploadedAt: row.uploaded_at } : null,
        createdAt: row.created_at,
        arrivedAt: videoArrivedAt({ createdAt: row.created_at, postedAt: row.posted_at, uploadedAt: row.uploaded_at, fromClassnote: row.post_id != null, picked: !!homeworkDate }) };
    });
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
export async function getVideoHomeworkLedger(tenantId: string, fromDate: string, toDate: string,
  /** 읽을 반 × 학생(`반:학생`)만 — 강사뷰(내가 낸 숙제가 있는 줄). 명단·영상·출결을 이 줄만 읽는다(판정은 반 × 학생 단위라 결과는 같다). */
  scope?: { pairs: ReadonlySet<string> }): Promise<{
  rows: VideoHomeworkLedgerBaseRow[]; marks: VideoHomeworkMark[]; videos: VideoArrival[];
  /** 빈 칸 사유(결석·숙제없음) — `classId:studentId` → 날짜 → 사유. 못 읽었으면 빈 객체(그 칸은 '—'). */
  blankFacts: BlankFacts;
  /** 보고서의 '영상 과제' 값을 읽었나 — 못 읽었으면 기록이 있는 회차만 보인다. */
  assignedKnown: boolean;
  /** 학부모 영상을 읽었나 — 못 읽었으면 자동 집계가 빠진다. */
  videosKnown: boolean;
  assignmentVideosKnown: boolean;
}> {
  const db = createAdminClient();
  const today = kstToday();
  const { from: wideFrom, to: wideTo } = videoMatchRange(fromDate, toDate, today);
  const [classes, enrollments, schedules, markRows, assigned] = await Promise.all([
    fetchAllPaged<DbLedgerClass>((from, to) => db.from("classes")
      .select("id,class_name,subject,is_active,closed_at,teacher:teacher_id(display_name,tenant_id)").eq("tenant_id", tenantId).order("id").returns<DbLedgerClass[]>().range(from, to)),
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
    .filter((pair) => activeClasses.has(pair.classId) && (!scope || scope.pairs.has(`${pair.classId}:${pair.studentId}`)));
  const assignedByPair = new Map<string, string[]>();
  const extraByPair = new Map<string, string[]>();
  // 반려한 숙제(숙제일 → 반려 시각) — 화면·버튼 판정이 같은 칸을 짜게 줄에 싣는다(rounds.ts ②).
  const rejectedByPair = new Map<string, Record<string, string>>();
  // 검사 기록 칸에서 옮겨 남긴 숙제(keep-round.ts) — 칸은 서되 검사 기록 칸처럼 짠다(rounds.ts `kept`).
  const keptByPair = new Map<string, string[]>();
  for (const row of assigned ?? []) {
    const key = `${row.classId}:${row.studentId}`;
    assignedByPair.set(key, [...(assignedByPair.get(key) ?? []), row.date]);
    if (row.kept) keptByPair.set(key, [...(keptByPair.get(key) ?? []), row.date]);
    if (row.extra && row.date >= fromDate && row.date <= toDate) extraByPair.set(key, [...(extraByPair.get(key) ?? []), row.date]);
    if (row.rejectedAt) rejectedByPair.set(key, { ...(rejectedByPair.get(key) ?? {}), [row.date]: row.rejectedAt });
  }
  const shownPairs = new Set(pairs.map((pair) => `${pair.classId}:${pair.studentId}`));
  const studentIds = [...new Set(pairs.map((row) => row.studentId))];
  // 영상은 숙제 칸이 있는 학생만 — 숙제가 없으면 채울 칸도 없다. 검사 기록만으로 선 숙제 칸도 ②의 뒷순위로 영상을 받으므로 함께 읽는다
  // (안 읽으면 그 칸에 붙을 영상이 장부에서만 안 보이고, 자동 판정·미배정 알림과 다른 말을 한다 — 재리뷰 2026-10-13).
  const markPairs = new Set(marks.filter((mark) => !!mark.homeworkDate).map((mark) => `${mark.classId}:${mark.studentId}`));
  const homeworkStudents = [...new Set(pairs.filter((row) => assignedByPair.has(`${row.classId}:${row.studentId}`)
    || markPairs.has(`${row.classId}:${row.studentId}`)).map((row) => row.studentId))];
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
  // 배정 후보 영상을 읽을 숙제일 = 숙제(보고서 · 따로 낸 숙제) + 검사 기록만 있는 숙제일(배정하면 옮겨 남긴 숙제가 된다, video-assignment.ts).
  const inRange = (date: string | null): date is string => !!date && date >= fromDate && date <= toDate;
  const markDates = new Map<string, string[]>();
  for (const { classId, studentId, homeworkDate } of marks) if (inRange(homeworkDate)) markDates.set(`${classId}:${studentId}`, [...(markDates.get(`${classId}:${studentId}`) ?? []), homeworkDate]);
  const assignmentRows = pairs.map(pair => ({ ...pair, assignedDates: [...new Set([
    ...(assignedByPair.get(`${pair.classId}:${pair.studentId}`) ?? []).filter(inRange), ...(markDates.get(`${pair.classId}:${pair.studentId}`) ?? [])])] }));
  const [students, videos, blankFacts, assignmentCandidates] = await Promise.all([
    fetchAllPagedInChunks<{ id: string; name: string; school: string | null; grade: string | null }>(studentIds,
      (chunk, from, to) => db.from("students").select("id,name,school,grade").eq("tenant_id", tenantId)
        .in("id", chunk).order("id").range(from, to)),
    // 영상은 짝 범위 끝 + 2주까지 읽는다 — 범위 끝 무렵 숙제를 골라 그 뒤에 올린 영상이 있어야, 지난 기간을 볼 때도 같은 파일의 사본을
    // 지금 보기와 똑같이 뺀다. 더 늦은 영상은 화면 칸에 닿지 못한다(칸은 숙제일 + 2주까지만 영상을 받는다).
    loadClassVideos(tenantId, homeworkStudents, wideFrom, addDays(wideTo, VIDEO_MATCH_WINDOW_DAYS)),
    loadBlankFacts(tenantId, { classDates, ownDates: new Map([...ownDates].filter(([pair]) => shownPairs.has(pair))), enrollments }),
    loadVideoAssignmentCandidates(tenantId, assignmentRows),
  ]);
  // 화면에 보이지 않는 다른 반·기간의 숙제까지 같은 규칙으로 짝지어야, 이미 쓰인 영상을 미배정으로 오인하지 않는다.
  // 원본 영상·숙제·기록은 이미 넓혀 읽었다. 학생마다 추가 조회하지 않고 그 재료를 그대로 쓴다.
  const videoPairs = new Map((videos ?? []).flatMap(video => video.classId ? [[`${video.classId}:${video.studentId}`,
    { classId: video.classId, studentId: video.studentId, tracked: true,
      assignedDates: assignedByPair.get(`${video.classId}:${video.studentId}`) ?? [], rejected: rejectedByPair.get(`${video.classId}:${video.studentId}`),
      kept: keptByPair.get(`${video.classId}:${video.studentId}`) }] as const] : []));
  // 명단 줄의 칸도 같이 짠다 — '영상 배정'은 아직 영상이 없는 숙제 칸이 있는 줄에만 띄운다(아래).
  const roundRows = new Map<string, { classId: string; studentId: string; tracked: boolean; assignedDates: string[]; rejected?: Record<string, string>; kept?: string[] }>(videoPairs);
  for (const row of assignmentRows) {
    const key = `${row.classId}:${row.studentId}`;
    if (!roundRows.has(key)) roundRows.set(key, { classId: row.classId, studentId: row.studentId, tracked: true, assignedDates: assignedByPair.get(key) ?? [],
      rejected: rejectedByPair.get(key), kept: keptByPair.get(key) });
  }
  const owners: RoundOwners = new Map();
  const assignmentRounds = buildLedgerRounds({ rows: [...roundRows.values()], marks, videos: videos ?? [], fromDate: wideFrom, toDate: wideTo, owners });
  // 붙은 영상 — 미확인·미수행 칸에는 칸의 대표 영상만(같은 날 둘째 영상은 다른 숙제 것일 수 있어 '안 붙음'으로 알린다 — 10/13 그대로),
  // 손 완료('수동') 칸에는 칸이 세거나 접어 둔 영상 전부(손 완료는 흔해서, 같은 날 둘째 영상 · 같은 파일 사본마다 버튼이 뜨면 10/13의 오해가 돌아온다 — 적대적 리뷰 2026-10-14).
  const representative = new Set([...assignmentRounds.values()].flatMap(rounds => rounds.flatMap(round => round.videoId ? [round.videoId] : [])));
  const owned = new Set([...representative, ...owners.keys()]);
  // 기간 안의 **영상이 안 붙은** 숙제 칸 — 미확인 · 미수행 · 손으로 찍은 '수동' 완료 · 검사 기록 칸까지(원장 2026-10-14 *"수동 영상들 다 학생들이
  // 업로드해서 배정하고 싶은데 배정이 불가능함"*). 영상이 붙은 칸은 붙일 자리가 아니다(원장 2026-10-13 *"오해를 불러일으키겠는데"*).
  // `manual` = 손 완료 칸만 / 아니면 미확인·미수행 칸만 — 위의 '붙은 영상' 기준이 둘이 다르다.
  const openRows = (manual: boolean) => assignmentRows.map(row => ({ ...row, assignedDates: (assignmentRounds.get(`${row.classId}:${row.studentId}`) ?? [])
    .filter(round => !round.videoId && (round.status === "submitted") === manual && inRange(round.homeworkDate)).map(round => round.homeworkDate!) }));
  const subjectOfClass = new Map(classes.map((row) => [row.id, row.subject]));
  const subjectOf = (classId: string) => subjectOfClass.get(classId);
  const assignablePairs = assigned !== null && videos !== null && assignmentCandidates !== null
    ? new Set([...unassignedVideoPairs(openRows(false), assignmentCandidates, representative, subjectOf),
      ...unassignedVideoPairs(openRows(true), assignmentCandidates, owned, subjectOf)]) : null;
  const byClass = new Map(classes.map((row) => [row.id, row]));
  const byStudent = new Map(students.map((row) => [row.id, row]));
  const rows = pairs.flatMap((pair): VideoHomeworkLedgerBaseRow[] => {
    const cls = byClass.get(pair.classId);
    const student = byStudent.get(pair.studentId);
    return cls && student ? [{ classId: pair.classId, studentId: pair.studentId, className: cls.class_name, subject: cls.subject,
      teacherName: cls.teacher?.tenant_id === tenantId ? cls.teacher.display_name.trim() || null : null,
      studentName: student.name, school: student.school, grade: student.grade,
      hasAssignableVideos: assignablePairs?.has(`${pair.classId}:${pair.studentId}`) ?? false,
      extraDates: [...(extraByPair.get(`${pair.classId}:${pair.studentId}`) ?? [])].sort(),
      ...(rejectedByPair.has(`${pair.classId}:${pair.studentId}`) ? { rejected: rejectedByPair.get(`${pair.classId}:${pair.studentId}`) } : {}),
      ...(keptByPair.has(`${pair.classId}:${pair.studentId}`) ? { kept: [...keptByPair.get(`${pair.classId}:${pair.studentId}`)!].sort() } : {}),
      assignedDates: [...new Set(assignedByPair.get(`${pair.classId}:${pair.studentId}`) ?? [])].sort() }] : [];
  });
  // 화면으로는 명단에 선 (반 × 학생)의 기록만 — 넓혀 읽은 지점 전체 기록을 내려보내지 않는다.
  const shown = new Set(rows.map((row) => `${row.classId}:${row.studentId}`));
  return { rows, marks: marks.filter((mark) => shown.has(`${mark.classId}:${mark.studentId}`)),
    videos: (videos ?? []).filter((video) => video.classId && shown.has(`${video.classId}:${video.studentId}`)), blankFacts: blankFacts ?? {},
    assignedKnown: assigned !== null, videosKnown: videos !== null, assignmentVideosKnown: assignablePairs !== null };
}
