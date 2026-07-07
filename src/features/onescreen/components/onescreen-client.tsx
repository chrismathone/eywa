"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { usePrintWindow } from "@/components/workspace/print-window";
import { ATTITUDE, CLASS_TAGS, HOMEWORK, TODAY } from "../data";
import { curriculumForGrade, curriculumForGradeSemester, type Semester } from "../curriculum";
import { buildSubjectReport, studentStatus } from "../report";
import { buildReportCommentInput } from "../report-comment";
import {
  generateReportComment,
  saveAndQueueClassnote,
  saveLessonReport,
  saveOnescreenSession,
} from "../server/actions";
import type { CellState, OneScreenStudent } from "../types";
import { OneScreenTopBar } from "./top-bar";
import { OneScreenHubBar } from "./hub-bar";
import { StudentList } from "./student-list";
import type { TodayClass } from "../server/roster";
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
  todayClasses = [],
}: {
  initial: OneScreenStudent[];
  today?: string;
  classTags?: readonly string[];
  todayClasses?: TodayClass[];
}) {
  const [students, setStudents] = useState<OneScreenStudent[]>(initial);
  const [selId, setSelId] = useState<string>(initial[0]?.id ?? "");
  const [classFilter, setClassFilter] = useState<string>("전체");
  const [reports, setReports] = useState<ReportsState>(() => initReports(initial));
  const [genSubject, setGenSubject] = useState<string | null>(null); // AI 멘트 생성 중인 과목(버튼 로딩)
  const openPrint = usePrintWindow(); // "PDF" = 저장된 보고서를 인쇄 문서 플로팅 창으로 연다

  // 자동저장(디바운스) — 최신 state를 타이머 콜백에서 읽기 위한 ref 미러 + 학생별 타이머.
  const studentsRef = useRef(students);
  const reportsRef = useRef(reports);
  // ref 미러는 render 중이 아니라 effect에서 갱신(react-hooks/refs). 타이머는 800ms 뒤라 항상 최신 반영.
  useEffect(() => {
    studentsRef.current = students;
    reportsRef.current = reports;
  });
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => {
    const timers = saveTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
    };
  }, []);
  function buildSessionInput(s: OneScreenStudent, r: Record<string, SubjectReport> | undefined) {
    return {
      studentId: s.id,
      classId: s.classId ?? null,
      studyGrade: s.studyGrade ?? null,
      subjectProgress: Object.fromEntries(
        s.subjects.map((su) => [
          su.subjectKey || su.name,
          { today: su.today, draft: r?.[su.name]?.draft ?? "" },
        ]),
      ),
      dailyScore: s.tests.daily.score,
      dailyMax: s.tests.daily.max,
      checkScore: s.tests.check.score,
      checkMax: s.tests.check.max,
      attitude: s.attitude,
      homework: s.homework || null,
      progressConfirmed: s.progressConfirmed,
    };
  }
  // 학생별 디바운스 upsert — 편집 800ms 후 저장. 학생별 타이머라 학생 전환에도 유실 없음.
  function queueSave(studentId: string) {
    const prev = saveTimers.current.get(studentId);
    if (prev) clearTimeout(prev);
    saveTimers.current.set(
      studentId,
      setTimeout(() => {
        saveTimers.current.delete(studentId);
        const s = studentsRef.current.find((x) => x.id === studentId);
        if (!s) return;
        void saveOnescreenSession(buildSessionInput(s, reportsRef.current[studentId])).then((res) => {
          if (!res.ok) toast.error(res.error ?? "자동 저장에 실패했습니다");
        });
      }, 800),
    );
  }

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

  // 허브 통계(B2) — 오늘 마감 진행 현황.
  const hubStats = {
    students: students.length,
    progressDone: students.filter((s) => s.progressConfirmed).length,
    testDone: students.filter((s) => studentStatus(s).test === "ok").length,
    reportDone: students.filter((s) => reportCellById[s.id] === "ok").length,
  };

  function patch(id: string, fn: (s: OneScreenStudent) => OneScreenStudent) {
    setStudents((prev) => prev.map((s) => (s.id === id ? fn(s) : s)));
    queueSave(id); // 편집 → 디바운스 서버 영속(onescreen_daily_sessions)
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
    queueSave(studentId);
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
  function setHomework(h: string) {
    if (!selected) return;
    patch(selected.id, (s) => ({ ...s, homework: s.homework === h ? "" : h }));
  }
  function setSubjectDraft(subjectName: string, text: string) {
    if (!selected) return;
    patchReport(selected.id, subjectName, (r) => ({ ...r, draft: text }));
  }
  async function autoWriteSubject(subjectName: string) {
    if (!selected) return;
    const student = selected; // 클로저 고정 — 생성 중 학생 전환돼도 원래 학생에 반영
    const idx = student.subjects.findIndex((su) => su.name === subjectName);
    if (idx < 0) return;
    setGenSubject(subjectName);
    try {
      const res = await generateReportComment(buildReportCommentInput(student, idx));
      // AI 성공 시 멘트, 실패(키 없음·오류·빈응답) 시 결정적 템플릿으로 폴백(무중단).
      const text = res.ok && res.comment ? res.comment : buildSubjectReport(student, idx);
      if (!res.ok) toast.message("AI 자동작성이 어려워 기본 문구로 작성했습니다");
      patchReport(student.id, subjectName, (r) => ({ ...r, draft: text }));
    } catch {
      patchReport(student.id, subjectName, (r) => ({ ...r, draft: buildSubjectReport(student, idx) }));
      toast.message("AI 자동작성이 어려워 기본 문구로 작성했습니다");
    } finally {
      setGenSubject((cur) => (cur === subjectName ? null : cur));
    }
  }
  // 저장 입력(보고서 필드)을 과목별로 조립 — sendSubject·queueClassnote 공용. 초안 없으면 자동 작성분 사용.
  function buildSaveInput(subjectName: string) {
    if (!selected) return null;
    const idx = selected.subjects.findIndex((su) => su.name === subjectName);
    const su = selected.subjects[idx];
    const existing = reports[selected.id]?.[subjectName];
    const draft = existing?.draft.trim() ? existing.draft : buildSubjectReport(selected, idx);
    const examInfo = [
      selected.tests.daily.score != null ? `일일 ${selected.tests.daily.score}/${selected.tests.daily.max}` : null,
      selected.tests.check.score != null ? `확인 ${selected.tests.check.score}/${selected.tests.check.max}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    // 학부모 보고서 일일/확인테스트 분리 표시용("N문제 중 M개"). exam_info(합본)는 roster prev-score 파싱용 별도 보존.
    const dailyTest =
      selected.tests.daily.score != null ? `${selected.tests.daily.max}문제 중 ${selected.tests.daily.score}개` : "";
    const checkTest =
      selected.tests.check.score != null ? `${selected.tests.check.max}문제 중 ${selected.tests.check.score}개` : "";
    return {
      draft,
      input: {
        studentId: selected.id,
        progress: su ? `${su.name} ${su.today}`.trim() : "",
        examInfo,
        homeworkScore: selected.homework,
        dailyTest,
        checkTest,
        attitude: selected.attitude ?? "",
        notes: draft,
        subject: su?.subjectKey || su?.name || undefined, // (student,date,subject) 과목별 1행 dedup 키
      },
    };
  }

  async function sendSubject(subjectName: string, channel: string) {
    if (!selected) return;
    const built = buildSaveInput(subjectName);
    if (!built) return;
    const { draft, input } = built;
    const res = await saveLessonReport(input);
    if (!res.ok) {
      toast.error(res.error ?? "보고서 저장에 실패했습니다");
      return;
    }
    // shareToken 보존 → report-card가 학부모 공개 링크(/r/[token])를 노출·복사하게.
    patchReport(selected.id, subjectName, () => ({ draft, sent: true, shareToken: res.shareToken }));
    // 저장은 실제(lesson_reports). PDF는 인쇄 문서 창을 실제로 연다. 카톡/문자는 미연동 →
    // "발송 완료" 거짓말 없이 "기록 저장 + 연동 후 발송"으로 정직하게(라벨도 report-card에서 "기록 저장").
    if (channel === "pdf") {
      if (res.id) {
        openPrint({
          id: `print/lesson_reports/${res.id}`,
          href: `/lesson_reports/${res.id}/print`,
          title: "수업 보고서",
        });
        toast.success(`${subjectName} 보고서 저장 — 인쇄 미리보기를 열었습니다`);
      } else {
        toast.success(`${subjectName} 보고서를 기록에 저장했습니다`);
      }
    } else if (channel === "save") {
      toast.success(`${subjectName} 보고서를 기록에 저장했습니다`);
    } else {
      // 카톡/문자: 아직 자동발송(알림톡)은 미연동 → 학부모 공개 링크를 생성해 강사가 직접 복사·전달.
      toast.success(`${subjectName} 보고서 저장 완료 — 아래 학부모 공유 링크를 복사해 ${channel}로 보내세요`);
    }
  }

  // ClassNote 발송 — 저장 + 큐 적재. 실제 게시는 로컬 워커가 백그라운드로(강사는 대기 안 함).
  async function queueClassnote(subjectName: string) {
    if (!selected) return;
    const built = buildSaveInput(subjectName);
    if (!built) return;
    const student = selected;
    const res = await saveAndQueueClassnote(built.input);
    if (!res.ok) {
      toast.error(res.error ?? "ClassNote 발송 큐 적재에 실패했습니다");
      return;
    }
    patchReport(student.id, subjectName, (r) => ({
      ...r,
      draft: built.draft,
      sent: true,
      shareToken: res.shareToken ?? r.shareToken,
      classnoteStatus: res.status,
    }));
    const msg =
      res.status === "queued"
        ? "발송 대기 — 워커가 자동으로 게시합니다"
        : res.status === "success"
          ? "이미 발송 완료된 보고서입니다"
          : res.status === "processing"
            ? "이미 처리 중입니다"
            : res.status === "too_old"
              ? "오래된 보고서라 발송에서 제외됩니다"
              : "대기 중";
    toast.success(`${subjectName} ClassNote — ${msg}`);
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

      <OneScreenHubBar stats={hubStats} todayClasses={todayClasses} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)_minmax(0,380px)] lg:items-start">
        <StudentList
          students={visible}
          selId={effectiveId}
          onSelect={setSelId}
          reportCellById={reportCellById}
          classOrder={classTags.filter((t) => t !== "전체")}
        />

        {selected ? (
          <>
            {/* 중앙 그룹 — 좌측 학생목록·우측 보고서와 함께 3열 워크플로 영역을 그룹 제목으로 구분. */}
            <div className="flex flex-col gap-3">
              <header className="flex items-center gap-1.5">
                <span className="text-[14px] leading-none">📈</span>
                <h2 className="text-foreground text-sm font-semibold">오늘 진도 · 테스트</h2>
              </header>
              <ProgressCard
                student={selected}
                onConfirm={confirmProgress}
                onProgress={setProgress}
                onStudyGrade={setStudyGrade}
                onSemester={setSemester}
              />
              <TestCard student={selected} onScore={setScore} />
            </div>
            <div className="flex flex-col gap-3">
              <header className="flex items-center gap-1.5">
                <span className="text-[14px] leading-none">📋</span>
                <h2 className="text-foreground text-sm font-semibold">보고서</h2>
              </header>
              <ReportCard
                key={selected.id}
                student={selected}
                reports={reports[selected.id] ?? {}}
                attitudes={ATTITUDE}
                homeworks={HOMEWORK}
                onAttitude={setAttitude}
                onHomework={setHomework}
                onSubjectDraft={setSubjectDraft}
                onAutoWrite={autoWriteSubject}
                generatingSubject={genSubject}
                onSend={sendSubject}
                onQueueClassnote={queueClassnote}
              />
            </div>
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
