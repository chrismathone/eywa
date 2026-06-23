"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ATTITUDE, CLASS_TAGS, TODAY } from "../data";
import { curriculumForGrade, curriculumForGradeSemester, type Semester } from "../curriculum";
import { buildSubjectReport, studentStatus } from "../report";
import { saveLessonReport } from "../server/actions";
import type { CellState, OneScreenStudent } from "../types";
import { OneScreenTopBar } from "./top-bar";
import { StudentList } from "./student-list";
import { ProgressCard } from "./progress-card";
import { TestCard } from "./test-card";
import { ReportCard, type SubjectReport } from "./report-card";

type ReportsState = Record<string, Record<string, SubjectReport>>; // studentId → 과목명 → {draft, sent}

function initReports(students: OneScreenStudent[]): ReportsState {
  const out: ReportsState = {};
  for (const s of students) {
    out[s.id] = {};
    for (const su of s.subjects) out[s.id]![su.name] = { draft: "", sent: s.reportSent };
  }
  return out;
}

/** 보 셀: 과목 전부 발송=ok, 일부 발송/초안=warn, 없음=todo */
function reportCell(map: Record<string, SubjectReport> | undefined, subjectCount: number): CellState {
  if (!map || subjectCount === 0) return "todo";
  const vals = Object.values(map);
  const sent = vals.filter((v) => v.sent).length;
  if (sent >= subjectCount) return "ok";
  if (sent > 0 || vals.some((v) => v.draft.trim())) return "warn";
  return "todo";
}

/**
 * 선생님 원스크린 메인 — 상태는 전부 클라이언트 state(새로고침 시 초기화).
 * 데모 충실 이식: DB 영속화/네트워크 없음. 보고서는 **과목별** 템플릿(buildSubjectReport),
 * 발송은 sonner 토스트 목업. 진도(today)는 과목별로 직접 입력.
 */
