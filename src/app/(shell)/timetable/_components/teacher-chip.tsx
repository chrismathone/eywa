"use client";

import { useState } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { SUBJECT_SOFT } from "@/features/owner/subjects";
import { formatSchoolGrade } from "@/features/exports/math-timetable/student-format";
import { readableTextColor } from "@/lib/color-utils";
import type { ClassDetailQuick } from "./class-cell";
import { ClassInfoCard, HoverCard } from "./hover-cards";

// 강사뷰(10분 격자) 전용 칩 — 기본은 시트처럼 **반명+방만**, 클릭하면 그 자리에서 재원 학생
// 명단으로 전환(다시 클릭=복귀). 블록 높이는 고정(10분 축)이라 명단이 넘치면 블록 내부 스크롤.
// hover = 수업 정보 카드(시각·인원·담임 — body 포털이라 클리핑 무관), 학생 행 클릭 = 학생 창.
// (ClassCell을 안 쓰는 이유: 헤더가 WindowLink(반 창 이동)라 클릭 토글과 충돌 — 강사뷰는 읽기
// 전용 시트 미러라 전용 경량 칩이 맞다. 반 상세 진입은 기본뷰/통합뷰 소관.)

/** 학교+학년 압축("경명중"+"중1"→"경명중1") — class-cell의 metaLabel과 동일 규약. */
function metaLabel(school: string | null | undefined, grade: string | null | undefined): string {
  const sg = formatSchoolGrade(school, grade, { numberLast: true });
  return sg === "-" ? "" : sg;
}

export function TeacherChip({ slot }: { slot: ClassDetailQuick }) {
  const [open, setOpen] = useState(false);
  const subjects = useSubjectMaps();
  const color = SUBJECT_SOFT[subjects.colorOf(slot.subject)];
  const headerStyle = slot.classBgColor
    ? { background: slot.classBgColor, color: slot.classTextColor ?? readableTextColor(slot.classBgColor) }
    : undefined;
  const active = slot.students.filter((s) => (s.status ?? "active") === "active");

  return (
    // 블록(병합 셀) 전체를 채운다 — 시트 병합 셀처럼 접힘 상태에선 색면이 블록을 꽉 채우고
    // (반명은 상단), 펼침 상태에선 색 헤더 한 줄 + 아래 학생 명단. 레인 구조상 블록당 칩 1개.
    <div className="border-line flex min-h-0 flex-1 flex-col overflow-hidden rounded-[3px] border">
      <HoverCard
        width={230}
        card={
          <ClassInfoCard
            className={slot.className}
            subject={slot.subject}
            teacherName={slot.teacherName}
            room={slot.classroomName}
            schedule={`${slot.startTime.slice(0, 5)}~${slot.endTime.slice(0, 5)}`}
            counts={{ active: active.length, hold: 0, withdrawn: 0 }}
            pendingHandover={slot.pendingHandover ?? null}
          />
        }
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          title={open ? "반명으로" : "학생 명단"}
          className={`block w-full cursor-pointer px-1.5 py-1 text-left transition hover:brightness-95 ${slot.classBgColor ? "" : color} ${
            open ? "border-line shrink-0 border-b" : "min-h-0 flex-1 overflow-hidden"
          }`}
          style={headerStyle}
        >
          {open ? (
            /* 펼침 헤더 — 명단 공간 확보를 위해 한 줄(반명+인원). */
            <div className="flex items-baseline justify-between gap-1">
              <span className="overflow-hidden text-[12px] leading-tight font-bold whitespace-nowrap text-clip">
                {slot.className}
              </span>
              <span className="num shrink-0 font-mono text-[10px] opacity-75">{active.length}</span>
            </div>
          ) : (
            /* 접힘 — 블록이 세로로 여유로우니 시트처럼 반명(줄바꿈 허용) 위 / 강의실 아랫줄.
               한 줄에 욱여넣어 반명이 잘리던 것 해소(2026-07-06 사용자 지적). */
            <div className="text-center">
              <span className="block text-[12px] leading-tight font-bold break-keep">{slot.className}</span>
              {slot.classroomName ? (
                <span className="mt-0.5 block font-mono text-[10px] opacity-75">{slot.classroomName}</span>
              ) : null}
            </div>
          )}
        </button>
      </HoverCard>
      {/* 학생 명단(토글) — 시트 통합 탭의 반별 명단처럼 이름 세로 나열. 블록 잔여 높이를 채우고 넘치면 스크롤. */}
      {open ? (
        <div className="tt-cell-scroll bg-card divide-line/40 min-h-0 flex-1 divide-y overflow-y-auto text-[12px]">
          {active.length === 0 ? (
            <div className="text-text-faint px-1.5 py-0.5">재원생 없음</div>
          ) : (
            active.map((s, i) => {
              const meta = metaLabel(s.school, s.grade);
              const inner = (
                <>
                  {s.name}
                  {meta ? <span className="opacity-60">/{meta}</span> : null}
                </>
              );
              const rowCls =
                "block overflow-hidden whitespace-nowrap text-clip px-1.5 py-[2px] leading-tight text-foreground";
              return s.studentId ? (
                <WindowLink
                  key={s.enrollmentId ?? `s-${i}`}
                  href={`/students/${s.studentId}`}
                  title={s.name}
                  ariaLabel={`${s.name} 학생 정보`}
                  className={`${rowCls} hover:bg-bg-soft`}
                >
                  {inner}
                </WindowLink>
              ) : (
                <div key={s.enrollmentId ?? `s-${i}`} className={rowCls}>
                  {inner}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
