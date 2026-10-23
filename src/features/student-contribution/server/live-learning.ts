import "server-only";
import { getStudentHomeworkVideos } from "@/features/students/server/homework-videos";
import { HOMEWORK_VIDEO_STATUS, homeworkVideoOrigin } from "@/features/students/homework-videos";
import { getUnifiedGrades } from "@/features/grades/unified/server/queries";
import { KIND_LABEL, scoreUnit } from "@/features/grades/unified/model";
import { addDays } from "@/lib/date-kst";
import { sectionResult, type LiveItem } from "@/features/students/ontology/live-contract";
import { readSection, unavailableSection, type LiveContext } from "./live-context";

export function readLiveGrades(c: LiveContext) {
  const href = `/students/${c.studentId}?tab=grades`, from = addDays(c.today, -89);
  return readSection("grades", "최근 90일 평가 기록", href, async () => {
    const data = await getUnifiedGrades(from, c.today, { studentId: c.studentId });
    const rows = data.records.filter((r) => r.studentId === c.studentId && r.date >= from && r.date <= c.today)
      .sort((a, b) => b.date.localeCompare(a.date) || b.key.localeCompare(a.key));
    const sources = { grade: "student_grades", report: "lesson_reports", level: "level_tests" };
    return { ...sectionResult("grades", "최근 90일 평가 기록", href, rows.slice(0, 5).map((r): LiveItem => ({ id: r.key, title: KIND_LABEL[r.kind], date: r.date,
      detail: r.noExam ? "시험 없음으로 기록" : r.score == null ? r.rawScore || "점수 미입력" : `${r.score}${scoreUnit(r)}${r.maxScore == null ? " · 기준값 미입력" : ` / ${r.maxScore}${scoreUnit(r)}`}`,
      evidence: [{ source: sources[r.source], id: r.sourceId, studentId: c.studentId, href }] })), rows.length),
      note: `${from}–${c.today} · 성적표·수업보고서 테스트·레벨테스트를 성적 탭과 같은 기준으로 연결합니다. 점수와 정답 개수는 구분합니다.` };
  });
}
export function readLiveReports(c: LiveContext) {
  const href = `/students/${c.studentId}?tab=progress`;
  return readSection("progress", "수업 진도 기록", href, async () => {
    const { data, count, error } = await c.db.from("lesson_reports")
      .select("id, report_date, progress, teacher_name", { count: "exact" }).eq("tenant_id", c.tenant).eq("student_id", c.studentId)
      .order("report_date", { ascending: false }).order("id").limit(5);
    if (error) throw error;
    if (count === null) throw new Error("Missing report count");
    return { ...sectionResult("progress", "수업 진도 기록", href, (data ?? []).map((r): LiveItem => ({ id: r.id, title: `보고서 작성자 ${r.teacher_name || "기록 없음"}`,
      detail: r.progress?.slice(0, 240) || "진도 내용 미입력", date: r.report_date,
      evidence: [{ source: "lesson_reports", id: r.id, studentId: c.studentId, href }] })), count), note: "보고서에 기록된 진도입니다. 학습 내용의 숙달을 뜻하지 않습니다." };
  });
}
export function readLiveTextbooks(c: LiveContext) {
  const href = `/students/${c.studentId}?tab=timeline`;
  return readSection("textbooks", "교재 신청 기록", href, async () => {
    const { data, count, error } = await c.db.from("textbook_orders").select("id, book_name, book_detail, request_date", { count: "exact" })
      .eq("tenant_id", c.tenant).eq("student_id", c.studentId).order("request_date", { ascending: false, nullsFirst: false }).order("id").limit(5);
    if (error) throw error;
    if (count === null) throw new Error("Missing textbook count");
    return sectionResult("textbooks", "교재 신청 기록", href, (data ?? []).map((r): LiveItem => ({ id: r.id,
      title: r.book_name || "교재 신청", detail: r.book_detail || "교재 상세 미입력", date: r.request_date ?? undefined,
      evidence: [{ source: "textbook_orders", id: r.id, studentId: c.studentId, href }] })), count);
  });
}
export function readLiveVideos(c: LiveContext) {
  const href = `/students/${c.studentId}?tab=homework-videos`;
  return readSection("videos", "숙제 영상", href, async () => {
    const result = await getStudentHomeworkVideos(c.studentId);
    if (!result.ready) return unavailableSection("videos", "숙제 영상", href, "schema_missing");
    return { ...sectionResult("videos", "숙제 영상", href, result.rows.slice(0, 5).map((r): LiveItem => ({ id: r.id,
      title: homeworkVideoOrigin(r), detail: HOMEWORK_VIDEO_STATUS[r.status] ?? "상태 확인 필요", date: r.posted_at ?? r.created_at,
      evidence: [{ source: "student_homework_videos", id: r.id, studentId: c.studentId, href }] })), result.rows.length),
      note: "학생 영상 목록의 배정·중복 제거 기준을 사용합니다. 업로드 상태와 숙제 완료 판정은 다릅니다." };
  });
}
