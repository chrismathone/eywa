"use client";

/**
 * 오늘 보드의 **학생 한 줄** — 이름 + 출결 드롭다운 + 교시별 기록 팝오버 + 보고서 상태.
 * today-board.tsx에서 분리(한 파일 200줄 규칙) — 저장 경로·계약은 그대로다(#77: 출결은
 * setAttendanceCell/clearPresentAttendance 두 경로만, 보고서는 원스크린 링크만).
 */
import Link from "next/link";
import { AttendanceSelect, type BasicAttendance } from "./attendance-select";
import { TodayMarkPopover, type MarkMap, type StudentMark } from "./today-mark-popover";
import type { TodayClassCard, TodayStudent } from "../server/today";

export function StudentRow({
  card,
  student,
  date,
  slotLabels,
  marks,
  onMark,
  canEdit,
  att,
  onSet,
  onClear,
}: {
  card: TodayClassCard;
  student: TodayStudent;
  date: string;
  /** 그 반의 그날 교시(시각·라벨) — 학생 기록은 교시별로 저장된다. */
  slotLabels: { slotStart: string; label: string }[];
  marks: MarkMap;
  onMark: (slotStart: string, next: StudentMark | null) => void;
  /** 학생 기록 편집 가능 — 계획 편집과 **같은 게이트**(ecs full|scoped). */
  canEdit: boolean;
  att: { status: string | null; note: string | null };
  onSet: (status: BasicAttendance, note?: string | null) => void;
  onClear: () => void;
}) {
  return (
    // ⚠️ 이름 칸을 `1fr`로 두고 행을 화면 폭에 맡기면 넓은 창에서 이름은 왼쪽 끝, 컨트롤은 오른쪽 끝으로
    // **벌어져** 한 줄을 눈으로 잇기 어렵다(2026-08-07 실화면). 폭은 목록 컨테이너(`max-w`)가 잡고,
    // 행은 그 안을 채운다 — 그래야 밑줄도 컨트롤 있는 데까지만 그어진다.
    <div className="border-line grid grid-cols-[minmax(0,1fr)_5.75rem_auto_auto] items-center gap-2 border-b py-1.5 last:border-b-0">
      <span className="min-w-0 truncate text-[13px]">
        {/* 구조화 행 목록(Editorial 문법 ⑤) — 이름 bold 13.5px + 설명 dim 12.5px. */}
        <span className="text-foreground text-[13.5px] font-bold">{student.name}</span>
        {student.grade ? <span className="text-text-dim ml-1 text-[12.5px]">{student.grade}</span> : null}
      </span>
      <span>
        <AttendanceSelect
          status={att.status}
          note={att.note}
          studentName={student.name}
          canMark={card.canMarkAttendance}
          onSet={onSet}
          onClear={onClear}
        />
      </span>
      {/* 태도·특이사항 — 주간 시트의 두 칸을 **교시별로** 담은 팝오버(행을 넓히지 않으면서 같은 표를 고친다). */}
      <TodayMarkPopover
        classId={card.classId}
        date={date}
        studentId={student.studentId}
        studentName={student.name}
        slots={slotLabels}
        marks={marks}
        canEdit={canEdit}
        onChange={onMark}
      />
      {/* 보고서는 **상태만** 보여주고 작성은 원스크린으로 — 발송 파이프라인(ClassNote)이 그쪽에 있다.
          여기서 다시 만들면 발송 게이트가 두 벌이 된다(#77 "행동을 재촉하는 이벤트는 그 행동의 기존 게이트를").
          배지는 **그 학생 보고서로 가는 링크**다(2026-08-07) — 상태를 보고 바로 손대는 게 자연스럽다. */}
      <Link
        href={`/onescreen?date=${date}&class=${card.classId}&student=${student.studentId}`}
        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap transition hover:opacity-80 ${
          student.reportSent
            ? "bg-primary-soft text-primary"
            : student.reportWritten
              ? "bg-amber-soft text-amber"
              : "bg-bg-soft text-text-dim"
        }`}
        title={
          student.reportSent
            ? `학부모에게 발송됨 — ${student.name} 보고서 열기`
            : student.reportWritten
              ? `작성됨 · 아직 발송 전 — ${student.name} 보고서 열기`
              : `아직 작성 전 — ${student.name} 보고서 쓰기`
        }
      >
        {student.reportSent ? "발송" : student.reportWritten ? "작성" : "미작성"}
      </Link>
    </div>
  );
}
