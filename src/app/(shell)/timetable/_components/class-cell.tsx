"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { WindowLink } from "@/components/workspace/window-link";
import { useTimetableEdit } from "./edit-context";

/**
 * 시간표 셀(ClassCell·IntegratedCell)에 넘기는 반+학생 명단 슬롯.
 * 시간표 page query가 만들어 props로 전달 — 셀은 별도 fetch 없이 즉시 렌더.
 */
export type ClassDetailQuick = {
  id: string;
  /** 실제 반 id(/classes/[id] 링크용). 시간표 slot.id는 스케줄 id라 별도 필요. 없으면 id 폴백. */
  classId?: string;
  className: string;
  subject: string;
  classroomName?: string | null;
  teacherName?: string | null;
  startTime: string;
  endTime: string;
  dayOfWeek: string;
  students: {
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
  }[];
};

// 반이름 헤더 바 색(과목별). 학생 행은 흰 배경 + 상태색이라 헤더만 과목색.
const SUBJECT_COLOR: Record<string, string> = {
  math: "bg-primary-soft text-primary",
  highmath: "bg-primary-soft text-primary",
  english: "bg-blue-soft text-blue",
  korean: "bg-rose-soft text-rose",
  science: "bg-purple-soft text-purple",
  arts: "bg-amber-soft text-amber",
};

function shortTime(t: string) {
  return t.slice(0, 5);
}

/** 학생 행 우측 메타 — 학교 + 학년(있는 것만). ijw식 [이름] … [학교 학년]. */
function metaLabel(school: string | null | undefined, grade: string | null | undefined): string {
  return [school, grade].filter(Boolean).join(" ");
}

/** 학생 행 배경 — 신입(빨강)·전입(초록)·그 외(진한 기본). ijw 시간표의 신입/전학 색 근사.
 * 재원생은 가독성을 위해 text-foreground(진함) — 대기/퇴원과 톤 위계를 둔다. */
function studentRowTone(s: { isNew?: boolean; isTransferredIn?: boolean }): string {
  if (s.isNew) return "bg-danger-soft text-danger";
  if (s.isTransferredIn) return "bg-primary-soft text-primary";
  return "text-foreground";
}

const ROW_CLASS =
  "flex items-baseline justify-between gap-1.5 px-2 py-[3px] leading-tight whitespace-nowrap";

/**
 * 학생 한 줄(세로 나열) — 편집 모드에서만 마운트되어 draggable.
 * 이동 예정이면 취소선 + 대상 반 마커. (비편집 시엔 StudentRow가 훅 없이 렌더.)
 */
function DraggableStudentRow({
  enrollmentId,
  classId,
  name,
  meta,
  tone,
}: {
  enrollmentId: string;
  classId: string;
  name: string;
  meta: string;
  tone: string;
}) {
  const { pending } = useTimetableEdit();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `student:${enrollmentId}`,
    data: { classId, name },
  });
  const target = pending.get(enrollmentId);
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`${ROW_CLASS} cursor-grab active:cursor-grabbing ${tone} ${isDragging ? "opacity-40" : ""} ${target ? "opacity-60" : ""}`}
    >
      <span className={`truncate ${target ? "line-through" : ""}`}>{name}</span>
      {target ? (
        <span className="text-primary shrink-0 font-mono text-[12px]">→{target.toClassName}</span>
      ) : meta ? (
        <span className="shrink-0 font-mono text-[12px] opacity-70">{meta}</span>
      ) : null}
    </div>
  );
}

/** 학생 한 줄(비편집) — 클릭 시 학생 상세 창 팝업(WindowLink). studentId 없으면 평범한 div. */
function StudentRow({
  studentId,
  name,
  meta,
  tone,
}: {
  studentId?: string;
  name: string;
  meta: string;
  tone: string;
}) {
  const inner = (
    <>
      <span className="truncate">{name}</span>
      {meta ? <span className="shrink-0 font-mono text-[12px] opacity-70">{meta}</span> : null}
    </>
  );
  if (studentId) {
    return (
      <WindowLink
        href={`/students/${studentId}`}
        title={name}
        ariaLabel={`${name} 학생 정보`}
        className={`${ROW_CLASS} hover:bg-bg-soft ${tone}`}
      >
        {inner}
      </WindowLink>
    );
  }
  return <div className={`${ROW_CLASS} ${tone}`}>{inner}</div>;
}

/**
 * 학생 섹션(재원/대기/퇴원) — label 있으면 구분 헤더 + 행들. cap 초과는 '외 N명'.
 * 재원만 편집 모드에서 드래그(반이동), 대기·퇴원은 평범한 행.
 */
