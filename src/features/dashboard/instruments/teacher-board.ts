/**
 * 강사별 업무 게이지 — 시안처럼 모든 줄을 '높을수록 좋음'(한 값/전체)으로 맞춘다. 원본 값은 직원 평가 '업무 현황'과 같다.
 * 숫자가 없는 칸(반 알림장·작성 면제)은 빈칸(null)이다 — 0으로 칠하면 '안 했다'로 읽힌다.
 */
import type { TeacherWork, TeacherWorkRow } from "@/features/dashboard/overview/teacher-work";

type Cell = [value: number, total: number] | null;

/** 과목 탭 — 값이 있는 과목만. `order`는 다른 카드의 탭 순서다. */
export function teacherTabs(data: TeacherWork, subjectLabel: (key: string) => string, order: readonly string[]) {
  const labels = [...new Set(data.rows.filter((r) => r.classIds.length > 0).map((r) => subjectLabel(r.subject)))];
  const rank = (label: string) => { const i = order.indexOf(label); return i < 0 ? order.length : i; };
  return labels.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "ko"));
}

export function teacherBoard(data: TeacherWork, subjectLabel: (key: string) => string, order: readonly string[] = [], pick?: string) {
  const rank = (key: string) => { const i = order.indexOf(subjectLabel(key)); return i < 0 ? order.length : i; };
  const rows = data.rows.filter((r) => r.classIds.length > 0 && (!pick || subjectLabel(r.subject) === pick)).sort((a, b) => rank(a.subject) - rank(b.subject) || a.teacherName.localeCompare(b.teacherName, "ko"));
  const lesson = (r: TeacherWorkRow, cell: Cell) => (r.reportSource === "lesson" ? cell : null);
  const metrics: { name: string; cell: (r: TeacherWorkRow) => Cell; shown?: boolean }[] = [
    { name: "보고서 작성", cell: (r) => [r.reports, r.reportTarget] },
    { name: "발송 완료", shown: data.deliveryShown === true, cell: (r) => lesson(r, [Math.min(r.reports, r.sent + r.recalled), r.reports]) },
    { name: "학부모 확인", shown: data.deliveryShown === true, cell: (r) => lesson(r, [r.unreadJudged - r.unread, r.unreadJudged]) },
    { name: "출결 입력", cell: (r) => [r.attendanceDays - r.attendanceUnrecorded, r.attendanceDays] },
    { name: "영상 제출", cell: (r) => [r.videoSubmitted, r.videoAssigned] },
    { name: "영상 숙제 출제", cell: (r) => lesson(r, [r.videoIssuedReports, r.reportsWritten]) },
  ];
  return {
    teachers: rows.map((r) => ({ key: `${r.teacherId ?? "none"}:${r.subject}`, name: r.teacherName, subject: subjectLabel(r.subject), classes: r.classIds.length })),
    metrics: metrics.filter((m) => m.shown !== false).map((m) => ({ name: m.name, cells: rows.map((r) => { const c = m.cell(r); return c && c[1] > 0 ? c : null; }) })),
  };
}
