"use client";

import { useDroppable } from "@dnd-kit/core";
import { WindowLink } from "@/components/workspace/window-link";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { SUBJECT_SOFT } from "@/features/owner/subjects";
import { buildHapbanRoster } from "@/features/timetable/lib/hapban";
import { DAY_LABEL, incomingDayLabel } from "@/features/timetable/lib/split-attendance";
import { readableTextColor } from "@/lib/color-utils";
import type { ClassDetailQuick } from "./class-cell";
import { useTimetableEdit } from "./edit-context";
import { ClassInfoCard, HoverCard } from "./hover-cards";
import { DraggableStudentRow, StudentRow, IndexBadge, metaLabel, studentRowTone, ROW_CLASS } from "./student-rows";
import { StudentSection, DayDropZone } from "./student-section";

/**
 * 합반 셀(ijw ClassCard 통합 명단 패턴) — 같은 강사·교시·요일의 2개 반+를 카드 1개로:
 * 헤더 가로 N등분(반마다 자기 색·클릭=반 상세 창·인덱스) + 학생 통합 명단(중복 제거, `1`/`2`/`1,2` 배지)
 * + 통합 대기/퇴원. 반별 카드 적층(옛)은 중복 표시·총원 불명·flex-1 위치 제각각 문제로 폐기.
 *
 * 드롭 의미(lib/hapban.ts resolveDropTarget): 반 이동은 **헤더 세그먼트 드롭만**. 본문/요일존은
 * memberClassIds를 실어 멤버 드롭=자기 반 요일편집으로 재해석(의도치 않은 반이동 사고 방지).
 */

function shortTime(t: string) {
  return t.slice(0, 5);
}

/** 헤더 세그먼트 1칸 — 자기 반 색 + 인덱스 + 반이름(clip) + 재원수. 드롭=그 반으로 이동(명시적). */
function SegmentHeader({ slot, index, colorClass }: { slot: ClassDetailQuick; index: number; colorClass: string }) {
  const realClassId = slot.classId ?? slot.id;
  const active = slot.students.filter((s) => (s.status ?? "active") === "active");
  const hold = slot.students.filter((s) => s.status === "hold");
  const withdrawn = slot.students.filter((s) => s.status === "withdrawn");
  // 세그먼트 드롭존 — 기존 카드별 droppable과 동일 id/data 계약(`class:${slot.id}`) → onDragEnd 무변경.
  // ⚠️ memberClassIds는 싣지 않음(세그먼트=명시적 반 이동 대상 — 본문/요일존만 멤버 재해석).
  const { setNodeRef, isOver } = useDroppable({
    id: `class:${slot.id}`,
    data: { className: slot.className, classId: realClassId, slotId: slot.id },
  });
  const style = slot.classBgColor
    ? { background: slot.classBgColor, color: slot.classTextColor ?? readableTextColor(slot.classBgColor) }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      className={`border-line/60 min-w-0 flex-1 transition hover:brightness-95 [&:not(:first-child)]:border-l [&:not(:first-child)]:border-dashed ${
        slot.classBgColor ? "" : colorClass
      } ${isOver ? "ring-primary ring-2 ring-inset" : ""}`}
      style={style}
    >
      <HoverCard
        width={230}
        card={
          <ClassInfoCard
            className={slot.className}
            subject={slot.subject}
            teacherName={slot.teacherName}
            room={slot.classroomName}
            schedule={`${shortTime(slot.startTime)}~${shortTime(slot.endTime)}`}
            counts={{ active: active.length, hold: hold.length, withdrawn: withdrawn.length }}
            pendingHandover={slot.pendingHandover ?? null}
          />
        }
      >
        <WindowLink
          href={`/classes/${realClassId}`}
          title={slot.className}
          ariaLabel={`${slot.className} 반 정보`}
          className="block w-full px-1.5 py-1 text-left"
        >
          <div className="flex items-baseline gap-1">
            <IndexBadge badge={String(index)} />
            <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-clip text-[13px] font-bold">
              {slot.className}
            </span>
            <span className="num shrink-0 font-mono text-[11px] opacity-70">{active.length}</span>
          </div>
        </WindowLink>
      </HoverCard>
    </div>
  );
}

/** 1-1/1-2 빈 서브슬롯 밴드(ClassCell과 동일 시각). */
function SubSlotBand() {
  return <div className="border-line bg-bg-soft/70 shrink-0 border-b" style={{ height: 26 }} aria-hidden />;
}

