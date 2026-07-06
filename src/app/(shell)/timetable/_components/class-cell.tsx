"use client";

import { useDroppable } from "@dnd-kit/core";
import { WindowLink } from "@/components/workspace/window-link";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { SUBJECT_SOFT } from "@/features/owner/subjects";
import { DAY_LABEL, incomingDayLabel } from "@/features/timetable/lib/split-attendance";
import { readableTextColor } from "@/lib/color-utils";
import { useTimetableEdit } from "./edit-context";
import { ClassInfoCard, HoverCard } from "./hover-cards";
import { DraggableStudentRow, StudentRow, metaLabel, studentRowTone, ROW_CLASS, type StudentQuick } from "./student-rows";
import { StudentSection, DayDropZone } from "./student-section";

/**
 * 시간표 셀(ClassCell·IntegratedCell)에 넘기는 반+학생 명단 슬롯.
 * 시간표 page query가 만들어 props로 전달 — 셀은 별도 fetch 없이 즉시 렌더.
 * (학생 행·섹션 컴포넌트는 student-rows.tsx/student-section.tsx로 추출 — 합반 통합 명단(hapban-cell)과 공유.)
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
  /** 반 색(ijw bg_color) — 있으면 헤더 배경. 없으면 과목색 폴백. (ScheduleSlotWithStudents가 런타임에 채움.) */
  classBgColor?: string | null;
  classTextColor?: string | null;
  /** 강사 인수인계 예약(0044a) — 있으면 명단 영역 배경 틴트 + hover 상세. null=예약 없음. */
  pendingHandover?: { teacherName: string | null; date: string | null } | null;
  students: StudentQuick[];
};

export type { StudentQuick };

function shortTime(t: string) {
  return t.slice(0, 5);
}

/**
 * 시간표 셀 — 반이름 헤더 바 + 그 아래 학생 세로 나열(엑셀식 칸 안 행). ijw 시간표 패턴.
 * 헤더 클릭 → 반 정보 창 팝업(/classes/[id]), 학생 행 클릭 → 학생 정보 창 팝업(/students/[id]).
 * 편집 모드면 학생 행 드래그로 반 이동(클릭 팝업 대신) — 요일 칸에 드롭하면 그 요일만 등원(분리등원).
 */
