"use client";

import {
  cloneElement,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Pill } from "@/components/atoms/pill";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { formatSchoolGrade } from "@/features/exports/math-timetable/student-format";
import { splitNumberedItems } from "@/lib/text/split-numbered";
import { DAY_LABEL } from "@/features/timetable/lib/split-attendance";

/**
 * hover 카드 최대 높이 — 위치 클램프와 카드 max-height가 **같은 값**을 써야 화면 밖으로 안 나간다.
 * (옛 코드는 높이를 210px로 추정해 클램프만 했고, 진도·교재·상태가 다 붙은 카드는 300px를 넘어 잘렸다.)
 */
const HOVER_MAX_H = 320;

/**
 * 시간표 hover 정보 카드 — 커서 위치 기준 포털(고정·z최상위·pointer-events-none).
 * overflow 컨테이너(셀·DragScrollArea)에 안 잘리도록 document.body로 portal(ijw 패턴).
 * children(트리거)에 cloneElement로 hover 핸들러를 주입 — 추가 DOM 노드 없음.
 * (WindowLink는 onMouseEnter/Leave를 forward하도록 확장됨, div는 네이티브 지원.)
 */
export function HoverCard({
  card,
  width = 230,
  children,
}: {
  card: ReactNode;
  width?: number;
  children: ReactElement;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  function show(e: ReactMouseEvent) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = e.clientX + 16;
    if (x + width > vw - 8) x = e.clientX - width - 16;
    if (x < 8) x = 8;
    let y = e.clientY + 16;
    // ⚠️ 옛 코드는 카드 높이를 210/230px로 **고정 추정**해 클램프했는데, 진도(line-clamp-5)+교재+상태가
    // 다 붙은 학생 카드는 300px를 넘어 창(기본 680px) 아래로 잘렸다. 실측 대신 카드에 max-height를
    // 걸고(내부 스크롤) **같은 상수**로 클램프해 항상 화면 안에 들어오게 한다(적대 감사 UX).
    if (y + HOVER_MAX_H > vh - 8) y = Math.max(8, vh - 8 - HOVER_MAX_H);
    setPos({ x, y });
  }
  const hide = () => setPos(null);

  const trigger = cloneElement(
    children as unknown as ReactElement<{
      onMouseEnter?: (e: ReactMouseEvent) => void;
      onMouseLeave?: () => void;
    }>,
    { onMouseEnter: show, onMouseLeave: hide },
  );

  return (
    <>
      {trigger}
      {pos
        ? createPortal(
            <div
              className="border-line bg-card shadow-modal pointer-events-none fixed z-[9999] overflow-y-auto rounded-lg border p-3"
              style={{ left: pos.x, top: pos.y, width, maxHeight: HOVER_MAX_H }}
            >
              {card}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-text-dim shrink-0">{label}</span>
      <span className={`text-foreground text-right ${mono ? "num" : ""}`}>{value}</span>
    </div>
  );
}

/** 수업 hover — 수업명·과목·담임·강의실·시간·인원(+교재, Phase 3). */
export function ClassInfoCard({
  className,
  subject,
  teacherName,
  room,
  schedule,
  textbook,
  counts,
  pendingHandover,
}: {
  className: string;
  subject: string;
  teacherName?: string | null;
  room?: string | null;
  schedule?: string | null;
  textbook?: string | null;
  counts: { active: number; hold: number; withdrawn: number };
  pendingHandover?: { teacherName: string | null; date: string | null } | null;
}) {
  const subjects = useSubjectMaps();
  return (
    <div className="space-y-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-foreground text-[13px] font-bold">{className}</span>
        <Pill color={subjects.colorOf(subject)}>{subjects.labelOf(subject)}</Pill>
      </div>
      {pendingHandover ? (
        <div className="bg-blue-soft text-blue rounded px-1.5 py-1 text-[10px] font-bold">
          강사 인수인계 예정
          {pendingHandover.teacherName ? ` → ${pendingHandover.teacherName}` : ""}
          {pendingHandover.date ? ` (${pendingHandover.date})` : ""}
        </div>
      ) : null}
      <div className="space-y-1">
        <Row label="담임" value={teacherName ?? "—"} />
        <Row label="강의실" value={room ?? "—"} />
        {schedule ? <Row label="시간" value={schedule} mono /> : null}
        {textbook ? <Row label="교재" value={textbook} /> : null}
      </div>
      <div className="border-line flex flex-wrap items-center gap-x-2.5 border-t pt-1.5 num text-[10px]">
        <span className="text-primary">재원 {counts.active}</span>
        {counts.hold > 0 ? <span className="text-amber">대기 {counts.hold}</span> : null}
        {counts.withdrawn > 0 ? <span className="text-text-faint">퇴원 {counts.withdrawn}</span> : null}
      </div>
    </div>
  );
}

/** 학생 hover — 이름(영문)·상태·학년/학교·신입/전입·분리등원·퇴원일(+반이동 예정, Phase 2). */
export function StudentInfoCard({
  name,
  englishName,
  grade,
  school,
  status,
  isNew,
  isTransferredIn,
  enrollmentDate,
  attendanceDays,
  endDate,
  textbook,
  report,
  pendingClassName,
  pendingTransferDate,
}: {
  name: string;
  englishName?: string | null;
  grade?: string | null;
  school?: string | null;
  status?: "active" | "hold" | "withdrawn";
  isNew?: boolean;
  isTransferredIn?: boolean;
  /** 수강 시작일(YYYY-MM-DD) — 신입=신입 시작일, 전입=전입일로 라벨 옆에 표시(라벨 없으면 미표시). */
  enrollmentDate?: string | null;
  attendanceDays?: string[];
  endDate?: string | null;
  textbook?: { name: string; date: string | null } | null;
  report?: {
    date: string;
    progress: string | null;
    examInfo: string | null;
    homeworkScore: string | null;
    teacherName: string | null;
  } | null;
  pendingClassName?: string | null;
  pendingTransferDate?: string | null;
}) {
  const partial =
    attendanceDays && attendanceDays.length > 0
      ? attendanceDays.map((d) => DAY_LABEL[d] ?? d).join("·") + "만 등원"
      : null;
  const hasDetail =
    isNew || isTransferredIn || partial || (status === "withdrawn" && endDate) || pendingClassName;
  return (
    <div className="space-y-2 break-keep text-[11px]">
      {/* 헤더 한 줄: 이름(좌) + 학년·학교(우상단). 별도 줄을 없애 세로 공간 절약. */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="text-foreground text-[13px] font-bold">{name}</span>
          {englishName ? <span className="text-text-dim">({englishName})</span> : null}
          {status === "withdrawn" ? (
            <Pill color="neutral">퇴원</Pill>
          ) : status === "hold" ? (
            <Pill color="amber">대기</Pill>
          ) : null}
        </div>
        {(() => {
          // 학교+학년을 ijw식 압축("달산초"+"초6"→"달산초6") — 셀 학생행과 동일 라벨.
          const sg = formatSchoolGrade(school, grade, { numberLast: true });
          return sg && sg !== "-" ? (
            <span className="text-text-dim shrink-0 text-right text-[10px] leading-tight">{sg}</span>
          ) : null;
        })()}
      </div>
      {hasDetail ? (
        <div className="border-line space-y-1 border-t pt-1.5">
          {/* 신입·전입 상호배타 — 반이동 학생은 전입만(전입 우선). 데이터 계층에서 이미 배타지만 표시도 방어적으로.
              날짜(enrollmentDate=수강 시작일)를 라벨 옆에 표기: 신입=신입 시작일, 전입=전입일. 라벨과 같은 블록이라
              신입/전입 창(30일)이 지나 라벨이 사라지면 날짜도 함께 사라진다. */}
          {isTransferredIn ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill color="primary">전입</Pill>
              {enrollmentDate ? (
                <span className="text-text-dim num text-[10px]">{enrollmentDate}</span>
              ) : null}
            </div>
          ) : isNew ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill color="danger">신입</Pill>
              {enrollmentDate ? (
                <span className="text-text-dim num text-[10px]">{enrollmentDate}</span>
              ) : null}
            </div>
          ) : null}
          {partial ? <Row label="등원" value={partial} /> : null}
          {pendingClassName ? (
            <Row
              label="이동 예정"
              value={`${pendingClassName}${pendingTransferDate ? ` (${pendingTransferDate})` : ""}`}
            />
          ) : null}
          {status === "withdrawn" && endDate ? <Row label="퇴원일" value={endDate} mono /> : null}
        </div>
      ) : null}
      {textbook ? (
        <p className="border-line border-t pt-1.5">
          <span className="text-text-dim">교재 </span>
          <span className="text-foreground">{textbook.name}</span>
        </p>
      ) : null}
      {report?.progress ? (
        <div className="border-line space-y-0.5 border-t pt-1.5">
          <div className="text-text-dim flex flex-wrap items-center gap-1.5">
            <span className="text-primary font-bold">진도</span>
            <span className="num">{report.date}</span>
            {report.teacherName ? <span>· {report.teacherName}</span> : null}
          </div>
          {/* 진도 스마트 줄바꿈 — "1.극한 2.연속" 인라인 번호 run-on을 항목별 줄로(오탐 시 원문 1줄).
              whitespace-pre-line이라 원문 \n도 살고, line-clamp가 물리 줄 기준으로 과대 성장 방지. */}
          <p className="text-foreground line-clamp-5 whitespace-pre-line">
            {splitNumberedItems(report.progress).join("\n")}
          </p>
          {report.examInfo || report.homeworkScore ? (
            <div className="text-text-dim flex flex-wrap gap-x-2.5 num text-[10px]">
              {report.examInfo ? <span>시험 {report.examInfo}</span> : null}
              {report.homeworkScore ? <span>숙제 {report.homeworkScore}</span> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