export function HapbanCell({
  slots,
  subSlot = "full",
  coveringDays,
}: {
  /** mergeSlotsByClass 결과(반별 1개, startTime순) — 순서가 곧 세그먼트 인덱스(1부터). */
  slots: ClassDetailQuick[];
  subSlot?: "top" | "bottom" | "full";
  coveringDays?: string[];
}) {
  const { editing, incoming } = useTimetableEdit();
  const subjects = useSubjectMaps();
  const roster = buildHapbanRoster(slots);
  const memberClassIds = roster.segments.map((s) => s.classId);
  const rep = slots[0]!; // 대표(본문 드롭 데이터·전입예정 기본 키) — resolveDropTarget이 멤버 드롭을 재해석하므로 안전.
  const repClassId = rep.classId ?? rep.id;

  // 분리등원 — 표시는 displayAttendanceDays(최고 status 요일 합집합) 기준. A월만+B목만 `1,2` 학생은 공통 섹션.
  const covers = coveringDays ?? [];
  const attendsAll = (s: { displayAttendanceDays: string[] }) =>
    s.displayAttendanceDays.length === 0 || covers.every((d) => s.displayAttendanceDays.includes(d));
  const splitByDay = covers.length >= 2 && roster.active.some((s) => !attendsAll(s));
  const commonActive = splitByDay ? roster.active.filter(attendsAll) : roster.active;
  const partialActive = splitByDay ? roster.active.filter((s) => !attendsAll(s)) : [];

  // 전입예정 — 전 슬롯의 incoming 병합. slotId 키라 fetch 시점에 대상 세그먼트 인덱스를 안다(배지).
  const incomingAll = slots.flatMap((s, i) => (incoming.get(s.id) ?? []).map((st) => ({ st, seg: i + 1 })));

  const hasSecondary = roster.hold.length > 0 || roster.withdrawn.length > 0;
  const hasBottom =
    partialActive.length > 0 || incomingAll.length > 0 || hasSecondary || (editing && covers.length >= 2);
  const activeCap = 15 * slots.length; // 옛 카드 적층(카드당 15)의 정보량 유지
  const SECTION_CAP = 6;
  const anyHandover = slots.some((s) => s.pendingHandover);
  const totalStudents = slots.reduce((n, s) => n + s.students.length, 0);
  const showRoster = totalStudents > 0 || incomingAll.length > 0;

  // 본문(통합 명단) 드롭존 — id는 `hapban:`(콜론 2조각: `class:${rep.id}`는 세그먼트1과 중복, 3조각은
  // preferDayZone이 요일존으로 오인). onDragEnd는 data만 읽으므로 계약 무변경. memberClassIds=멤버 재해석.
  const { setNodeRef: setBodyRef, isOver } = useDroppable({
    id: `hapban:${rep.id}`,
    data: { className: rep.className, classId: repClassId, slotId: rep.id, memberClassIds },
  });

  return (
    <div className={`overflow-hidden rounded-[2px] transition ${hasBottom ? "flex min-h-0 flex-1 flex-col" : ""}`}>
      {subSlot === "bottom" ? <SubSlotBand /> : null}
      {/* 헤더 가로 N등분 — 반마다 자기 색·인덱스·재원수. 클릭=그 반 상세 창, 드롭=그 반으로 이동. */}
      <div className="flex shrink-0">
        {slots.map((s, i) => (
          <SegmentHeader key={s.id} slot={s} index={i + 1} colorClass={SUBJECT_SOFT[subjects.colorOf(s.subject)]} />
        ))}
      </div>
      {subSlot === "top" ? <SubSlotBand /> : null}

      {showRoster ? (
        <div
          ref={setBodyRef}
          className={`text-[13px] ${anyHandover ? "bg-blue-soft" : "bg-card"} ${
            hasBottom ? "flex min-h-0 flex-1 flex-col overflow-y-auto" : ""
          } ${isOver ? "ring-primary ring-2 ring-inset" : ""}`}
        >
          {/* 재원 통합 명단(중복 제거 + 인덱스 배지) — 행 단위 own* 바인딩이라 드래그/Delete/요일편집 정확. */}
          <div className="divide-line/40 shrink-0 divide-y">
            <StudentSection
              students={commonActive}
              classId={repClassId}
              className={rep.className}
              editing={editing}
              cap={activeCap}
              draggable
              tone={studentRowTone}
              slotId={rep.id}
              coveringDays={covers}
              label="재원"
              labelTone="bg-bg-soft/60 text-text-dim"
              count={roster.active.length}
            />
          </div>
          {hasBottom ? (
            <div className="mt-auto shrink-0">
              {/* 분리등원 요일 칸 — DayDropZone에 memberClassIds(멤버 드롭=자기 반 요일편집). */}
              {partialActive.length > 0 || (editing && covers.length >= 2) ? (
                <div className="border-line/60 border-t border-dashed">
                  <div className="flex">
                    {covers.map((day) => {
                      const dayStudents = partialActive.filter((s) => s.displayAttendanceDays.includes(day));
                      const col = (
                        <>
                          <div className="text-text-faint bg-bg-soft/60 px-1 py-px text-center text-[9px] font-bold">
                            {DAY_LABEL[day] ?? day}
                          </div>
                          {dayStudents.length > 0 ? (
                            dayStudents.map((s, i) => {
                              // 요일 칸 행은 **그 요일을 실소유한 enrollment**에 바인딩(dayOwners) — 채택 고정이면
                              // A=[월]+B=[수] 학생의 '수' 칸을 끌 때 A가 편집되는 오류. 폴백=채택(own).
                              const owner = s.dayOwners[day];
                              return editing && (owner?.enrollmentId ?? s.enrollmentId) ? (
                                <DraggableStudentRow
                                  key={owner?.enrollmentId ?? s.enrollmentId}
                                  enrollmentId={(owner?.enrollmentId ?? s.enrollmentId)!}
                                  studentId={s.studentId}
                                  dayKey={day}
                                  classId={owner?.classId ?? s.ownClassId}
                                  className={owner?.className ?? s.ownClassName}
                                  name={s.name}
                                  meta={metaLabel(s.school, s.grade)}
                                  tone={studentRowTone(s)}
                                  attendanceDays={owner?.attendanceDays ?? s.ownAttendanceDays}
                                  slotId={owner?.slotId ?? s.ownSlotId}
                                  coveringDays={covers}
                                  badge={s.label}
                                  blockingClassIds={s.blockingClassIds}
                                />
                              ) : (
                                <StudentRow
                                  key={s.enrollmentId ?? `p-${day}-${i}`}
                                  student={s}
                                  name={s.name}
                                  meta={metaLabel(s.school, s.grade)}
                                  tone={studentRowTone(s)}
                                  badge={s.label}
                                />
                              );
                            })
                          ) : editing ? (
                            <div className="text-text-faint/70 flex min-h-[22px] items-center justify-center text-[9px]">
                              여기로
                            </div>
                          ) : (
                            <div className="min-h-[22px]" aria-hidden />
                          )}
                        </>
                      );
                      return editing ? (
                        <DayDropZone
                          key={day}
                          slotId={rep.id}
                          classId={repClassId}
                          className={rep.className}
                          day={day}
                          memberClassIds={memberClassIds}
                        >
                          {col}
                        </DayDropZone>
                      ) : (
                        <div key={day} className="border-line/40 min-w-0 flex-1 [&:not(:first-child)]:border-l">
                          {col}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {/* 전입 예정 — 대상 반 인덱스 배지(어느 반으로 오는지). */}
              {incomingAll.length > 0 ? (
                <div className="divide-line/40 border-primary/40 divide-y border-t border-dashed">
                  <div className="bg-primary-soft/50 text-primary flex items-center justify-between px-2 py-px text-[10px] font-bold tracking-wide">
                    <span>전입 예정</span>
                    <span className="num">{incomingAll.length}</span>
                  </div>
                  {incomingAll.map(({ st, seg }) => {
                    const dayTag = incomingDayLabel(st.attendanceDays, covers);
                    return (
                      <div key={st.enrollmentId} className={`${ROW_CLASS} bg-primary-soft/30 text-primary`}>
                        <span className="overflow-hidden whitespace-nowrap text-clip">
                          <IndexBadge badge={String(seg)} />+ {st.name}
                        </span>
                        {dayTag ? (
                          <span className="text-primary shrink-0 font-mono text-[10px] font-bold">[{dayTag}]</span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
              {/* 대기·퇴원 — 통합(dedup 적용: 학생은 전역 최고 status 섹션에만 등장). */}
              {hasSecondary ? (
                <div className="divide-line/40 divide-y border-t">
                  <StudentSection
                    students={roster.hold}
                    classId={repClassId}
                    className={rep.className}
                    editing={editing}
                    cap={SECTION_CAP}
                    draggable={false}
                    tone={() => "text-text-dim"}
                    label="대기"
                    labelTone="bg-amber-soft/40 text-amber"
                  />
                  <StudentSection
                    students={roster.withdrawn}
                    classId={repClassId}
                    className={rep.className}
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
      ) : null}
    </div>
  );
}