export function OneScreenClient({
  initial,
  today = TODAY,
  classTags = CLASS_TAGS,
}: {
  initial: OneScreenStudent[];
  today?: string;
  classTags?: readonly string[];
}) {
  const [students, setStudents] = useState<OneScreenStudent[]>(initial);
  const [selId, setSelId] = useState<string>(initial[0]?.id ?? "");
  const [classFilter, setClassFilter] = useState<string>("전체");
  const [reports, setReports] = useState<ReportsState>(() => initReports(initial));

  const visible =
    classFilter === "전체" ? students : students.filter((s) => s.tag === classFilter);
  const effectiveId = visible.some((s) => s.id === selId) ? selId : (visible[0]?.id ?? "");
  const selected = visible.find((s) => s.id === effectiveId) ?? null;

  // 보고서 셀(과목별 발송 반영) + "오늘 마감" 카운트
  const reportCellById: Record<string, CellState> = {};
  for (const s of students) reportCellById[s.id] = reportCell(reports[s.id], s.subjects.length);
  const doneCount = students.filter((s) => {
    const st = studentStatus(s);
    return st.prog === "ok" && st.test === "ok" && reportCellById[s.id] === "ok";
  }).length;

  function patch(id: string, fn: (s: OneScreenStudent) => OneScreenStudent) {
    setStudents((prev) => prev.map((s) => (s.id === id ? fn(s) : s)));
  }
  function patchReport(
    studentId: string,
    subjectName: string,
    fn: (r: SubjectReport) => SubjectReport,
  ) {
    setReports((prev) => ({
      ...prev,
      [studentId]: {
        ...prev[studentId],
        [subjectName]: fn(prev[studentId]?.[subjectName] ?? { draft: "", sent: false }),
      },
    }));
  }

  function confirmProgress() {
    if (!selected) return;
    patch(selected.id, (s) => ({ ...s, progressConfirmed: !s.progressConfirmed }));
  }
  function setProgress(subjectIndex: number, today: string) {
    if (!selected) return;
    patch(selected.id, (s) => ({
      ...s,
      subjects: s.subjects.map((su, i) => (i === subjectIndex ? { ...su, today } : su)),
    }));
  }
  function setStudyGrade(grade: string) {
    if (!selected) return;
    // 진도 학년 변경(선행/후행) → 진도(prev/today)를 그 학년 1학기 첫 차시로 초기화(유효값 보장).
    const first = curriculumForGrade(grade)[0]?.lessons[0] ?? "";
    patch(selected.id, (s) => ({
      ...s,
      studyGrade: grade,
      subjects: s.subjects.map((su) => ({ ...su, prev: first, today: first })),
    }));
  }
  function setSemester(semester: Semester) {
    if (!selected) return;
    // 학기 변경 → 진도를 그 학기 첫 차시로 초기화(차시 드롭다운 스코프와 일치 보장).
    const grade = selected.studyGrade ?? selected.grade;
    const first = curriculumForGradeSemester(grade, semester)[0]?.lessons[0] ?? "";
    patch(selected.id, (s) => ({
      ...s,
      subjects: s.subjects.map((su) => ({ ...su, prev: first, today: first })),
    }));
  }
  function setScore(which: "daily" | "check", v: number | null) {
    if (!selected) return;
    patch(selected.id, (s) => ({
      ...s,
      tests: { ...s.tests, [which]: { ...s.tests[which], score: v } },
    }));
  }
  function setAttitude(a: string) {
    if (!selected) return;
    patch(selected.id, (s) => ({ ...s, attitude: s.attitude === a ? null : a }));
  }
  function setSubjectDraft(subjectName: string, text: string) {
    if (!selected) return;
    patchReport(selected.id, subjectName, (r) => ({ ...r, draft: text }));
  }
  function autoWriteSubject(subjectName: string) {
    if (!selected) return;
    const idx = selected.subjects.findIndex((su) => su.name === subjectName);
    patchReport(selected.id, subjectName, (r) => ({ ...r, draft: buildSubjectReport(selected, idx) }));
  }
  async function sendSubject(subjectName: string, channel: string) {
    if (!selected) return;
    const idx = selected.subjects.findIndex((su) => su.name === subjectName);
    const su = selected.subjects[idx];
    // 초안이 비어 있으면 그 과목 초안을 자동 작성해 본문으로 사용
    const existing = reports[selected.id]?.[subjectName];
    const draft = existing?.draft.trim() ? existing.draft : buildSubjectReport(selected, idx);
    const examInfo = [
      selected.tests.daily.score != null
        ? `일일 ${selected.tests.daily.score}/${selected.tests.daily.max}`
        : null,
      selected.tests.check.score != null
        ? `확인 ${selected.tests.check.score}/${selected.tests.check.max}`
        : null,
    ]
      .filter(Boolean)
      .join(", ");

    const res = await saveLessonReport({
      studentId: selected.id,
      progress: su ? `${su.name} ${su.today}`.trim() : "",
      examInfo,
      homeworkScore: selected.homework,
      notes: draft,
    });
    if (!res.ok) {
      toast.error(res.error ?? "보고서 저장에 실패했습니다");
      return;
    }
    patchReport(selected.id, subjectName, () => ({ draft, sent: true }));
    // D3: 저장은 실제(lesson_reports). 카톡/문자/PDF 발송 연동은 후속 — 토스트는 정직하게.
    const msg =
      channel === "pdf"
        ? `${subjectName} 보고서를 저장했습니다 (PDF 내보내기는 준비 중)`
        : channel === "save"
          ? `${subjectName} 보고서를 기록에 저장했습니다`
          : `${subjectName} 보고서를 저장했습니다 (${channel} 발송 연동은 준비 중)`;
    toast.success(msg);
  }

  return (
    <div className="space-y-4">
      <OneScreenTopBar
        today={today}
        classTags={classTags}
        classFilter={classFilter}
        onFilter={setClassFilter}
        doneCount={doneCount}
        total={students.length}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)_minmax(0,380px)]">
        <StudentList
          students={visible}
          selId={effectiveId}
          onSelect={setSelId}
          reportCellById={reportCellById}
        />

        {selected ? (
          <>
            <div className="flex flex-col gap-4">
              <ProgressCard
                student={selected}
                onConfirm={confirmProgress}
                onProgress={setProgress}
                onStudyGrade={setStudyGrade}
                onSemester={setSemester}
              />
              <TestCard student={selected} onScore={setScore} />
            </div>
            <ReportCard
              key={selected.id}
              student={selected}
              reports={reports[selected.id] ?? {}}
              attitudes={ATTITUDE}
              onAttitude={setAttitude}
              onSubjectDraft={setSubjectDraft}
              onAutoWrite={autoWriteSubject}
              onSend={sendSubject}
            />
          </>
        ) : (
          <div className="bg-card border-line shadow-card text-text-faint flex items-center justify-center rounded-md border p-10 text-sm lg:col-span-2">
            학생을 선택하세요
          </div>
        )}
      </div>
    </div>
  );
}
