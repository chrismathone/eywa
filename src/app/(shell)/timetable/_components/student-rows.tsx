"use client";

import { useDraggable } from "@dnd-kit/core";
import { WindowLink } from "@/components/workspace/window-link";
import { formatSchoolGrade } from "@/features/exports/math-timetable/student-format";
import { dayChangeLabel } from "@/features/timetable/lib/split-attendance";
import { useTimetableEdit } from "./edit-context";
import { HoverCard, StudentInfoCard } from "./hover-cards";

/**
 * 시간표 셀 학생 행(단일 셀·합반 공용) — class-cell.tsx에서 추출(200줄 규칙).
 * 합반 통합 명단용 추가: badge(반 인덱스 칩 "1"/"1,2") + blockingClassIds(드래그 data — 소속 반 이동 차단).
 */

/** 셀 학생 1명 — 런타임엔 StudentLine 전체가 도착하므로 hover용 필드(영문명·분리등원)도 포함. */
export type StudentQuick = {
  name: string;
  grade: string | null;
  school: string | null;
  enrollmentId?: string;
  studentId?: string;
  /** active=재원, hold=대기, withdrawn=퇴원. (없으면 active로 간주 — 구버전 호출 호환) */
  status?: "active" | "hold" | "withdrawn";
  endDate?: string | null;
  isNew?: boolean;
  isTransferredIn?: boolean;
  englishName?: string | null;
  attendanceDays?: string[];
  latestTextbook?: { name: string; date: string | null } | null;
  latestReport?: {
    date: string;
    progress: string | null;
    examInfo: string | null;
    homeworkScore: string | null;
    teacherName: string | null;
  } | null;
};

/** 학생 행 메타 — 학교+학년을 ijw식으로 압축("경명중"+"중1" → "경명중1"). 좁은 셀에서 이름 공간 확보. */
export function metaLabel(school: string | null | undefined, grade: string | null | undefined): string {
  const sg = formatSchoolGrade(school, grade, { numberLast: true });
  return sg === "-" ? "" : sg;
}

/** 학생 행 배경 — 전입(초록)·신입(빨강)·그 외(진한 기본). ijw 시간표의 전학/신입 색 근사.
 * ⚠️ 전입을 신입보다 **먼저** 검사 — 반이동은 새 enrollment라 start_date가 최근이라 isNew도 true가 되지만,
 * 다른 반에서 옮겨온 기존 학생이므로 "신입(빨강)"이 아니라 "전입(초록)"으로 표시한다(ijw getEnrollmentStyle 순서 동일).
 * 재원생은 가독성을 위해 text-foreground(진함) — 대기/퇴원과 톤 위계를 둔다. */
export function studentRowTone(s: { isNew?: boolean; isTransferredIn?: boolean }): string {
  if (s.isTransferredIn) return "bg-primary-soft text-primary";
  if (s.isNew) return "bg-danger-soft text-danger";
  return "text-foreground";
}

export const ROW_CLASS =
  "flex items-baseline justify-between gap-1.5 px-2 py-[3px] leading-tight whitespace-nowrap";

/** 합반 인덱스 배지 — 이름 앞 작은 칩("1"/"1,2"). ijw classLabel(bg-gray-500) 대응. */
export function IndexBadge({ badge }: { badge?: string }) {
  if (!badge) return null;
  return (
    <span className="bg-ink/50 mr-0.5 inline-block shrink-0 rounded-[2px] px-0.5 align-middle font-mono text-[9px] leading-tight font-bold text-white">
      {badge}
    </span>
  );
}

/**
 * 학생 한 줄(세로 나열) — 편집 모드에서만 마운트되어 draggable.
 * 이동 예정이면 취소선 + 대상 반 마커. (비편집 시엔 StudentRow가 훅 없이 렌더.)
 */