export function ClassCell({
  slot,
  roster = "full",
  subSlot = "full",
  coveringDays,
}: {
  slot: ClassDetailQuick;
  /** 셀 안 명단 표시: full=캡8(통합뷰), names=캡15(기본뷰 — 전체 가까이), none=숨김. */
  roster?: "full" | "names" | "none";
  /**
   * 기본뷰 평일 그룹 셀의 서브슬롯 위치(ijw식 헤더 분할) — top=1-1만, bottom=1-2만, full=둘 다(또는 분할 무관).
   * top/bottom이면 반대 서브슬롯 자리에 **빈 밴드**를 그려 1-1/1-2를 한눈에 구분(학생 영역은 풀 유지).
   */
  subSlot?: "top" | "bottom" | "full";
  /** 이 셀(병합 블록)이 덮는 요일. 2일+이고 일부 요일만 오는 재원생이 있으면 요일 칸으로 분할(분리등원, ijw식). 기본뷰만 전달. */
  coveringDays?: string[];
}) {
  const { editing, incoming } = useTimetableEdit();
  const subjects = useSubjectMaps();
  // 과목 헤더 색은 학원설정(operations.subjects) 단일 소스 — 하드코딩 금지.
  const color = SUBJECT_SOFT[subjects.colorOf(slot.subject)];
  // 반 색(bg_color) 우선 — 통합뷰와 동일하게 헤더에 반영. 없으면 과목색 클래스 폴백.
  // (WindowLink는 style 미지원이라 래퍼 div에 인라인 색.)
  const headerStyle = slot.classBgColor
    ? { background: slot.classBgColor, color: slot.classTextColor ?? readableTextColor(slot.classBgColor) }
    : undefined;
  // 강사 인수인계 예약된 반 — 명단 영역에 은은한 blue 틴트(합반 앰버·전입 초록·신입 빨강과 구분). 상세는 hover 카드.
  const handover = slot.pendingHandover ?? null;

  // 재원/대기/퇴원 분리 — ijw 셀처럼 섹션별 표시. status 없으면(구버전) 재원으로 간주.
  const active = slot.students.filter((s) => (s.status ?? "active") === "active");
  // 분리등원 — 이 셀이 덮는 요일(coveringDays)이 2일+이고 '일부 요일만 오는' 재원생이 있으면 요일 칸으로 분할.
  // attendance_days가 비면(=전 요일) 전원 '공통'이라 분할 UI가 아예 안 뜬다(분리등원 없는 반은 화면 무변경, ijw ClassCard 방식).
  const covers = coveringDays ?? [];
  const attendsAllCovered = (s: StudentQuick) => {
    const ad = s.attendanceDays ?? [];
    return ad.length === 0 || covers.every((d) => ad.includes(d));
  };
  const splitByDay = covers.length >= 2 && active.some((s) => !attendsAllCovered(s));
  const commonActive = splitByDay ? active.filter(attendsAllCovered) : active;
  const partialActive = splitByDay ? active.filter((s) => !attendsAllCovered(s)) : [];
  const hold = slot.students.filter((s) => s.status === "hold");
  const withdrawn = slot.students.filter((s) => s.status === "withdrawn");
  const activeCap = roster === "names" ? 15 : 8;
  const SECTION_CAP = 6;
  // 이 셀로 전입 예정인 학생(편집 모드에서 다른 반에서 끌어온 학생) — 도착 셀에 초록 미리보기로 표시.
  const incomingHere = incoming.get(slot.id) ?? [];
  const showRoster = roster !== "none" && (slot.students.length > 0 || incomingHere.length > 0);
  // 대기·퇴원이 있으면 셀 높이를 채워 그 그룹을 셀 하단에 정렬(재원 바로 아래가 아니라). 고정높이
  // flex 컨테이너(weekday-group) 안에서만 fill 효과 — 통합뷰(블록 부모)에선 flex-1이 무시돼 기존대로.
  const hasSecondary = hold.length > 0 || withdrawn.length > 0;
  // 하단 그룹(분리등원 월목 → 전입예정 → 대기 → 퇴원)이 있으면 셀을 flex로 채워 그 그룹을 바닥 정렬.
  // 공통(전 요일 등원)은 상단, 분리등원·대기·퇴원은 아래로(ijw ClassCard: 공통 위 / 요일·상태 아래).
  // 편집 모드의 다요일 셀(covers≥2)은 요일 드롭존을 항상 노출(분리등원 지정 가능) → 하단 그룹 상시.
  const hasBottom =
    partialActive.length > 0 || incomingHere.length > 0 || hasSecondary || (editing && covers.length >= 2);

  // ⚠️ 이동 목적지 반은 slot.id(스케줄 id)가 아니라 slot.classId(실제 반 id) — 드롭 data로 전달(과거 onDragEnd가
  // slot.id를 반 id로 넘겨 RPC FK 실패하던 버그 수정). id는 셀 유니크(slot.id) 유지, slotId는 마커 키.
  const realClassId = slot.classId ?? slot.id;
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `class:${slot.id}`,
    data: { className: slot.className, classId: realClassId, slotId: slot.id },
  });

  return (
    <div
      ref={setDroppableRef}
      className={`overflow-hidden rounded-[2px] transition ${
        hasBottom ? "flex min-h-0 flex-1 flex-col" : ""
      } ${isOver ? "ring-primary ring-2" : ""}`}
    >
        {/* ijw식 헤더 분할 — 1-2 수업이면 위에 빈 1-1 밴드를 둬 "이건 2번째 칸 수업"임을 한눈에. 학생 영역은 풀 유지. */}
        {subSlot === "bottom" ? (
          <div className="border-line bg-bg-soft/70 shrink-0 border-b" style={{ height: 26 }} aria-hidden />
        ) : null}
        {/* 반이름 헤더 바 — 반 색 우선(인라인), 없으면 과목색 클래스. WindowLink는 style 미지원이라 래퍼 div에 색.
            hover 시 수업 정보 카드, 클릭 시 반 정보 창 팝업(/classes/[classId]). */}
        <div
          className={`shrink-0 transition hover:brightness-95 ${slot.classBgColor ? "" : color}`}
          style={headerStyle}
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
                pendingHandover={handover}
              />
            }
          >
            <WindowLink
              href={`/classes/${slot.classId ?? slot.id}`}
              title={slot.className}
              ariaLabel={`${slot.className} 반 정보`}
              className="block w-full px-2 py-1 text-left"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="overflow-hidden whitespace-nowrap text-clip text-[14px] font-bold">{slot.className}</span>
                <span className="num shrink-0 font-mono text-[12px] opacity-70">{active.length}</span>
              </div>
              {/* 시각은 hover 카드에 나오므로 셀에선 생략(사용자 요청). 강의실만 표시. */}
              {slot.classroomName ? (
                <div className="flex items-center justify-end gap-1 text-[12px] opacity-75">
                  <span className="overflow-hidden whitespace-nowrap text-clip font-mono">{slot.classroomName}</span>
                </div>
              ) : null}
            </WindowLink>
          </HoverCard>
        </div>
        {/* 1-1 수업이면 헤더 아래 빈 1-2 밴드 — "이건 첫째 칸 수업"임을 표시. */}
        {subSlot === "top" ? (
          <div className="border-line bg-bg-soft/70 shrink-0 border-b" style={{ height: 26 }} aria-hidden />
        ) : null}

        {/* 학생 세로 나열 — 재원(상단)과 대기·퇴원(셀 하단 mt-auto) 분리. 신입=빨강·전입=초록·퇴원=취소선. */}
        {showRoster ? (
          <div
            className={`text-[13px] ${handover ? "bg-blue-soft" : "bg-card"} ${
              hasBottom ? "flex min-h-0 flex-1 flex-col overflow-y-auto" : ""
            }`}
          >
            {/* 재원 공통(덮는 요일 전부 등원) — 상단 정렬. 분리등원 없으면 재원 전원이 여기. */}
            <div className="divide-line/40 shrink-0 divide-y">
              <StudentSection
                students={commonActive}
                classId={realClassId}
                className={slot.className}
                editing={editing}
                cap={activeCap}
                draggable
                tone={studentRowTone}
                slotId={slot.id}
                coveringDays={covers}
              />
            </div>
            {/* 하단 그룹 — 분리등원(월/목) → 전입예정 → 대기 → 퇴원 순으로 셀 하단에 붙임(mt-auto). */}
            {hasBottom ? (
              <div className="mt-auto shrink-0">
                {/* 분리등원 요일 칸 — 편집 모드의 다요일 셀엔 요일 드롭존을 항상(요일별 등원 지정), 아니면 분리 학생 있을 때만. */}
                {partialActive.length > 0 || (editing && covers.length >= 2) ? (
                  <div className="border-line/60 border-t border-dashed">
                    <div className="flex">
                      {covers.map((day) => {
                        const dayStudents = partialActive.filter((s) => (s.attendanceDays ?? []).includes(day));
                        const col = (
                          <>
                            <div className="text-text-faint bg-bg-soft/60 px-1 py-px text-center text-[9px] font-bold">
                              {DAY_LABEL[day] ?? day}
                            </div>
                            {dayStudents.length > 0 ? (
                              dayStudents.map((s, i) =>
                                editing && s.enrollmentId ? (
                                  <DraggableStudentRow
                                    key={s.enrollmentId}
                                    enrollmentId={s.enrollmentId}
                                    studentId={s.studentId}
                                    dayKey={day}
                                    classId={realClassId}
                                    className={slot.className}
                                    name={s.name}
                                    meta={metaLabel(s.school, s.grade)}
                                    tone={studentRowTone(s)}
                                    attendanceDays={s.attendanceDays}
                                    slotId={slot.id}
                                    coveringDays={covers}
                                  />
                                ) : (
                                  <StudentRow
                                    key={s.enrollmentId ?? `p-${day}-${i}`}
                                    student={s}
                                    name={s.name}
                                    meta={metaLabel(s.school, s.grade)}
                                    tone={studentRowTone(s)}
                                  />
                                ),
                              )
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
                            slotId={slot.id}
                            classId={realClassId}
                            className={slot.className}
                            day={day}
                          >
                            {col}
                          </DayDropZone>
                        ) : (
                          <div
                            key={day}
                            className="border-line/40 min-w-0 flex-1 [&:not(:first-child)]:border-l"
                          >
                            {col}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {/* 전입 예정(편집 모드) — 다른 반에서 끌어온 학생을 도착 셀에 초록 미리보기로. */}
                {incomingHere.length > 0 ? (
                  <div className="divide-line/40 border-primary/40 divide-y border-t border-dashed">
                    <div className="bg-primary-soft/50 text-primary flex items-center justify-between px-2 py-px text-[10px] font-bold tracking-wide">
                      <span>전입 예정</span>
                      <span className="num">{incomingHere.length}</span>
                    </div>
                    {incomingHere.map((s) => {
                      // 등원 요일 라벨 — 분리등원 학생이면 이 셀에서 오는 요일([월])을 표시(누가·어느 요일 오는지).
                      const dayTag = incomingDayLabel(s.attendanceDays, covers);
                      return (
                        <div key={s.enrollmentId} className={`${ROW_CLASS} bg-primary-soft/30 text-primary`}>
                          {/* 전입 예정: 좁은 칸에선 출발 반이름 대신 **학생이름**을 보여준다(누가 들어오는지 우선). */}
                          <span className="overflow-hidden whitespace-nowrap text-clip">+ {s.name}</span>
                          {dayTag ? (
                            <span className="text-primary shrink-0 font-mono text-[10px] font-bold">[{dayTag}]</span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {/* 대기·퇴원 */}
                {hasSecondary ? (
                  <div className="divide-line/40 divide-y border-t">
                    <StudentSection
                      students={hold}
                      classId={slot.id}
                      className={slot.className}
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
                      className={slot.className}
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
