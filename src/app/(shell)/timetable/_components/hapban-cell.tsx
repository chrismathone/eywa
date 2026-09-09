"use client";

import type { CSSProperties } from "react";
import { useDroppable } from "@dnd-kit/core";
import { WindowLink } from "@/components/workspace/window-link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { buildHapbanRoster, type HapbanMemberClass } from "@/features/timetable/lib/hapban";
import { DAY_LABEL, incomingDayLabel } from "@/features/timetable/lib/split-attendance";
import { readableTextColor } from "@/lib/color-utils";
import {
  HEADER_H,
  HEADER_ROW_H,
  HOLD_MAX_H,
  SubSlotBand,
  WD_MAX_H,
  type ClassDetailQuick,
} from "./class-cell";
import { useTimetableEdit } from "./edit-context";
import { ClassInfoCard, HoverCard } from "./hover-cards";
import { DraggableStudentRow, StudentRow, IndexBadge, metaLabel, ROW_CLASS } from "./student-rows";
import { StudentSection, DayDropZone } from "./student-section";
import { holdTone, useTimetableColorMode, subjectHeaderStyle, timetableStudentTone, withdrawnTone } from "./timetable-color";

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

/** 헤더 세그먼트 1칸 — 자기 반 색 + 인덱스 + 반이름(clip) + 재원수. 드롭=그 반 미리 선택된 반+요일 팝업. */
function SegmentHeader({
  slot,
  index,
  fallbackClass,
  fallbackStyle,
  memberClasses,
  coveringDays,
}: {
  slot: ClassDetailQuick;
  index: number;
  /** 과목색 폴백 className(pastel 모드) — 반 지정색 없을 때. */
  fallbackClass: string;
  /** 과목색 폴백 인라인 스타일(mid/vivid 모드) — 반 지정색 없을 때. */
  fallbackStyle?: CSSProperties;
  memberClasses: HapbanMemberClass[];
  coveringDays: string[];
}) {
  const realClassId = slot.classId ?? slot.id;
  const active = slot.students.filter((s) => (s.status ?? "active") === "active");
  const hold = slot.students.filter((s) => s.status === "hold");
  const withdrawn = slot.students.filter((s) => s.status === "withdrawn");
  // 세그먼트 드롭존 — 기존 카드별 droppable과 동일 id/data 계약(`class:${slot.id}`).
  // hapbanZone="segment" → 외부 학생/멤버의 다른 반 드롭 시 반+요일 팝업(이 반 미리 선택, shouldOpenClassPick).
  const { setNodeRef, isOver } = useDroppable({
    id: `class:${slot.id}`,
    data: {
      className: slot.className,
      classId: realClassId,
      slotId: slot.id,
      memberClasses,
      coveringDays,
      hapbanZone: "segment" as const,
    },
  });
  // 반 지정색(classBgColor) 우선(모드 무관), 없으면 과목색 폴백(모드별 강도).
  const style = slot.classBgColor
    ? { background: slot.classBgColor, color: slot.classTextColor ?? readableTextColor(slot.classBgColor) }
    : fallbackStyle;
  return (
    <div
      ref={setNodeRef}
      className={`border-line/60 min-w-0 flex-1 transition hover:brightness-95 [&:not(:first-child)]:border-l [&:not(:first-child)]:border-dashed ${
        slot.classBgColor ? "" : fallbackClass
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
        {/* 반 정보는 한 번 클릭(class-cell과 같은 규약, 원장 2026-09-09). */}
        <WindowLink
          href={`/classes/${realClassId}`}
          title={slot.className}
          ariaLabel={`${slot.className} 반 정보`}
          className="block w-full px-1.5 py-1 text-left"
        >
          <div className="flex items-baseline gap-1">
            <IndexBadge badge={String(index)} />
            <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-clip text-sm font-bold">
              {slot.className}
            </span>
            <span className="num shrink-0 text-xs opacity-70">{active.length}</span>
          </div>
        </WindowLink>
      </HoverCard>
    </div>
  );
}


export function HapbanCell({
  slots,
  subSlot = "full",
  coveringDays,
  roster = "names",
}: {
  /** mergeSlotsByClass 결과(반별 1개, startTime순) — 순서가 곧 세그먼트 인덱스(1부터). */
  slots: ClassDetailQuick[];
  subSlot?: "top" | "bottom" | "full";
  coveringDays?: string[];
  /** ClassCell과 같은 계약 — `none`이면 명단 구획을 통째로 안 그린다('학생 명단 접기'). */
  roster?: "full" | "names" | "none";
}) {
  const { canDrag, incoming } = useTimetableEdit();
  const subjects = useSubjectMaps();
  const colorMode = useTimetableColorMode();
  const hapbanRoster = buildHapbanRoster(slots);
  // 합반 구성 반 목록(드롭존 data 공용) — 멤버 재해석(resolveDropTarget)·반+요일 팝업 후보(shouldOpenClassPick) 양쪽에 사용.
  const memberClasses: HapbanMemberClass[] = hapbanRoster.segments.map((s) => ({
    classId: s.classId,
    className: s.className,
    slotId: s.slotId,
  }));
  const rep = slots[0]!; // 대표(본문 드롭 데이터·전입예정 기본 키) — 외부 드롭은 팝업이, 멤버 드롭은 재해석이 처리해 안전.
  const repClassId = rep.classId ?? rep.id;

  // 분리등원 — 표시는 displayAttendanceDays(최고 status 요일 합집합) 기준. A월만+B목만 `1,2` 학생은 공통 섹션.
  const covers = coveringDays ?? [];
  const attendsAll = (s: { displayAttendanceDays: string[] }) =>
    s.displayAttendanceDays.length === 0 || covers.every((d) => s.displayAttendanceDays.includes(d));
  const splitByDay = covers.length >= 2 && hapbanRoster.active.some((s) => !attendsAll(s));
  const commonActive = splitByDay ? hapbanRoster.active.filter(attendsAll) : hapbanRoster.active;
  const partialActive = splitByDay ? hapbanRoster.active.filter((s) => !attendsAll(s)) : [];

  // 전입예정 — 전 슬롯의 incoming 병합. slotId 키라 fetch 시점에 대상 세그먼트 인덱스를 안다(배지).
  const incomingAll = slots.flatMap((s, i) => (incoming.get(s.id) ?? []).map((st) => ({ st, seg: i + 1 })));

  // 분리등원 요일 칸 표시 여부 — 2요일+ 셀에서 일부요일 재원이 있거나, 편집 모드(요일 드롭존 상시 노출).
  // 🔴 요일 칸(분리등원 존)은 **드래그 시작에 새로 만들지 않는다** — dnd-kit은 드롭존 집합이 바뀌면 전부
  //    다시 잰다(`droppableRects` lazy memo). 픽업 순간 200개 존이 한꺼번에 생기면 그 재측정이 통째로
  //    한 프레임에 몰려 **집는 순간 멈칫**한다(실측 701ms, 원장 제보 2026-09-04 *"픽업할 때 렉"*).
  //    → 권한이 있으면 **늘 마운트**하고(집합 불변), 보이는 것만 CSS(`body.tt-dragging`)로 켠다.
  const hasSplit = partialActive.length > 0 || (canDrag && covers.length >= 2);
  /**
   * 요일 칸의 머리·안내는 **늘 그려 둔다** — 분리등원 학생이 있으면 평소에도 보이고, 없으면 `hidden`으로 두었다가
   * 끄는 동안만 CSS로 켠다(`body.tt-dragging`). 🔴 상태로 마운트/언마운트하면 **픽업이 멈칫한다**(drag-flag.ts).
   */
  const dayColsAlways = partialActive.length > 0;
  const dayHeadCls = dayColsAlways ? "" : "hidden [.tt-dragging-student_&]:block";
  // 재원·대기·퇴원 모두 스크롤로 전원 노출('외 N명' 숨김이 아니라 박스 스크롤).
  const activeCap = 40 * slots.length; // 합반은 반 수만큼 늘려도 스크롤로 흡수
  const SECTION_CAP = 40;
  const anyHandover = slots.some((s) => s.pendingHandover);
  const totalStudents = slots.reduce((n, s) => n + s.students.length, 0);
  // 'none' = '학생 명단 접기'(뷰 설정) — 명단 구획을 통째로 안 그린다(ClassCell과 같은 계약).
  const showRoster = roster !== "none" && (totalStudents > 0 || incomingAll.length > 0);

  // 본문(통합 명단) 드롭존 — id는 `hapban:`(콜론 2조각: `class:${rep.id}`는 세그먼트1과 중복, 3조각은
  // preferDayZone이 요일존으로 오인). onDragEnd는 data만 읽으므로 계약 무변경.
  // memberClasses=멤버 재해석 + 외부 학생 드롭 시 반+요일 팝업 후보. hapbanZone="roster"(팝업 preset 없음).
  const { setNodeRef: setBodyRef, isOver } = useDroppable({
    id: `hapban:${rep.id}`,
    data: {
      className: rep.className,
      classId: repClassId,
      slotId: rep.id,
      memberClasses,
      coveringDays: covers,
      hapbanZone: "roster" as const,
    },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2px] transition">
      {/* 헤더 존 — 단일 반 셀(ClassCell)과 **같은 고정 높이**. 두 셀이 한 행에 섞여도 명단 시작선이 같아야 한다. */}
      <div className="shrink-0" style={{ height: HEADER_H }}>
      {subSlot === "bottom" ? <SubSlotBand /> : null}
      {/* 헤더 가로 N등분 — 반마다 자기 색·인덱스·재원수. 클릭=그 반 상세 창, 드롭=그 반으로 이동. */}
      <div
        className="flex shrink-0 overflow-hidden"
        style={{ height: subSlot === "full" ? HEADER_H : HEADER_ROW_H }}
      >
        {slots.map((s, i) => {
          const hf = subjectHeaderStyle(colorMode, subjects.colorOf(s.subject));
          return (
            <SegmentHeader
              key={s.id}
              slot={s}
              index={i + 1}
              fallbackClass={hf.className}
              fallbackStyle={hf.style}
              memberClasses={memberClasses}
              coveringDays={covers}
            />
          );
        })}
      </div>
      {subSlot === "top" ? <SubSlotBand /> : null}
      </div>

      {showRoster ? (
        // 컨테이너 자체는 스크롤 안 함(재원·대기·퇴원 박스가 각자). setBodyRef=드롭존은 이 전체 영역.
        <div
          ref={setBodyRef}
          className={`flex min-h-0 flex-1 flex-col text-sm ${
            anyHandover ? "bg-blue-soft" : "bg-card"
          } ${isOver ? "ring-primary ring-2 ring-inset" : ""}`}
        >
          {/* 재원 통합 명단 — 이 영역만 스크롤(스크롤바 숨김 + 위/아래 페이드). flex-1이라 대기/퇴원 있으면
              그만큼 줄어 재원≈10칸. 분리등원·전입예정 포함. 행 단위 own* 바인딩이라 드래그/Delete/요일편집 정확. */}
          <div className="tt-cell-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
            <div className="divide-line/40 shrink-0 divide-y">
              <StudentSection
                students={commonActive}
                classId={repClassId}
                className={rep.className}
                canDrag={canDrag}
                cap={activeCap}
                draggable
                tone={(s) => timetableStudentTone(colorMode, s)}
                slotId={rep.id}
                coveringDays={covers}
                label="재원"
                labelTone="bg-bg-soft/60 text-text-dim"
                count={hapbanRoster.active.length}
              />
            </div>
            {/* 분리등원 요일 칸 — DayDropZone에 memberClassIds(멤버 드롭=자기 반 요일편집). */}
            {hasSplit ? (
              <div className={`shrink-0 ${dayColsAlways ? "border-line/60 border-t border-dashed" : "[.tt-dragging-student_&]:border-line/60 [.tt-dragging-student_&]:border-t [.tt-dragging-student_&]:border-dashed"}`}>
                <div className="flex">
                  {covers.map((day) => {
                      const dayStudents = partialActive.filter((s) => s.displayAttendanceDays.includes(day));
                      const col = (
                        <>
                          <div className={`text-text-faint bg-bg-soft/60 px-1 py-px text-center text-xs font-bold ${dayHeadCls}`}>
                            {DAY_LABEL[day] ?? day}
                          </div>
                          {dayStudents.length > 0 ? (
                            dayStudents.map((s, i) => {
                              // 요일 칸 행은 **그 요일을 실소유한 enrollment**에 바인딩(dayOwners) — 채택 고정이면
                              // A=[월]+B=[수] 학생의 '수' 칸을 끌 때 A가 편집되는 오류. 폴백=채택(own).
                              const owner = s.dayOwners[day];
                              return canDrag && (owner?.enrollmentId ?? s.enrollmentId) ? (
                                <DraggableStudentRow
                                  key={owner?.enrollmentId ?? s.enrollmentId}
                                  student={s}
                                  enrollmentId={(owner?.enrollmentId ?? s.enrollmentId)!}
                                  studentId={s.studentId}
                                  dayKey={day}
                                  classId={owner?.classId ?? s.ownClassId}
                                  className={owner?.className ?? s.ownClassName}
                                  name={s.name}
                                  meta={metaLabel(s.school, s.grade)}
                                  tone={timetableStudentTone(colorMode, s)}
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
                                  tone={timetableStudentTone(colorMode, s)}
                                  badge={s.label}
                                />
                              );
                            })
                          ) : (
                            <div className="text-text-faint hidden min-h-[22px] items-center justify-center text-xs [.tt-dragging-student_&]:flex">
                              여기로
                            </div>
                          )}
                        </>
                      );
                      return canDrag ? (
                        <DayDropZone
                          key={day}
                          slotId={rep.id}
                          classId={repClassId}
                          className={rep.className}
                          day={day}
                          memberClasses={memberClasses}
                          coveringDays={covers}
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
              {/* 전입 예정 — 대상 반 인덱스 배지(어느 반으로 오는지). 재원 스크롤 안. */}
              {incomingAll.length > 0 ? (
                <div className="divide-line/40 border-primary/40 shrink-0 divide-y border-t border-dashed">
                  <div className="bg-primary-soft/50 text-primary flex items-center justify-between px-2 py-px text-xs font-bold tracking-wide">
                    <span>전입 예정</span>
                    <span className="num">{incomingAll.length}</span>
                  </div>
                  {incomingAll.map(({ st, seg }) => {
                    const dayTag = incomingDayLabel(st.attendanceDays, covers);
                    return (
                      <div key={st.enrollmentId} className={`${ROW_CLASS} bg-primary-soft/30 text-primary`}>
                        <span className="inline-flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-clip">
                          <IndexBadge badge={String(seg)} />
                          <EyIcon name="userPlus" size={11} className="shrink-0" aria-hidden="true" />
                          {st.name}
                        </span>
                        {dayTag ? (
                          <span className="text-primary shrink-0 text-xs font-bold">[{dayTag}]</span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
            {/* 대기 — 고정 박스(최대 2칸), 넘으면 이 박스만 스크롤(스크롤바 숨김). 있을 때만 렌더. */}
            {hapbanRoster.hold.length > 0 ? (
              <div
                // 대기 면 색은 모든 뷰 공통(timetable-color 단일 소스) — 원장 2026-09-07 색 견본.
                className="scrollbar-hide divide-line/40 shrink-0 divide-y overflow-y-auto border-t"
                style={{ maxHeight: HOLD_MAX_H }}
              >
                <StudentSection
                  students={hapbanRoster.hold}
                  classId={repClassId}
                  className={rep.className}
                  canDrag={canDrag}
                  cap={SECTION_CAP}
                  draggable={false}
                  tone={() => holdTone(colorMode)}
                  label="대기"
                  labelTone="bg-bg-soft text-text-faint"
                />
              </div>
            ) : null}
            {/* 퇴원 — 고정 박스(최대 3칸), 넘으면 스크롤(스크롤바 숨김). 있을 때만 렌더. */}
            {hapbanRoster.withdrawn.length > 0 ? (
              <div
                className="scrollbar-hide divide-line/40 shrink-0 divide-y overflow-y-auto border-t"
                style={{ maxHeight: WD_MAX_H }}
              >
                <StudentSection
                  students={hapbanRoster.withdrawn}
                  classId={repClassId}
                  className={rep.className}
                  canDrag={canDrag}
                  cap={SECTION_CAP}
                  draggable={false}
                  tone={() => withdrawnTone(colorMode)}
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
