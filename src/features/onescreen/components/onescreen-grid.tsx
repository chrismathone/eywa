"use client";

import { useState } from "react";
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
        className="border-line bg-card focus:border-primary h-8 w-full rounded-sm border px-2 text-[12px] outline-none"
      />
    );
  }
  const studyGrade = student.studyGrade ?? student.grade;
  // 학기 = 현재 진도(첫 과목 today)에서 자동 도출(progress-card와 동일 — 학생 단위 진도 학년/학기).
  const semester = semesterOfLesson(studyGrade, student.subjects[0]?.today ?? "");
  const semesters = semestersForGrade(studyGrade);
  const units = curriculumForGradeSemester(studyGrade, semester);
  return (
    <div className="flex flex-col gap-1">
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

/** 점수 셀 — 맞은 개수 입력 + /만점. allowMax면 만점(/N)도 편집 가능(학원 설정). */
function ScoreInput({
  value,
  max,
  onChange,
  label,
  allowMax,
  onMax,
}: {
  value: number | null;
  max: number;
  onChange: (v: number | null) => void;
  label: string;
  allowMax?: boolean;
  onMax?: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-0.5">
      <input
        inputMode="numeric"
        value={value == null ? "" : String(value)}
        aria-label={label}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9]/g, "");
          onChange(raw === "" ? null : clamp(parseInt(raw, 10) || 0, max));
        }}
        className="border-line focus:border-primary tabular h-8 w-10 rounded-sm border bg-background px-1 text-center text-[13px] font-bold outline-none"
      />
      <span className="text-text-faint tabular text-[11px]">/</span>
      {allowMax && onMax ? (
        <input
          inputMode="numeric"
          value={String(max)}
          aria-label={`${label} 문항수`}
          title="문항수(만점)"
          onChange={(e) => {
            const n = parseInt(e.target.value.replace(/[^0-9]/g, ""), 10);
            if (!Number.isNaN(n) && n > 0) onMax(n);
          }}
          className="border-line focus:border-primary tabular h-8 w-8 rounded-sm border bg-background px-0.5 text-center text-[11px] outline-none"
        />
      ) : (
        <span className="text-text-faint tabular text-[11px]">{max}</span>
      )}
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
  onDraft,
  onSendRow,
  onSaveAll,
  onSendAll,
  allowTestMax,
  onMax,
  onMakeup,
  onAutoWrite,
  onAutoWriteAll,
  onOpenCard,
  genKey,
  bulkGen,
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
  onDraft: (studentId: string, subjectName: string, text: string) => void; // 학부모 문구(멘트) 편집
  onSendRow: (student: OneScreenStudent, subjectName: string) => void;
  onSaveAll: (keys?: string[]) => void; // keys(선택 행) 있으면 그 행만, 없으면 전체
  onSendAll: (keys?: string[]) => void;
  allowTestMax: boolean; // 강사 문항수 변경 허용(학원 설정)
  onMax: (studentId: string, which: "daily" | "check", v: number) => void;
  onMakeup: (studentId: string, subjectName: string) => void; // 보강 토글
  onAutoWrite: (student: OneScreenStudent, subjectName: string) => void; // 행별 AI 멘트 자동작성
  onAutoWriteAll: (keys?: string[]) => void; // 선택(또는 전체) 행 자동작성
  onOpenCard: (studentId: string) => void; // 그 학생을 카드 뷰로 열기(본문·첨부·링크 편집)
  genKey?: string | null; // 자동작성 중인 행 키(studentId::과목)
  bulkGen?: boolean; // 전체 자동작성 진행중
}) {
  const rows = buildGridRows(students);
  const eligibleRows = rows.filter((r) => isReportEligible(r.subject));
  const eligible = eligibleRows.length;
  // 행 선택(체크) — 일괄 작업 대상. 선택 없으면 발송가능 전체가 대상.
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const selectedKeys = eligibleRows.filter((r) => checked.has(r.key)).map((r) => r.key);
  const allChecked = eligible > 0 && selectedKeys.length === eligible;
  const toggleRow = (k: string) =>
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const toggleAll = () =>
    setChecked((prev) => {
      const n = new Set(prev);
      if (allChecked) eligibleRows.forEach((r) => n.delete(r.key));
      else eligibleRows.forEach((r) => n.add(r.key));
      return n;
    });

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
          표시 <span className="text-foreground font-bold">{rows.length}</span> · 발송가능{" "}
          <span className="text-foreground font-bold">{eligible}</span>
          {selectedKeys.length ? (
            <>
              {" "}
              · 선택 <span className="text-primary font-bold">{selectedKeys.length}</span>
            </>
          ) : null}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onAutoWriteAll(selectedKeys)}
            disabled={eligible === 0 || bulkGen}
          >
            {bulkGen ? "자동작성 중…" : selectedKeys.length ? `선택 ${selectedKeys.length} 자동작성` : "전체 자동작성"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSaveAll(selectedKeys)}
            disabled={eligible === 0 || bulkGen}
          >
            {selectedKeys.length ? "선택 저장" : "일괄 저장"}
          </Button>
          <Button size="sm" onClick={() => onSendAll(selectedKeys)} disabled={eligible === 0 || bulkGen}>
            {selectedKeys.length ? `선택 ${selectedKeys.length} 발송` : "ClassNote 일괄 발송"}
          </Button>
        </div>
      </div>

      <div className="bg-card border-line shadow-card overflow-x-auto rounded-md border">
        {/* table-fixed + colgroup 고정 폭 — 헤더/본문 열 정렬 결정적, 표는 내용 폭(좌측 정렬)이라 진도가 남는 폭을 독식하지 않음. */}
        <table className="w-full min-w-[1240px] table-fixed border-collapse text-[12px]">
          <colgroup>
            <col className="w-[34px]" /> {/* 선택 */}
            <col className="w-[128px]" /> {/* 학생·반 */}
            <col className="w-[200px]" /> {/* 진도 */}
            <col className="w-[88px]" /> {/* 일일 */}
            <col className="w-[88px]" /> {/* 확인 */}
            <col className="w-[96px]" /> {/* 태도 */}
            <col className="w-[96px]" /> {/* 과제 */}
            <col className="w-[140px]" /> {/* 교재명 · 보강 */}
            <col /> {/* 학부모 문구(멘트) — 남는 폭 흡수(우측 공간 활용) */}
            <col className="w-[132px]" /> {/* 자동작성 · 카드 · 발송 */}
          </colgroup>
          <thead>
            <tr className="bg-bg-soft">
              <th className={`${TH} text-center`}>
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAll}
                  aria-label="발송가능 행 전체 선택"
                  className="accent-primary size-3.5 align-middle"
                />
              </th>
              <th className={TH}>학생 · 반</th>
              <th className={TH}>진도(오늘)</th>
              <th className={`${TH} text-center`}>일일</th>
              <th className={`${TH} text-center`}>확인</th>
              <th className={TH}>태도</th>
              <th className={TH}>과제</th>
              <th className={TH}>교재명 · 보강</th>
              <th className={TH}>학부모 문구</th>
              <th className={TH}>발송 · 편집</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ student, subject, subjectIndex, key }) => {
              const { tone } = subjectTone(subject.name);
              const rep = reports[student.id]?.[subject.name];
              const badge = classnoteBadge(rep?.classnoteStatus);
              const att = student.attendance;
              const genRowBusy = genKey === key; // 이 행 자동작성 중
              const hasDraft = !!rep?.draft?.trim(); // 학부모 멘트(draft) 준비됨 — 발송 시 사용
              return (
                <tr key={key} className="hover:bg-bg-soft/50">
                  <td className={`${TD} text-center`}>
                    <input
                      type="checkbox"
                      checked={checked.has(key)}
                      disabled={!isReportEligible(subject)}
                      onChange={() => toggleRow(key)}
                      aria-label={`${student.name} ${subject.name} 선택`}
                      className="accent-primary size-3.5 align-middle disabled:opacity-40"
                    />
                  </td>
                  <td className={TD}>
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
                      allowMax={allowTestMax}
                      onMax={(v) => onMax(student.id, "daily", v)}
                    />
                  </td>
                  <td className={`${TD} text-center`}>
                    <ScoreInput
                      value={student.tests.check.score}
                      max={student.tests.check.max}
                      onChange={(v) => onScore(student.id, "check", v)}
                      label={`${student.name} 확인테스트`}
                      allowMax={allowTestMax}
                      onMax={(v) => onMax(student.id, "check", v)}
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
                    <div className="flex flex-col gap-1">
                      <input
                        type="text"
                        value={subject.textbook ?? ""}
                        onChange={(e) => onTextbook(student.id, subject.name, e.target.value)}
                        placeholder="교재명"
                        aria-label={`${student.name} ${subject.name} 교재명`}
                        className="border-line bg-card focus:border-primary h-8 w-full rounded-sm border px-2 text-[12px] outline-none"
                      />
                      <label className="text-text-dim flex w-fit cursor-pointer items-center gap-1 text-[11px]">
                        <input
                          type="checkbox"
                          checked={!!subject.makeup}
                          onChange={() => onMakeup(student.id, subject.name)}
                          className="accent-primary size-3.5"
                          aria-label={`${student.name} ${subject.name} 보강`}
                        />
                        보강
                      </label>
                    </div>
                  </td>
                  <td className={TD}>
                    {/* 학부모 문구(멘트) — 자동작성 채움 · 직접 편집 · 발송 전 확인. 우측 남는 폭 활용. */}
                    <textarea
                      value={rep?.draft ?? ""}
                      onChange={(e) => onDraft(student.id, subject.name, e.target.value)}
                      placeholder={genRowBusy ? "자동작성 중…" : "'자동작성'으로 생성 · 직접 편집·확인 후 발송"}
                      aria-label={`${student.name} ${subject.name} 학부모 문구`}
                      className="border-line focus:border-primary scrollbar-thin h-[72px] w-full resize-none rounded-sm border bg-background px-2 py-1 text-[11px] leading-snug outline-none"
                    />
                  </td>
                  <td className={TD}>
                    <div className="flex flex-col items-stretch gap-1">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => onAutoWrite(student, subject.name)}
                          disabled={genRowBusy || bulkGen}
                          title="AI 학부모 멘트 자동작성 (발송 문구)"
                          className={`border-line hover:bg-bg-soft flex-1 rounded-sm border px-1 py-1 text-[11px] font-semibold disabled:opacity-50 ${
                            hasDraft ? "text-primary" : "text-text-dim"
                          }`}
                        >
                          {genRowBusy ? "…" : hasDraft ? "✓멘트" : "자동작성"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenCard(student.id)}
                          title="카드로 열어 본문·첨부·링크 편집"
                          className="border-line text-text-dim hover:bg-bg-soft shrink-0 rounded-sm border px-1.5 py-1 text-[11px] font-semibold"
                        >
                          카드
                        </button>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!isReportEligible(subject)}
                        onClick={() => onSendRow(student, subject.name)}
                      >
                        발송
                      </Button>
                      {badge ? (
                        <span className={`text-center text-[10px] font-semibold ${badge.cls}`}>{badge.label}</span>
                      ) : null}
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