function StudentSection({
  students,
  classId,
  editing,
  cap,
  draggable,
  tone,
  label,
  labelTone,
}: {
  students: ClassDetailQuick["students"];
  classId: string;
  editing: boolean;
  cap: number;
  draggable: boolean;
  tone: (s: { isNew?: boolean; isTransferredIn?: boolean }) => string;
  label?: string;
  labelTone?: string;
}) {
  if (students.length === 0) return null;
  const visible = students.slice(0, cap);
  const hidden = students.length - visible.length;
  return (
    <>
      {label ? (
        <div
          className={`flex items-center justify-between px-2 py-px text-[10px] font-bold tracking-wide ${labelTone ?? "text-text-faint"}`}
        >
          <span>{label}</span>
          <span className="num">{students.length}</span>
        </div>
      ) : null}
      {visible.map((s, i) =>
        draggable && editing && s.enrollmentId ? (
          <DraggableStudentRow
            key={s.enrollmentId}
            enrollmentId={s.enrollmentId}
            classId={classId}
            name={s.name}
            meta={metaLabel(s.school, s.grade)}
            tone={tone(s)}
          />
        ) : (
          <StudentRow
            key={s.enrollmentId ?? `s-${i}`}
            studentId={s.studentId}
            name={s.name}
            meta={metaLabel(s.school, s.grade)}
            tone={tone(s)}
          />
        ),
      )}
      {hidden > 0 ? (
        <div className="text-text-faint px-2 py-[3px] text-[12px]">외 {hidden}명</div>
      ) : null}
    </>
  );
}

/**
 * 시간표 셀 — 반이름 헤더 바 + 그 아래 학생 세로 나열(엑셀식 칸 안 행). ijw 시간표 패턴.
 * 헤더 클릭 → 반 정보 창 팝업(/classes/[id]), 학생 행 클릭 → 학생 정보 창 팝업(/students/[id]).
 * 편집 모드면 학생 행 드래그로 반 이동(클릭 팝업 대신).
 */
export function ClassCell({
  slot,
  roster = "full",
}: {
  slot: ClassDetailQuick;
  /** 셀 안 명단 표시: full=캡8(통합뷰), names=캡15(기본뷰 — 전체 가까이), none=숨김. */
  roster?: "full" | "names" | "none";
}) {
  const { editing } = useTimetableEdit();
  const color = SUBJECT_COLOR[slot.subject] ?? "bg-bg-soft text-text-dim";

  // 재원/대기/퇴원 분리 — ijw 셀처럼 섹션별 표시. status 없으면(구버전) 재원으로 간주.
  const active = slot.students.filter((s) => (s.status ?? "active") === "active");
  const hold = slot.students.filter((s) => s.status === "hold");
  const withdrawn = slot.students.filter((s) => s.status === "withdrawn");
  const activeCap = roster === "names" ? 15 : 8;
  const SECTION_CAP = 6;
  const showRoster = roster !== "none" && slot.students.length > 0;
  // 대기·퇴원이 있으면 셀 높이를 채워 그 그룹을 셀 하단에 정렬(재원 바로 아래가 아니라). 고정높이
  // flex 컨테이너(weekday-group) 안에서만 fill 효과 — 통합뷰(블록 부모)에선 flex-1이 무시돼 기존대로.
  const hasSecondary = hold.length > 0 || withdrawn.length > 0;

  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `class:${slot.id}`,
    data: { className: slot.className },
  });

  return (
    <div
      ref={setDroppableRef}
      className={`border-line overflow-hidden rounded-[3px] border transition ${
        hasSecondary ? "flex min-h-0 flex-1 flex-col" : ""
      } ${isOver ? "ring-primary ring-2" : ""}`}
    >
        {/* 반이름 헤더 바 — 클릭 시 반 정보 창 팝업(/classes/[classId]) */}
        <WindowLink
          href={`/classes/${slot.classId ?? slot.id}`}
          title={slot.className}
          ariaLabel={`${slot.className} 반 정보`}
          className={`block w-full shrink-0 px-2 py-1 text-left transition hover:brightness-95 ${color}`}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[14px] font-bold">{slot.className}</span>
            <span className="num shrink-0 font-mono text-[12px] opacity-70">{active.length}</span>
          </div>
          <div className="flex items-center justify-between gap-1 text-[12px] opacity-75">
            <span className="num font-mono">
              {shortTime(slot.startTime)}~{shortTime(slot.endTime)}
            </span>
            {slot.classroomName ? <span className="truncate font-mono">{slot.classroomName}</span> : null}
          </div>
        </WindowLink>

        {/* 학생 세로 나열 — 재원(상단)과 대기·퇴원(셀 하단 mt-auto) 분리. 신입=빨강·전입=초록·퇴원=취소선. */}
        {showRoster ? (
          <div
            className={`bg-card text-[13px] ${
              hasSecondary ? "flex min-h-0 flex-1 flex-col overflow-y-auto" : ""
            }`}
          >
            {/* 재원 — 상단 */}
            <div className="divide-line/40 shrink-0 divide-y">
              <StudentSection
                students={active}
                classId={slot.id}
                editing={editing}
                cap={activeCap}
                draggable
                tone={studentRowTone}
              />
            </div>
            {/* 대기·퇴원 — 셀 하단 정렬 */}
            {hasSecondary ? (
              <div className="divide-line/40 mt-auto shrink-0 divide-y border-t">
                <StudentSection
                  students={hold}
                  classId={slot.id}
                  editing={editing}
                  cap={SECTION_CAP}
                  draggable={false}
                  tone={() => "text-text-dim"}
                  label="대기"
                  labelTone="bg-amber-soft/40 text-amber"
                />
                <StudentSection
                  students={withdrawn}
                  classId={slot.id}
                  editing={editing}
                  cap={SECTION_CAP}
                  draggable={false}
                  tone={() => "text-text-faint line-through"}
                  label="퇴원"
                  labelTone="bg-bg-soft text-text-faint"
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
  );
}
