"use client";

import { useState } from "react";
import { PilotSheetHead } from "@/features/onescreen/components/pilot-sheet-head";
import type { LevelRow } from "@/features/onescreen/pilot-notes";
import { DONE_CHECK, reportCheckRows, type BeforeClassCheck } from "../items";
import { checkKey, type ReportDayLevels, type RosterStudent } from "../types";

/**
 * 보고서 시안(원장 2026-10-28 *"디자인 시안 기존꺼에 데이터만 넣은 형식"*) — 학부모 수학 보고서의 머리 표(`PilotSheetHead`)를
 * **그대로** 쓰고 수업 평가 줄만 7개로 채운다: 수업태도 · 이해도(그날 쓴 보고서 값) + 예습영상 · 개념정리 · 풀이노트정리 ·
 * 문제풀이 · 오답정리(이 체크리스트, 눈금 규칙 = items.ts `reportCheckLevels`). 보기 전용.
 * 체크리스트 줄은 **실제 수업보고서 자동작성과 같은 규칙**(server/report-rows.ts, 원장 2026-10-30) — 그날 이 반에 체크가 하나라도 있으면
 * 행이 없는 학생은 '모두 해 옴', 아무도 체크하지 않은 날·결석은 줄 없음. 실제 보고서는 짝 반(같은 명단의 MS반)에서 나간다 —
 * 이 시안은 지금 고른 반의 체크만 본다.
 */
export function ReportPreview({
  date, students, checks, autoExcused, reportLevels, className, teacherName, logoSrc, academyName,
}: {
  date: string;
  students: RosterStudent[];
  checks: Record<string, BeforeClassCheck>;
  /** '지난 수업 결석' 자동 제외 칸 — 실제 보고서처럼 줄을 안 낸다. */
  autoExcused: string[];
  reportLevels: Record<string, ReportDayLevels>;
  className: string;
  teacherName: string;
  logoSrc: string | null;
  academyName: string;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  if (students.length === 0) return <p className="text-text-dim px-1 py-6 text-sm">이날 이 반 명단에 학생이 없습니다.</p>;
  const student = students.find((s) => s.id === picked) ?? students[0]!;
  const key = checkKey(student.id, date);
  const classChecked = students.some((s) => checks[checkKey(s.id, date)]);
  const base: BeforeClassCheck | null = checks[key] ?? (classChecked ? DONE_CHECK : null);
  // 체크 제외(직접·자동)면 체크리스트 줄 없음(원장 2026-11-02 — reportCheckRows가 거른다).
  const check = base && autoExcused.includes(key) ? { ...base, autoExcused: true } : base;
  const report = reportLevels[key];
  // 값이 없는 줄은 세우지 않는다(원장 2026-10-28 *"내용들이 없으면 … 해당 영역 날리는 게"*) — '평가 없음'·'체크 전' 줄 없음.
  // 결석이면 체크리스트 줄 없음(원장 2026-10-30 — 10-28 '결석 한 줄'을 뒤집음). 남는 줄이 없으면 평가 표째 뺀다.
  const levels: LevelRow[] = [
    ...(report?.attitude ? [{ label: "수업태도", level: report.attitude }] : []),
    ...(report?.understanding ? [{ label: "이해도", level: report.understanding }] : []),
    ...reportCheckRows(check),
  ];

  return (
    <div className="flex flex-col gap-4 px-1 lg:flex-row lg:items-start">
      <ul className="flex flex-wrap gap-1.5 lg:w-48 lg:flex-col" aria-label="학생 고르기">
        {students.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => setPicked(s.id)}
              className={`w-full rounded-lg px-2.5 py-1.5 text-left text-sm whitespace-nowrap ${s.id === student.id ? "bg-primary text-primary-foreground font-bold" : "hover:bg-bg-soft border-line border"}`}
            >
              {s.name}
            </button>
          </li>
        ))}
      </ul>
      <div className="w-full max-w-[520px]">
        <p className="text-text-dim mb-2 text-xs">시험 중 — 체크리스트 줄은 지금 테스트 학생(학원이·학원삼) 수업보고서에만 들어갑니다. 같은 명단의 반(JJ↔MS)에서 체크한 내용이 수학 보고서에 붙고, 결석이면 붙지 않습니다. 수업태도·이해도 = 그날 쓴 수업보고서 값.</p>
        <div className="bg-card border-line-strong overflow-hidden border">
          <PilotSheetHead
            logoSrc={logoSrc}
            academyName={academyName}
            subjectLabel="수학"
            studentName={student.name}
            schoolGrade={student.schoolGrade}
            title="수학 보고서"
            date={date}
            className={className}
            teacherName={teacherName}
            tests={[]}
            levels={levels.length ? levels : null}
          />
        </div>
      </div>
    </div>
  );
}
