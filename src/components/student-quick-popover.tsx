"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Initial, type InitialColor } from "@/components/atoms/initial";
import { Pill, type PillColor } from "@/components/atoms/pill";

const SUBJECT_META: Record<string, { label: string; color: PillColor }> = {
  math: { label: "수학", color: "primary" },
  english: { label: "영어", color: "blue" },
  korean: { label: "국어", color: "rose" },
  science: { label: "과학", color: "purple" },
  arts: { label: "예술", color: "amber" },
};

export type StudentQuickInfo = {
  id: string;
  name: string;
  grade?: string | null;
  school?: string | null;
  status?: string | null;
  subjects?: string[];
  primaryTeacherName?: string | null;
  parentPhone?: string | null;
  // optional 추가 데이터 (학생목록 row에 이미 있는 것만 활용)
  enrolledAt?: string | null;
};

function colorForGrade(grade?: string | null): InitialColor {
  if (!grade) return "neutral";
  if (grade.startsWith("중1")) return "blue";
  if (grade.startsWith("중2")) return "primary";
  if (grade.startsWith("중3")) return "gold";
  if (grade.startsWith("고1")) return "purple";
  if (grade.startsWith("고2")) return "rose";
  if (grade.startsWith("고3")) return "amber";
  return "neutral";
}

/**
 * 학생명 hover/focus → 우측 아래에 미니 카드 (수강 과목 + 담임 + 학부모 연락처).
 * 학생목록/출석부/시간표/수납 어디서든 학생 이름을 wrap하면 cross-ref UX.
 * 외부에서 student 정보 props로 전달 (페이지에서 이미 fetch된 데이터 활용).
 */
export function StudentQuickPopover({
  student,
  children,
  href,
}: {
  student: StudentQuickInfo;
  children: ReactNode;
  href?: string;
}) {
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(true);
  };
  const hide = () => {
    timeoutRef.current = setTimeout(() => setOpen(false), 150);
  };

  const detailHref = href ?? `/students/${student.id}`;
  const isWithdrawn = student.status === "withdrawn";

  return (
    <span
      className="relative inline-block"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open ? (
        <div
          className="bg-card border-line shadow-modal absolute top-full left-0 z-30 mt-1 w-[280px] rounded-md border p-3.5"
          onMouseEnter={show}
          onMouseLeave={hide}
          role="dialog"
        >
          {/* 헤더 */}
          <header className="flex items-start gap-2.5">
            <Initial name={student.name} color={colorForGrade(student.grade)} size="md" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-foreground text-[14px] font-bold">{student.name}</p>
                {isWithdrawn ? <Pill color="neutral">퇴원</Pill> : null}
              </div>
              <p className="text-text-dim text-[11px]">
                {student.grade ?? "—"}
                {student.school ? <> · {student.school}</> : null}
              </p>
            </div>
          </header>

          {/* 수강 과목 */}
          {student.subjects && student.subjects.length > 0 ? (
            <div className="border-line mt-2.5 border-t pt-2.5">
              <p className="micro mb-1.5 text-[9px]">수강 과목</p>
              <div className="flex flex-wrap gap-1">
                {student.subjects.map((sub) => {
                  const meta = SUBJECT_META[sub] ?? {
                    label: sub,
                    color: "neutral" as PillColor,
                  };
                  return (
                    <Pill key={sub} color={meta.color}>
                      {meta.label}
                    </Pill>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* 담임 + 학부모 */}
          <div className="border-line mt-2.5 space-y-1.5 border-t pt-2.5 text-[11px]">
            {student.primaryTeacherName ? (
              <div className="flex items-center justify-between">
                <span className="text-text-dim">담임</span>
                <span className="text-foreground font-semibold">
                  {student.primaryTeacherName}
                </span>
              </div>
            ) : null}
            {student.parentPhone ? (
              <div className="flex items-center justify-between">
                <span className="text-text-dim">학부모</span>
                <span className="text-foreground num font-mono">{student.parentPhone}</span>
              </div>
            ) : null}
            {student.enrolledAt ? (
              <div className="flex items-center justify-between">
                <span className="text-text-dim">등록일</span>
                <span className="text-foreground num font-mono">{student.enrolledAt}</span>
              </div>
            ) : null}
          </div>

          {/* 액션 */}
          <Link
            href={detailHref}
            className="bg-primary text-primary-foreground hover:bg-primary-hover mt-3 flex items-center justify-center gap-1.5 rounded-sm py-2 text-[12px] font-bold transition"
          >
            상세 보기
            <EyIcon name="arrowRight" size={12} />
          </Link>
        </div>
      ) : null}
    </span>
  );
}