export function DraggableStudentRow({
  enrollmentId,
  studentId,
  classId,
  className,
  name,
  meta,
  tone,
  dayKey,
  attendanceDays,
  slotId,
  coveringDays,
  badge,
  blockingClassIds,
}: {
  enrollmentId: string;
  /** 학생 id — 편집 모드 Delete=오늘 수강 종료 시 hover 추적에 사용. */
  studentId?: string;
  classId: string;
  className: string;
  name: string;
  meta: string;
  tone: string;
  /** 분리등원 요일 칸이면 요일 — 같은 학생이 여러 요일 칸에 떠도 draggable id를 유니크하게. enrollmentId는 data로 전달. */
  dayKey?: string;
  /** 이 학생의 등원 요일(분리등원, 비면 전 요일) — 도착 셀 '전입 예정' 요일 라벨용으로 drag data에 실어 보냄. */
  attendanceDays?: string[];
  /** 이 셀 slot.id + 덮는 요일 — 클릭 시 같은 반 요일 편집 팝오버(2요일+ 셀에서만). */
  slotId?: string;
  coveringDays?: string[];
  /** 합반 인덱스 배지("1"/"1,2") — 통합 명단에서만. */
  badge?: string;
  /** 열린 수강(active+hold) 소속 반 전부 — resolveDropTarget의 소속 반 이동 차단용(drag data). */
  blockingClassIds?: string[];
}) {
  const { pending, setHovered, openDayEdit } = useTimetableEdit();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dayKey ? `student:${enrollmentId}:${dayKey}` : `student:${enrollmentId}`,
    data: { classId, name, fromClassName: className, enrollmentId, attendanceDays, blockingClassIds },
  });
  const target = pending.get(enrollmentId);
  const moving = !!target && !target.sameClass; // 반 이동=취소선+dim / 같은 반 요일 편집=배지만
  const canEditDays = (coveringDays?.length ?? 0) >= 2 && !!slotId;
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onMouseEnter={() => setHovered({ enrollmentId, studentId: studentId ?? "", name, className })}
      onMouseLeave={() => setHovered(null)}
      onClick={
        canEditDays
          ? () =>
              openDayEdit({
                enrollmentId,
                classId,
                slotId: slotId!,
                name,
                currentDays: attendanceDays ?? [],
                coveringDays: coveringDays!,
              })
          : undefined
      }
      className={`${ROW_CLASS} cursor-grab touch-none select-none active:cursor-grabbing ${tone} ${isDragging ? "opacity-40" : ""} ${moving ? "opacity-60" : ""}`}
    >
      <span className={`overflow-hidden whitespace-nowrap text-clip ${moving ? "line-through" : ""}`}>
        <IndexBadge badge={badge} />
        {name}
        {!target && meta ? <span className="opacity-60">/{meta}</span> : null}
      </span>
      {/* 반 이동=작은 "→", 같은 반 요일 편집=" →목만" 배지(학생이름 우선이라 반이름은 뺌). */}
      {target ? (
        target.sameClass ? (
          <span className="text-primary shrink-0 font-mono text-[10px] font-bold">
            →{dayChangeLabel(target.toDays)}
          </span>
        ) : (
          <span className="text-primary shrink-0 font-mono text-[12px]">→</span>
        )
      ) : null}
    </div>
  );
}

/** 학생 한 줄(비편집) — hover 시 학생 정보 카드, 클릭 시 학생 상세 창(WindowLink). studentId 없으면 평범한 div. */
export function StudentRow({
  student,
  name,
  meta,
  tone,
  badge,
}: {
  student: StudentQuick;
  name: string;
  meta: string;
  tone: string;
  /** 합반 인덱스 배지("1"/"1,2") — 통합 명단에서만. */
  badge?: string;
}) {
  // ijw식: "이름/학교학년"을 한 줄로 — 생략(…) 없이 넘치면 잘림(clip). 이름 우선(좁아도 이름이 먼저 보이고 메타가 잘림).
  const inner = (
    <>
      <IndexBadge badge={badge} />
      {name}
      {meta ? <span className="opacity-60">/{meta}</span> : null}
    </>
  );
  const rowCls = "block overflow-hidden whitespace-nowrap text-clip px-2 py-[3px] leading-tight";
  const trigger = student.studentId ? (
    <WindowLink
      href={`/students/${student.studentId}`}
      title={name}
      ariaLabel={`${name} 학생 정보`}
      className={`${rowCls} hover:bg-bg-soft ${tone}`}
    >
      {inner}
    </WindowLink>
  ) : (
    <div className={`${rowCls} ${tone}`}>{inner}</div>
  );
  return (
    <HoverCard
      width={240}
      card={
        <StudentInfoCard
          name={student.name}
          englishName={student.englishName}
          grade={student.grade}
          school={student.school}
          status={student.status}
          isNew={student.isNew}
          isTransferredIn={student.isTransferredIn}
          attendanceDays={student.attendanceDays}
          endDate={student.endDate}
          textbook={student.latestTextbook}
          report={student.latestReport}
        />
      }
    >
      {trigger}
    </HoverCard>
  );
}
