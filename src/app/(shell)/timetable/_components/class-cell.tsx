"use client";
import { monthDay } from "@/features/timetable/scheduled-import";

import { useDroppable } from "@dnd-kit/core";
import { WindowLink } from "@/components/workspace/window-link";
import { EyIcon } from "@/components/icons/eywa-icons";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { DAY_LABEL, incomingDayLabel } from "@/features/timetable/lib/split-attendance";
import { readableTextColor } from "@/lib/color-utils";
import { useTimetableEdit } from "./edit-context";
import { ClassInfoCard, HoverCard } from "./hover-cards";
import { DraggableStudentRow, StudentRow, metaLabel, ROW_CLASS, type StudentQuick } from "./student-rows";
import { StudentSection, DayDropZone } from "./student-section";
import { useTimetableColorMode, subjectHeaderStyle, timetableStudentTone, withdrawnTone } from "./timetable-color";

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
  /**
   * 미래 주를 볼 때 — `className`은 **그 주에 불릴 이름**이고 이건 오늘 이름이다(둘이 다를 때만 채워진다).
   * 🔴 셀이 오늘 이름을 그리면 강사가 "그 반이 그대로구나"로 읽는다(원장 2026-08-29). 판정은
   *    [`class-name-as-of.ts`](../../../../features/classes/class-name-as-of.ts) 단일 소스.
   */
  classNameBefore?: string;
  /** 그 이름이 되는 날(`YYYY-MM-DD`). `classNameBefore`와 짝. */
  classNameChangeDate?: string;
  students: StudentQuick[];
};

export type { StudentQuick };

function shortTime(t: string) {
  return t.slice(0, 5);
}

// 명단 섹션 배치(2026-07-07 사용자 지정) — 재원은 이 영역만 스크롤(위/아래 페이드), 대기/퇴원은
// 고정 박스로 각자 스크롤. 재원 10칸 기본 + 대기 2칸 + 퇴원 3칸에 맞춰 교시 행높이(weekday-group-tables
// ROW_H)를 잡는다. 대기/퇴원은 내용 있을 때만 렌더(빈 슬롯 예약 안 함), 넘치면 그 박스만 스크롤.
export const STU_ROW_H = 23; // 학생 1행(실측 22.25 + divide-y 1px ≈ 23)
const SEC_LABEL_H = 17; // 대기/퇴원 라벨행(실측 17)
export const HOLD_MAX_H = 2 * STU_ROW_H + SEC_LABEL_H; // 대기 2칸 = 63px(합반 셀도 공유)
export const WD_MAX_H = 3 * STU_ROW_H + SEC_LABEL_H; // 퇴원 3칸 = 86px

/**
 * 셀 헤더 존 — **모든 셀이 항상 2행(HEADER_H) 높이**를 쓴다(2026-08-04 사용자 지정).
 *
 * 반교시(1-1만·1-2만) 수업은 그중 위/아래 **한 행**에만 반이름을 놓고 나머지 한 행은 빈 밴드로 남긴다.
 * 옛 구현은 라벨 높이는 그대로 두고 밴드를 바깥에 덧붙여서, 반교시 셀만 명단이 밴드만큼 아래로 밀려
 * **이웃 셀과 학생 이름 줄이 어긋났다**. 존 높이를 고정하면 위치 표시는 유지하면서 명단 시작선이 통일된다.
 *
 * HEADER_ROW_H = 반이름 한 줄(14px bold, line-height ≈21px)에 상하 패딩(py-1 = 8)을 더한 값.
 * ⚠️ 이 값을 줄이면 반교시 셀의 반이름이 잘린다(1행짜리라 여유가 없다).
 */
export const HEADER_ROW_H = 30;
export const HEADER_H = HEADER_ROW_H * 2;

/**
 * 합반 칸 머리의 `합반 N반` 배지가 먹는 세로 몫(배지 + 셀 패딩·간격) — 명단을 접었을 때 셀 최소 높이 계산에 더한다.
 * 안 더하면 헤더가 그만큼 잘린다(적대 리뷰 2026-09-04).
 */
