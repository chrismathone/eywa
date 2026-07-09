"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  CURRICULUM_GRADES,
  curriculumForGradeSemester,
  semesterOfLesson,
  semestersForGrade,
  type Semester,
} from "../curriculum";
import { subjectTone, toneSoftClass, toneSolidClass } from "../data";
import { buildGridRows, isReportEligible } from "../grid";
import type { OneScreenStudent } from "../types";
import { classnoteBadge, type SubjectReport } from "./report-card";

function clamp(n: number, max: number) {
  return Math.max(0, Math.min(max, n));
}

const NONE = "__none__"; // Base UI Select는 빈 문자열 값을 안 좋아함 → 미입력 sentinel.

/** 과목 진도 입력이 커리큘럼 드롭다운(math)인지 여부. 미지정은 math로 간주(progress-card와 동일 규칙). */
const isMathSubject = (key: string | undefined) => (key ?? "math") === "math";

/** 진도 셀 — math면 [학년][학기][차시] 컴팩트 select(progress-card와 동일 헬퍼), 그 외는 텍스트. */
function GridProgressCell({
  student,
  subjectIndex,
  onProgress,
  onStudyGrade,
  onSemester,
}: {
  student: OneScreenStudent;
  subjectIndex: number;
  onProgress: (studentId: string, subjectIndex: number, today: string) => void;
  onStudyGrade: (studentId: string, grade: string) => void;
  onSemester: (studentId: string, semester: Semester) => void;
}) {
  const su = student.subjects[subjectIndex];
  if (!su) return null;
  if (!isMathSubject(su.subjectKey)) {
    return (
      <input
        type="text"
        value={su.today}
        onChange={(e) => onProgress(student.id, subjectIndex, e.target.value)}
        placeholder="오늘 진도 (예: Unit 8 · p.90)"
        aria-label={`${student.name} ${su.name} 오늘 진도`}
        className="border-line bg-card focus:border-primary h-8 w-full min-w-[180px] rounded-sm border px-2 text-[12px] outline-none"
      />
    );
  }
  const studyGrade = student.studyGrade ?? student.grade;
  // 학기 = 현재 진도(첫 과목 today)에서 자동 도출(progress-card와 동일 — 학생 단위 진도 학년/학기).
  const semester = semesterOfLesson(studyGrade, student.subjects[0]?.today ?? "");
  const semesters = semestersForGrade(studyGrade);
  const units = curriculumForGradeSemester(studyGrade, semester);
  return (
    <div className="flex min-w-[240px] flex-col gap-1">
      <div className="flex items-center gap-1">
        <Select value={studyGrade} onValueChange={(v) => v && onStudyGrade(student.id, v as string)}>
          <SelectTrigger size="sm" aria-label={`${student.name} 진도 학년`}>
            <SelectValue>{(v) => v as string}</SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {CURRICULUM_GRADES.map((g) => (
              <SelectItem key={g} value={g}>
                {g}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={semester} onValueChange={(v) => v && onSemester(student.id, v as Semester)}>
          <SelectTrigger size="sm" aria-label={`${student.name} 학기`}>
            <SelectValue>{(v) => `${v}학기`}</SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {semesters.map((s) => (
              <SelectItem key={s} value={s}>
                {s}학기
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {studyGrade !== student.grade ? (
          <span className="bg-amber-soft text-amber shrink-0 rounded-[3px] px-1 py-0.5 text-[10px] font-bold">선행/후행</span>
        ) : null}
      </div>
      <Select value={su.today} onValueChange={(v) => v && onProgress(student.id, subjectIndex, v as string)}>
        <SelectTrigger size="sm" className="w-full" aria-label={`${student.name} 오늘 진도`}>
          <SelectValue placeholder="차시 선택">{(v) => v as string}</SelectValue>
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} className="max-h-80">
          {units.map((unit) => (
            <SelectGroup key={unit.unit}>
              <SelectLabel>{unit.unit}</SelectLabel>
              {unit.lessons.map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** 점수 셀 — 맞은 개수 입력 + /만점. test-card clamp 패턴 축약. */
function ScoreInput({
  value,
  max,
  onChange,
  label,
}: {
  value: number | null;
  max: number;
  onChange: (v: number | null) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-center gap-1">
      <input
        inputMode="numeric"
        value={value == null ? "" : String(value)}
        aria-label={label}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9]/g, "");
          onChange(raw === "" ? null : clamp(parseInt(raw, 10) || 0, max));
        }}
        className="border-line focus:border-primary tabular h-8 w-11 rounded-sm border bg-background px-1 text-center text-[13px] font-bold outline-none"
      />
      <span className="text-text-faint tabular text-[11px]">/{max}</span>
    </div>
  );
}

const TH = "text-text-faint px-2 py-2 text-left text-[11px] font-semibold whitespace-nowrap";
const TD = "border-line border-t px-2 py-1.5 align-top";

/**
 * 선생님 원스크린 — 표(스프레드시트) 대량작성 뷰.
 * 카드 뷰와 **같은 state·저장로직**을 공유(핸들러는 studentId 파라미터 버전). 행 = (학생 × 과목).
 * 반 전체 진도·점수·태도·과제·교재명을 한 표에서 입력 → 일괄 저장 / 일괄 ClassNote 발송.
 */
export function OneScreenGrid({
  students,
  reports,
  attitudes,
  homeworks,
  onProgress,
  onStudyGrade,
  onSemester,
  onScore,
  onAttitude,
  onHomework,
  onTextbook,
  onSendRow,
  onSaveAll,
  onSendAll,
}: {
  students: OneScreenStudent[]; // 현재 필터(반)로 보이는 학생만
  reports: Record<string, Record<string, SubjectReport>>; // studentId → 과목명 → 발송상태
  attitudes: readonly string[];
  homeworks: readonly string[];
  onProgress: (studentId: string, subjectIndex: number, today: string) => void;
  onStudyGrade: (studentId: string, grade: string) => void;
  onSemester: (studentId: string, semester: Semester) => void;
  onScore: (studentId: string, which: "daily" | "check", v: number | null) => void;
  onAttitude: (studentId: string, a: string | null) => void;
  onHomework: (studentId: string, h: string) => void;
  onTextbook: (studentId: string, subjectName: string, text: string) => void;
  onSendRow: (student: OneScreenStudent, subjectName: string) => void;
  onSaveAll: () => void;
  onSendAll: () => void;
}) {
  const rows = buildGridRows(students);
  const eligible = rows.filter((r) => isReportEligible(r.subject)).length;

  if (rows.length === 0) {
    return (
      <div className="bg-card border-line shadow-card text-text-faint flex items-center justify-center rounded-md border p-10 text-sm">
        표시할 학생이 없습니다
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 일괄 바 — 오늘 진도 있는 행만 대상(빈 행 skip). */}
      <div className="bg-card border-line shadow-card flex flex-wrap items-center gap-2 rounded-md border px-4 py-2.5">
        <span className="text-text-dim text-[12px]">
          표시 <span className="text-foreground font-bold">{rows.length}</span>행 · 발송가능(진도 입력){" "}
          <span className="text-foreground font-bold">{eligible}</span>행
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={onSaveAll} disabled={eligible === 0}>
            일괄 저장
          </Button>
          <Button size="sm" onClick={onSendAll} disabled={eligible === 0}>
            ClassNote 일괄 발송
          </Button>
        </div>
      </div>

      <div className="bg-card border-line shadow-card overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-bg-soft">
              <th className={`${TH} sticky left-0 z-10 bg-bg-soft`}>학생 · 반</th>
              <th className={TH}>진도(오늘)</th>
              <th className={`${TH} text-center`}>일일</th>
              <th className={`${TH} text-center`}>확인</th>
              <th className={TH}>태도</th>
              <th className={TH}>과제</th>
              <th className={TH}>교재명</th>
              <th className={`${TH} text-center`}>발송</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ student, subject, subjectIndex, key }) => {
              const { tone } = subjectTone(subject.name);
              const rep = reports[student.id]?.[subject.name];
              const badge = classnoteBadge(rep?.classnoteStatus);
              const att = student.attendance;
              return (
                <tr key={key} className="hover:bg-bg-soft/50">
                  <td className={`${TD} bg-card sticky left-0 z-10 min-w-[140px]`}>
                    <div className="flex items-center gap-1.5">
                      <span className={`size-1.5 shrink-0 rounded-full ${toneSolidClass(tone)}`} aria-hidden />
                      <span className="text-foreground font-semibold">{student.name}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      <span className={`rounded-pill px-1.5 py-px text-[10px] font-semibold ${toneSoftClass(tone)}`}>
                        {subject.name}
                      </span>
                      <span className="text-text-faint text-[10px]">{student.tag}</span>
                      {att !== "출석" ? (
                        <span
                          className={`rounded-pill px-1.5 py-px text-[10px] font-semibold ${
                            att === "지각" ? "bg-amber-soft text-amber" : "bg-danger text-white"
                          }`}
                        >
                          {att}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className={TD}>
                    <GridProgressCell
                      student={student}
                      subjectIndex={subjectIndex}
                      onProgress={onProgress}
                      onStudyGrade={onStudyGrade}
                      onSemester={onSemester}
                    />
                  </td>
                  <td className={`${TD} text-center`}>
                    <ScoreInput
                      value={student.tests.daily.score}
                      max={student.tests.daily.max}
                      onChange={(v) => onScore(student.id, "daily", v)}
                      label={`${student.name} 일일테스트`}
                    />
                  </td>
                  <td className={`${TD} text-center`}>
                    <ScoreInput
                      value={student.tests.check.score}
                      max={student.tests.check.max}
                      onChange={(v) => onScore(student.id, "check", v)}
                      label={`${student.name} 확인테스트`}
                    />
                  </td>
                  <td className={TD}>
                    <Select
                      value={student.attitude ?? NONE}
                      onValueChange={(v) => onAttitude(student.id, v === NONE ? null : (v as string))}
                    >
                      <SelectTrigger size="sm" className="min-w-[92px]" aria-label={`${student.name} 태도`}>
                        <SelectValue>{(v) => (v === NONE ? "—" : (v as string))}</SelectValue>
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectItem value={NONE}>—</SelectItem>
                        {attitudes.map((a) => (
                          <SelectItem key={a} value={a}>
                            {a}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className={TD}>
                    <Select
                      value={student.homework || NONE}
                      onValueChange={(v) => onHomework(student.id, v === NONE ? "" : (v as string))}
                    >
                      <SelectTrigger size="sm" className="min-w-[92px]" aria-label={`${student.name} 과제`}>
                        <SelectValue>{(v) => (v === NONE ? "—" : (v as string))}</SelectValue>
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectItem value={NONE}>—</SelectItem>
                        {homeworks.map((h) => (
                          <SelectItem key={h} value={h}>
                            {h}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className={TD}>
                    <input
                      type="text"
                      value={subject.textbook ?? ""}
                      onChange={(e) => onTextbook(student.id, subject.name, e.target.value)}
                      placeholder="교재명"
                      aria-label={`${student.name} ${subject.name} 교재명`}
                      className="border-line bg-card focus:border-primary h-8 w-full min-w-[120px] rounded-sm border px-2 text-[12px] outline-none"
                    />
                  </td>
                  <td className={`${TD} text-center`}>
                    <div className="flex flex-col items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!isReportEligible(subject)}
                        onClick={() => onSendRow(student, subject.name)}
                      >
                        발송
                      </Button>
                      {badge ? <span className={`text-[10px] font-semibold ${badge.cls}`}>{badge.label}</span> : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
