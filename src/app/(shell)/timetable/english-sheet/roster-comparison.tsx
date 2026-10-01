"use client";

import { useState } from "react";
import Link from "next/link";
import { STUDENT_STATUS_LABEL } from "@/features/students/status-labels";
import {
  compareRosterMembers,
  type MasterRosterReview,
} from "@/features/timetable/import/master/roster-review";
import type { RosterStudentRef } from "@/features/timetable/import/roster/match-roster";

function StudentInfo({ student }: { student: RosterStudentRef }) {
  return (
    <>
      <Link
        href={`/students/${student.studentId}`}
        prefetch={false}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline"
      >
        {student.name}
      </Link>
      <span className="ml-2 text-xs text-text-dim">
        {student.school ?? "학교 없음"} · {student.grade ?? "학년 없음"} ·{" "}
        {STUDENT_STATUS_LABEL[student.status ?? ""] ?? "상태 확인 필요"}
      </span>
    </>
  );
}

export function RosterComparison({
  sheet,
  existing,
  comparisonLabel,
  currentClasses,
}: {
  sheet: MasterRosterReview["sheet"][number] | undefined;
  existing: MasterRosterReview["existing"][number] | undefined;
  comparisonLabel: string;
  currentClasses: Map<string, string[]>;
}) {
  const [expanded, setExpanded] = useState(false);
  const members = sheet?.members ?? [];
  const comparison = compareRosterMembers(members, existing?.members ?? []);
  return (
    <details
      className="mt-3 border-t border-line pt-3"
      onToggle={(e) => setExpanded(e.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm">
        명단 보기 · 시트 {members.length}명
        {existing
          ? ` / ${comparisonLabel} ${existing.members.length}명 · 공통 ${comparison.common.size}명`
          : " · 비교할 반을 선택해 주세요"}
      </summary>
      {expanded ? (
        <div className="mt-3 space-y-3 text-sm">
          {existing ? (
            <p className="text-xs text-text-dim">
              공통 {comparison.common.size}명 · 시트에만{" "}
              {comparison.sheetOnly.size}명 · 기존 반에만{" "}
              {comparison.existingOnly.length}명 · 학생 연결 미확정{" "}
              {comparison.unresolved}명. 기존 반에만 있는 학생의 수강은 자동
              종료하지 않습니다.
            </p>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <section
              aria-label={`${sheet?.sheetName ?? "시트"} 시트 명단`}
              className="min-w-0 rounded-md bg-bg-soft p-3"
            >
              <h3 className="font-medium">
                시트 명단 · {members.length}명
                {sheet ? ` (기재 인원 ${sheet.declared}명)` : ""}
              </h3>
              {!members.length ? (
                <p className="mt-2 text-text-dim">
                  이 반의 시트 명단을 찾지 못했습니다.
                </p>
              ) : null}
              <ol className="mt-2 space-y-3">
                {members.map((m, i) => (
                  <li key={`${i}:${m.raw}`} className="break-words">
                    <div>
                      <span className="mr-2 text-text-dim">{i + 1}.</span>
                      <strong>{m.name}</strong>
                      <span className="ml-2 text-xs text-text-dim">
                        {m.school ?? "학교 없음"} · {m.grade ?? "학년 없음"}
                      </span>
                    </div>
                    {m.student ? (
                      <>
                        <div className="mt-1">
                          에이와: <StudentInfo student={m.student} />
                        </div>
                        <p className="mt-1 text-xs text-text-dim">
                          {m.needsConfirmation
                            ? "동일 학생 확인 필요 · "
                            : "이름 일치 · "}
                          {existing
                            ? comparison.common.has(m.student.studentId)
                              ? "공통 · "
                              : "시트에만 · "
                            : ""}
                          적용일 기준 영어 반:{" "}
                          {currentClasses
                            .get(m.student.studentId)
                            ?.join(", ") || "없음"}
                        </p>
                      </>
                    ) : (
                      <div className="mt-1 text-destructive">
                        {m.candidates.length
                          ? "동명이인 연결 미확정"
                          : "학생을 찾지 못함"}
                        {m.candidates.map((c) => (
                          <div key={c.studentId}>
                            <StudentInfo student={c} />
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </section>
            <section
              aria-label={`${existing?.className ?? "기존 반"} 기존 명단`}
              className="min-w-0 rounded-md bg-bg-soft p-3"
            >
              <h3 className="font-medium">
                {comparisonLabel || "기존 반"} 명단 ·{" "}
                {existing?.members.length ?? 0}명
              </h3>
              {!existing ? (
                <p className="mt-2 text-text-dim">
                  비교할 기존 반을 선택해 주세요.
                </p>
              ) : !existing.members.length ? (
                <p className="mt-2 text-text-dim">
                  적용일 기준 명단이 없습니다.
                </p>
              ) : null}
              <ol className="mt-2 space-y-3">
                {existing?.members.map((s, i) => (
                  <li key={s.studentId} className="break-words">
                    <span className="mr-2 text-text-dim">{i + 1}.</span>
                    <StudentInfo student={s} />
                    <p className="mt-1 text-xs text-text-dim">
                      {comparison.common.has(s.studentId)
                        ? "공통"
                        : "기존 반에만 · 수강 유지"}
                      {s.onHold ? " · 수강 휴원" : ""}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </div>
      ) : null}
    </details>
  );
}
