"use client";

import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { HapbanMemberClass } from "@/features/timetable/lib/hapban";
import { DraggableStudentRow, StudentRow, metaLabel, type StudentQuick } from "./student-rows";

/**
 * 시간표 셀 학생 섹션(재원/대기/퇴원) + 요일 드롭존 — class-cell.tsx에서 추출(200줄 규칙).
 * 합반 통합 명단용 추가: 행 단위 소속 오버라이드(ownClass* — 드래그 fromClassId·Delete 반명·요일편집이
 * 그 학생의 채택 enrollment 기준으로 정확) + label 배지 + DayDropZone memberClassIds(멤버 드롭 재해석).
 */

/** 합반 통합 명단 행의 선택 필드 — buildHapbanRoster(lib/hapban.ts) 출력이 구조적으로 만족. 일반 셀 행엔 없음(폴백). */
export type SectionStudent = StudentQuick & {
  label?: string;
  ownClassId?: string;
  ownClassName?: string;
  ownSlotId?: string;
  ownAttendanceDays?: string[];
  blockingClassIds?: string[];
};

/**
 * 학생 섹션(재원/대기/퇴원) — label 있으면 구분 헤더 + 행들. cap 초과는 '외 N명'.
 * 재원만 편집 모드에서 드래그(반이동), 대기·퇴원은 평범한 행.
 */
export function StudentSection({
  students,
  classId,
  className,
  canDrag,
  cap,
  draggable,
  tone,
  label,
  labelTone,
  slotId,
  coveringDays,
  count,
}: {
  students: SectionStudent[];
  classId: string;
  className: string;
  /** 드래그 가능(편집 권한 + 이번/미래 주) — 옛 `editing`. */
  canDrag: boolean;
  cap: number;
  draggable: boolean;
  tone: (s: { isNew?: boolean; isRecent?: boolean; isTransferredIn?: boolean }) => string;
  label?: string;
  labelTone?: string;
  /** 클릭 시 같은 반 요일 편집 팝오버용(재원 섹션에만 전달). */
  slotId?: string;
  coveringDays?: string[];
  /** 헤더에 표시할 총원 오버라이드 — 합반 재원처럼 리스트(공통)와 총원(공통+분리등원)이 다를 때. */
  count?: number;
}) {
  // count(총원)가 0보다 크면 리스트가 비어도(전원 분리등원 등) 라벨 헤더는 유지.
  if (students.length === 0 && !(label && (count ?? 0) > 0)) return null;
  const visible = students.slice(0, cap);
  const hidden = students.length - visible.length;
  return (
    <>
      {label ? (
        <div
          className={`flex items-center justify-between px-2 py-px text-xs font-bold tracking-wide ${labelTone ?? "text-text-faint"}`}
        >
          <span>{label}</span>
          <span className="num">{count ?? students.length}</span>
        </div>
      ) : null}
      {visible.map((s, i) =>
        draggable && canDrag && s.enrollmentId ? (
          <DraggableStudentRow
            key={s.enrollmentId}
            student={s}
            enrollmentId={s.enrollmentId}
            studentId={s.studentId}
            classId={s.ownClassId ?? classId}
            className={s.ownClassName ?? className}
            name={s.name}
            meta={metaLabel(s.school, s.grade)}
            tone={tone(s)}
            attendanceDays={s.ownAttendanceDays ?? s.attendanceDays}
            slotId={s.ownSlotId ?? slotId}
            coveringDays={coveringDays}
            badge={s.label}
            blockingClassIds={s.blockingClassIds}
          />
        ) : (
          <StudentRow
            key={s.enrollmentId ?? `s-${i}`}
            student={s}
            name={s.name}
            meta={metaLabel(s.school, s.grade)}
            tone={tone(s)}
            badge={s.label}
          />
        ),
      )}
      {hidden > 0 ? (
        <div className="text-text-faint px-2 py-[3px] text-xs">외 {hidden}명</div>
      ) : null}
    </>
  );
}

/**
 * 요일 드롭존 — 편집 모드에서 분리등원 반(월목 등)의 요일 칸을 개별 드롭 대상으로. ijw ClassCard의 "월만/목만" 존.
 * 드롭 시 data.day가 곧 목적지 등원 요일(요일 존=[그 요일], 공통 존=셀 전체=전 요일). id는 셀 slot.id로 유니크.
 * 합반 셀에선 memberClasses(구성 반들)+coveringDays를 실어 — 멤버 드롭=자기 반 요일편집 재해석(resolveDropTarget),
 * 외부 학생 드롭=반+요일 선택 팝업(shouldOpenClassPick, 그 요일 미리 선택).
 */
export function DayDropZone({
  slotId,
  classId,
  className,
  day,
  memberClasses,
  coveringDays,
  children,
}: {
  slotId: string;
  classId: string;
  className: string;
  day: string;
  memberClasses?: HapbanMemberClass[];
  coveringDays?: string[];
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `class:${slotId}:${day}`,
    data: {
      className,
      classId,
      slotId,
      day,
      memberClasses,
      coveringDays,
      hapbanZone: memberClasses ? ("roster" as const) : undefined,
    },
  });
  return (
    <div
      ref={setNodeRef}
      className={`border-line/40 min-w-0 flex-1 [&:not(:first-child)]:border-l ${
        isOver ? "bg-primary-soft/60 ring-primary ring-2 ring-inset" : ""
      }`}
    >
      {children}
    </div>
  );
}
