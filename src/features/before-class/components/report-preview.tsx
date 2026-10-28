"use client";

import { useState } from "react";
import { PilotSheetHead } from "@/features/onescreen/components/pilot-sheet-head";
import type { LevelRow } from "@/features/onescreen/pilot-notes";
import { reportCheckLevels, type BeforeClassCheck } from "../items";
import { checkKey, type ReportDayLevels, type RosterStudent } from "../types";

const DONE: BeforeClassCheck = { missed: [], absent: false, card: null };

/**
 * 보고서 시안(원장 2026-10-28 *"디자인 시안 기존꺼에 데이터만 넣은 형식"*) — 학부모 수학 보고서의 머리 표(`PilotSheetHead`)를
 * **그대로** 쓰고 수업 평가 줄만 7개로 채운다: 수업태도 · 이해도(그날 쓴 보고서 값) + 예습영상 · 개념정리 · 풀이노트정리 ·
 * 문제풀이 · 오답정리(이 체크리스트, 눈금 규칙 = items.ts `reportCheckLevels`). 보기 전용 — 실제 보고서·발송은 바뀌지 않는다.
 * 체크가 없는 지난 수업일은 시트처럼 '모두 해 옴'으로 본다 · 오늘·아직 안 온 날은 '체크 전'.
 */
export function ReportPreview({
  date, today, students, checks, reportLevels, className, teacherName, logoSrc, academyName,
}: {
  date: string;
  today: string;
  students: RosterStudent[];
  checks: Record<string, BeforeClassCheck>;
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
  // 오늘은 아직 체크 중일 수 있어 지난 날만 '모두 해 옴'으로 본다(오늘 기록이 없으면 '체크 전').
  const check = checks[key] ?? (date < today ? DONE : null);
  const report = reportLevels[key];
  const fromReport = (label: string, level: ReportDayLevels["attitude"] | undefined): LevelRow =>
    level ? { label, level } : { label, level: null, none: "평가 없음" };
  const levels: LevelRow[] = [
    fromReport("수업태도", report?.attitude),
    fromReport("이해도", report?.understanding),
    ...(check
      ? reportCheckLevels(check).map((r): LevelRow => (r.level ? { label: r.label, level: r.level } : { label: r.label, level: null, none: "결석" }))
      : reportCheckLevels(DONE).map((r): LevelRow => ({ label: r.label, level: null, none: "체크 전" }))),
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
        <p className="text-text-dim mb-2 text-xs">시안 — 실제 보고서·발송에는 아직 들어가지 않습니다. 수업태도·이해도 = 그날 쓴 수업보고서 값.</p>
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
            levels={levels}
          />
        </div>
      </div>
    </div>
  );
}
