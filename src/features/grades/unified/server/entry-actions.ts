"use server";

import { gradeWriteError } from "@/features/grades/server/access";
import { getGradeSheet } from "@/features/grades/server/queries";
import { resolveGradeSelection } from "@/features/grades/selection";
import { axisValueOf } from "@/features/grades/subject-axis";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { kstToday } from "@/lib/date-kst";
import type { ExamSlotKey } from "@/features/grades/exam-slots";
import { loadTodaysMathMonthly } from "@/features/grades/server/todays-math-monthly";
import type { TodaysMathMonthly } from "@/features/grades/todays-math-monthly";
import { slotHasAreas, type AreaScores } from "@/features/grades/area-scores";

export type SchoolRosterRow = {
  studentId: string; name: string; school: string | null; grade: string | null; className: string;
  score: number | null; applies: boolean; withdrawn: boolean; noExam: boolean; noExamReason: string | null;
  /** 저장된 영역 점수(영어 Monthly Test) — 영역으로 안 적는 시험이면 null. */
  areas: AreaScores | null;
};
export type SchoolRoster = {
  /** 서버가 해석한 축 — 저장은 **이 값 그대로** 보낸다(화면 입력과 어긋나면 다른 칸에 쓴다). */
  selection: { year: number; term: number; subject: string; classId: string; slot: ExamSlotKey; date: string; maxScore: number };
  classes: { id: string; name: string; count: number | null }[];
  rows: SchoolRosterRow[];
  ready: boolean;
  notice: string | null;
  /** 같은 달 오늘 수학 월말평가(수학 · 월말평가 · 학원 설정 토글 ∧ 라이선스일 때만, 아니면 null) — 창이 빈 칸에 자동으로 채운다. */
  todaysMath: TodaysMathMonthly | null;
};

/**
 * 성적 입력 창의 **학교·월말 시험 명단** — 옛 입력 화면과 같은 `getGradeSheet`를 부른다(명단·권한·학기 규칙 한 벌).
 * 저장은 기존 `saveGradeScores`(명단 일괄)로 간다 — 여기선 읽기만.
 */
export async function loadSchoolRoster(raw: {
  year?: string; term?: string; subject?: string; classId?: string; slot?: string; date?: string; max?: string;
  /** 내신은 반이 아니라 **학교·학년**으로 명단을 세운다(원장 2026-09-24) — 비우면 그 축은 거르지 않는다. */
  school?: string; grade?: string;
}): Promise<{ error: string } | { roster: SchoolRoster }> {
  const gate = await gradeWriteError();
  if (gate) return { error: gate };
  const settings = await getTenantSettings();
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const sel = resolveGradeSelection({ year: raw.year, term: raw.term, subject: raw.subject, class: raw.classId, slot: raw.slot, date: raw.date, max: raw.max },
    { subjectOptions: subjects.options, todayIso: kstToday() });
  if (!sel) return { error: "학원 설정에 과목이 없습니다" };
  const sheet = await getGradeSheet(sel);
  const seen = new Set<string>();
  const rows: SchoolRosterRow[] = [];
  for (const r of sheet.rows) {
    if (seen.has(r.studentId)) continue; // 두 반 수강생도 값은 하나 — 한 줄만
    if (raw.school && (r.school ?? "") !== raw.school) continue;
    if (raw.grade && (r.grade ?? "") !== raw.grade) continue;
    seen.add(r.studentId);
    rows.push({ studentId: r.studentId, name: r.name, school: r.school, grade: r.grade, className: r.className, score: r.score,
      applies: r.applies, withdrawn: r.withdrawn, noExam: r.noExam, noExamReason: r.noExamReason, areas: r.areas ?? null });
  }
  const todaysMath = await loadTodaysMathMonthly(sel, rows.map((r) => r.studentId));
  const notice = !sheet.schemaReady ? "성적 표 준비(0283a)가 적용되어야 저장할 수 있습니다."
    : sel.slot === "monthly" && !sheet.monthReady ? "월 축 준비(0288a)가 적용되어야 월말평가를 저장할 수 있습니다."
    : slotHasAreas(sel.subject, sel.slot) && !sheet.areasReady ? "영역 점수 준비(s2_0023)가 적용되어야 Monthly Test를 저장할 수 있습니다." : null;
  return { roster: {
    selection: { year: sel.year, term: sel.term, subject: axisValueOf(sel), classId: sel.classId ?? "", slot: sel.slot, date: sel.date, maxScore: sel.maxScore },
    classes: sheet.classes.map((c) => ({ id: c.id, name: c.className, count: c.studentCount })),
    rows, ready: notice == null, notice, todaysMath,
  } };
}