export const HAPBAN_BADGE_H = 30;

/** 반교시 표시용 빈 밴드 — 반대쪽 서브슬롯 자리(합반 셀과 공유해 두 셀 높이가 항상 같게). */
export function SubSlotBand() {
  return (
    <div
      className="border-line bg-bg-soft/70 shrink-0 border-b"
      style={{ height: HEADER_ROW_H }}
      aria-hidden
    />
  );
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
  const { canDrag, incoming } = useTimetableEdit();
  const subjects = useSubjectMaps();
  const colorMode = useTimetableColorMode();
  // 과목 헤더 색은 학원설정(operations.subjects) 단일 소스 — 하드코딩 금지. 강도는 개인 색모드(vivid/mid/pastel).
  const headerFallback = subjectHeaderStyle(colorMode, subjects.colorOf(slot.subject));
  // 반 색(bg_color) 우선 — 통합뷰와 동일하게 헤더에 반영(모드 무관 존중). 없으면 과목색 폴백.
  // (WindowLink는 style 미지원이라 래퍼 div에 인라인 색.)
  const headerStyle = slot.classBgColor
    ? { background: slot.classBgColor, color: slot.classTextColor ?? readableTextColor(slot.classBgColor) }
    : headerFallback.style;
  const headerClass = slot.classBgColor ? "" : headerFallback.className;
  // 강사 인수인계 예약된 반 — 명단 영역에 은은한 blue 틴트(합반 앰버·전입 초록·신입 빨강과 구분). 상세는 hover 카드.
  const handover = slot.pendingHandover ?? null;

  // 재원/대기/퇴원 분리 — ijw 셀처럼 섹션별 표시. status 없으면(구버전) 재원으로 간주.
  const active = slot.students.filter((s) => (s.status ?? "active") === "active");
  // 예약된 이름 변경이 이 칸의 날짜엔 이미 적용돼 있다 — 무엇이 무엇으로 바뀌는지 한 줄로.
  // ⚠️ 한글 문장은 여기서만 만든다(화면에 raw 날짜·영문 키가 새지 않게).
  const renameNote = slot.classNameBefore
    ? `${slot.classNameChangeDate ? monthDay(slot.classNameChangeDate) : ""}부터 ${slot.classNameBefore} → ${slot.className}` +
      (slot.classroomName ? ` · ${slot.classroomName}` : "")
    : null;
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
  // 재원·대기·퇴원 모두 스크롤로 전원 노출('외 N명' 숨김이 아니라 박스 스크롤) — 큰 cap으로 현실 인원 커버.
  const activeCap = 40;
  const SECTION_CAP = 40;
  // 이 셀로 전입 예정인 학생(편집 모드에서 다른 반에서 끌어온 학생) — 도착 셀에 초록 미리보기로 표시.
  const incomingHere = incoming.get(slot.id) ?? [];
  const showRoster = roster !== "none" && (slot.students.length > 0 || incomingHere.length > 0);
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
  const dayHeadCls = dayColsAlways ? "" : "hidden [.tt-dragging_&]:block";

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
      className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2px] transition ${
        isOver ? "ring-primary ring-2" : ""
      }`}
    >
        {/* 헤더 존 — 어느 셀이든 항상 2행(HEADER_H). 반교시는 위/아래 한 행에만 라벨(상수 주석 참조). */}
        <div className="shrink-0" style={{ height: HEADER_H }}>
        {subSlot === "bottom" ? <SubSlotBand /> : null}
        {/* 반이름 헤더 바 — 반 색 우선(인라인), 없으면 과목색 클래스. WindowLink는 style 미지원이라 래퍼 div에 색.
            hover 시 수업 정보 카드, 클릭 시 반 정보 창 팝업(/classes/[classId]). */}
        <div
          className={`overflow-hidden transition hover:brightness-95 ${headerClass}`}
          style={{ ...headerStyle, height: subSlot === "full" ? HEADER_H : HEADER_ROW_H }}
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
            {/* 🔴 반 정보는 **더블클릭**으로 연다(원장 2026-09-04) — 학생 행과 같은 규약. */}
            <WindowLink
              openOn="doubleClick"
              href={`/classes/${slot.classId ?? slot.id}`}
              title={renameNote ?? (slot.classroomName ? `${slot.className} · ${slot.classroomName}` : slot.className)}
              ariaLabel={`${slot.className} 반 정보`}
              className="block h-full w-full px-2 py-1 text-left"
            >
              <div className="flex items-baseline justify-between gap-1.5">
                <span className="min-w-0 overflow-hidden whitespace-nowrap text-clip text-sm font-bold">
                  {slot.className}
                  {/* 🔴 미래 주는 **그 주에 불릴 이름**을 쓴다(원장 2026-08-29) — 오늘 이름으로 그리면
                      "그 반이 그대로구나"로 읽힌다. 🔴 다만 '개명' 표식은 붙이지 않는다(원장 2026-08-31:
                      *"그냥 날짜 지나면 반이름 변경되었으면 됨"*) — 바뀐 이름 자체가 답이다. 무엇이 무엇이
                      됐는지는 칸 hover의 title(renameNote)에 그대로 남는다(칸이 좁아 화면엔 못 적는다). */}
                </span>
                {/* 반교시(1행)면 아래 줄이 없으니 강의실을 이름과 같은 줄에 붙인다(정보 손실 방지). */}
                {subSlot !== "full" && slot.classroomName ? (
                  <span className="shrink-0 whitespace-nowrap text-xs opacity-75">{slot.classroomName}</span>
                ) : null}
                <span className="num shrink-0 text-xs opacity-70">{active.length}</span>
              </div>
              {/* 시각은 hover 카드에 나오므로 셀에선 생략(사용자 요청). 강의실만 표시.
                  ⚠️ 강의실 줄은 **항상 렌더**(없으면 nbsp 자리표시) — 셀마다 헤더 높이(2줄)를 일정하게 유지해
                  인접 반의 학생 이름이 가로로 줄맞춤되게 한다(강의실 유무로 헤더가 1↔2줄 되며 명단이 17px 어긋나던 것 해소).
                  ⚠️ 2행(full)일 때만 — 반교시(1행)는 위 이름 줄에 강의실을 붙인다. */}
              {subSlot === "full" ? (
              <div className="flex items-center justify-end gap-1 text-xs opacity-75">
                <span className="overflow-hidden whitespace-nowrap text-clip">
                  {slot.classroomName || " "}
                </span>
              </div>
              ) : null}
            </WindowLink>
          </HoverCard>
        </div>
        {subSlot === "top" ? <SubSlotBand /> : null}
        </div>

        {/* 학생 명단 — 재원(이 영역만 스크롤+페이드) / 대기·퇴원(고정 박스, 각자 스크롤)을 분리.
            신입=빨강·전입=초록·퇴원=취소선. 컨테이너 자체는 스크롤 안 함(재원·대기·퇴원 박스가 각자).
*/}
        {showRoster ? (
          <div className={`flex min-h-0 flex-1 flex-col text-sm ${handover ? "bg-blue-soft" : "bg-card"}`}>
            {/* 재원 — 이 영역만 스크롤(스크롤바 숨김 + 위·아래 페이드). 10칸 기본, 넘으면 스크롤.
                재원 공통 + 분리등원 요일 칸 + 전입예정(편집)을 포함. flex-1이라 대기/퇴원이 있으면
                그만큼 줄어 재원≈10칸, 없으면 재원이 더 넓게 채운다(짧으면 페이드 없음). */}
            <div className="tt-cell-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
              <div className="divide-line/40 shrink-0 divide-y">
                <StudentSection
                  students={commonActive}
                  classId={realClassId}
                  className={slot.className}
                  canDrag={canDrag}
                  cap={activeCap}
                  draggable
                  tone={(s) => timetableStudentTone(colorMode, s)}
                  slotId={slot.id}
                  coveringDays={covers}
                />
              </div>
              {/* 분리등원 요일 칸 — 편집 모드의 다요일 셀엔 요일 드롭존을 항상(요일별 등원 지정), 아니면 분리 학생 있을 때만. */}
              {hasSplit ? (
                <div className={`shrink-0 ${dayColsAlways ? "border-line/60 border-t border-dashed" : "[.tt-dragging_&]:border-line/60 [.tt-dragging_&]:border-t [.tt-dragging_&]:border-dashed"}`}>
                  <div className="flex">
                    {covers.map((day) => {
                        const dayStudents = partialActive.filter((s) => (s.attendanceDays ?? []).includes(day));
                        const col = (
                          <>
                            <div className={`text-text-faint bg-bg-soft/60 px-1 py-px text-center text-xs font-bold ${dayHeadCls}`}>
                              {DAY_LABEL[day] ?? day}
                            </div>
                            {dayStudents.length > 0 ? (
                              dayStudents.map((s, i) =>
                                canDrag && s.enrollmentId ? (
                                  <DraggableStudentRow
                                    key={s.enrollmentId}
                                    student={s}
                                    enrollmentId={s.enrollmentId}
                                    studentId={s.studentId}
                                    dayKey={day}
                                    classId={realClassId}
                                    className={slot.className}
                                    name={s.name}
                                    meta={metaLabel(s.school, s.grade)}
                                    tone={timetableStudentTone(colorMode, s)}
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
                                    tone={timetableStudentTone(colorMode, s)}
                                  />
                                ),
                              )
                            ) : (
                              <div className="text-text-faint/70 hidden min-h-[22px] items-center justify-center text-xs [.tt-dragging_&]:flex">
                                여기로
                              </div>
                            )}
                          </>
                        );
                        return canDrag ? (
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
              {/* 전입 예정(편집 모드) — 다른 반에서 끌어온 학생을 도착 셀에 초록 미리보기로(재원 스크롤 안). */}
              {incomingHere.length > 0 ? (
                <div className="divide-line/40 border-primary/40 shrink-0 divide-y border-t border-dashed">
                  <div className="bg-primary-soft/50 text-primary flex items-center justify-between px-2 py-px text-xs font-bold tracking-wide">
                    <span>전입 예정</span>
                    <span className="num">{incomingHere.length}</span>
                  </div>
                  {incomingHere.map((s) => {
                    // 등원 요일 라벨 — 분리등원 학생이면 이 셀에서 오는 요일([월])을 표시(누가·어느 요일 오는지).
                    const dayTag = incomingDayLabel(s.attendanceDays, covers);
                    return (
                      <div key={s.enrollmentId} className={`${ROW_CLASS} bg-primary-soft/30 text-primary`}>
                        {/* 전입 예정: 좁은 칸에선 출발 반이름 대신 **학생이름**을 보여준다(누가 들어오는지 우선). */}
                        <span className="inline-flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-clip">
                          <EyIcon name="userPlus" size={11} className="shrink-0" aria-hidden="true" />
                          {s.name}
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
            {/* 대기 — 고정 박스(최대 2칸), 넘으면 이 박스만 스크롤(스크롤바 숨김). 있을 때만 렌더(빈 슬롯 예약 X). */}
            {hold.length > 0 ? (
              <div
                className="scrollbar-hide divide-line/40 shrink-0 divide-y overflow-y-auto border-t"
                style={{ maxHeight: HOLD_MAX_H }}
              >
                <StudentSection
                  students={hold}
                  classId={slot.id}
                  className={slot.className}
                  canDrag={canDrag}
                  cap={SECTION_CAP}
                  draggable={false}
                  tone={() => "text-text-dim"}
                  label="대기"
                  labelTone="bg-amber-soft/40 text-amber"
                />
              </div>
            ) : null}
            {/* 퇴원 — 고정 박스(최대 3칸), 넘으면 스크롤(스크롤바 숨김). 있을 때만 렌더. */}
            {withdrawn.length > 0 ? (
              <div
                className="scrollbar-hide divide-line/40 shrink-0 divide-y overflow-y-auto border-t"
                style={{ maxHeight: WD_MAX_H }}
              >
                <StudentSection
                  students={withdrawn}
                  classId={slot.id}
                  className={slot.className}
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
