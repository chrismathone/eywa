"use client";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { GripVertical } from "@/components/icons/eywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { SUBJECT_SOLID } from "@/features/owner/subjects";
import { enumDayToKo, type DayOfWeek } from "@/features/timetable/lib/periods";
import { LAB_ROOM_LABEL, type TeacherNicknameMap } from "@/features/timetable/lib/teacher-label";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import {
  padCardDays,
  teacherColor,
  type GridStudent,
  type RichCardGroup,
  type RichClassCard,
  type TeacherColorMap,
} from "@/features/timetable/lib/class-grid";
import { ClassInfoCard, HoverCard, StudentInfoCard } from "./hover-cards";
import { useClassFilter, useSearchTone } from "./search-context";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { HOLD_SECTION_CLASS, timetableStudentTone, useTimetableColorMode, withdrawnTone } from "./timetable-color";
import { setArmedRow, useIsArmedRow, useTouchCapable } from "./drag-flag";
import { rosterDropId, useRosterMove, type RosterDragData } from "./roster-move";
import { movedByTarget, visibleSpanRows } from "@/features/timetable/lib/row-span";

/**
 * 표 격자선 — 통합뷰는 **격자 자체가 정보**라 데이터 표(열=`--line-faint`)와 규약이 다르다.
 * 원장 2026-08-11 *"구분선 더 진하게"* → `--line`(9%) → `--line-strong`(18%).
 * ⚠️ 한 곳에서만 정한다(셀마다 `border-line`을 흩뿌리면 다음에 또 전수 치환해야 한다).
 */
const GRID = "border-line-strong";
/**
 * **수업(카드) 사이** 세로 구분선 — 격자선보다 한참 진하다(원장 2026-08-11 "한참 진하게").
 * 격자(요일·교시)와 카드 경계는 뜻이 다르다: 앞은 한 반 **안**의 칸 나눔이고, 뒤는 **반과 반의 경계**다.
 * 같은 농도로 두면 옆 반 열이 자기 반 요일 열처럼 읽혀 카드 경계가 사라진다(원장이 짚은 "이 사이선").
 */
const CARD_EDGE = "border-r-2 border-ink/45";

// 라벨열·카드가 공유하는 고정 섹션 높이(px) — 같은 y에서 행이 맞물려 "행=라벨, 열=수업" 스프레드시트 정렬.
/** 수업명만 있는 헤더(배치 편집 모드). 정상 모드는 강의실 줄이 붙어 `NAME_ROOM_H`. */
export const NAME_H = 40;
/**
 * 정상 모드 헤더 = **수업명 + 그 아래 강의실**(원장 2026-08-11 *"강의실을 수업명 아래로 넣고 강의실 행 제거"*).
 * 전용 강의실 행(34px)을 없앤 대신 헤더가 14px 늘어 카드마다 순 20px을 회수한다.
 */
const NAME_ROOM_H = 54;
const TEACHER_H = 24;
const DAYHEAD_H = 22;
const PERIOD_H = 26;
// 학생 1행 높이 — 기본뷰 StudentRow 실측(13px × leading-tight + py-[3px] = 23.1px)에 맞춘 값.
// ⚠️ 서식을 기본뷰와 동일하게 두는 한 이 값도 함께 따라가야 한다(안 그러면 행이 잘린다).
const STU_H = 24;
/**
 * 교시축(좌측 라벨열) 폭 — **시간대 한 줄이 안 깨지는 최소치**.
 *
 * 58px이던 것을 넓혔다(2026-08-14): 학원장이 교시 이름을 비우면 시간대가 **이름 자리로 올라오는데**
 * (`p.label || p.time`, 10px tabular), `14:20~15:00` 11자가 58px에 안 들어가 두 줄로 깨졌다
 * (원장 *"시간 표시하는 열너비 조금만 넓혀서 두줄 안되도록"*). 이름이 있던 시절엔 시각이 7px 보조줄이라
 * 좁아도 됐다. ⚠️ 이름을 다시 붙여도 이 폭은 유지할 것 — 이름이 짧아질 뿐 깨질 이유가 없다.
 * 2026-09-04(v5 글자 승격 뒤): 14px 굵은 `14:20~15:00`이 72px을 넘쳐 **왼쪽이 잘려** `4:20~15:00`으로 보였다
 * (원장 캡처 *"왼쪽에 시간이 셀 밖으로 빠져나옴"*) → 104px(11자 × ~8.5px + 여백).
 */
const LABEL_W = 104;
/**
 * 5요일 반(DP6)의 카드 폭 — 아래 `DAY_COL_W`의 기준값이다.
 * 2026-09-04(v5 글자 승격 뒤): 176(칸 35px)에선 16px 학생 줄 `박세아A/칠성초2`가 3요일 카드(105px)에서 학교·학년부터 잘렸다
 * (원장 *"각종 뷰에서 텍스트 빠져나오지 않게"*) → 240(칸 48px). 통합뷰는 폭이 데이터 크기라 가로 스크롤+잡고 끌기.
 * 2026-09-08: 240도 **중학교 이름에서 모자랐다** — `김태희/경명여중2`의 학년 숫자가 3요일 카드(144px)에서 잘렸다
 * (원장 캡처 *"열너비도 조금씩만 더 증가해서 하단 중학생 학년이 나올정도까지만"*). 275(칸 55px, 3요일 165px)로
 * **한 글자분(+21px)만** 넓힌다. 🔴 더 넓히지 말 것 — 통합뷰는 반이 가로로 늘어서라 칸이 넓어질수록 한 화면에 덜 들어온다.
 */
const CARD_W = 275;
/**
 * 요일 한 칸의 폭 — **주5일 기준 고정**(원장 2026-08-11 "열너비는 dp처럼 주5일 기준에 맞춰").
 *
 * 빈 요일 열을 없앤 뒤(같은 날) 카드 폭을 CARD_W로 붙들어 두니 2요일 반의 한 칸이 88px로 벌어져
 * 5요일 반(DP6, 35px)과 두 배 넘게 차이 났다. 칸 너비를 고정하고 **카드 폭이 요일 수를 따라가게** 뒤집는다
 * — 그래야 어느 카드든 한 칸이 같은 크기로 읽히고(2026-07-27 원장이 5칸 고정을 요구했던 그 이유), 덤으로
 * 2·3요일 반이 좁아져 한 화면에 더 들어온다.
 * ⚠️ 대가: 2요일 반의 카드가 70px이라 긴 반 이름이 한 줄에 안 들어간다 → 헤더에서 이름을 두 줄까지 접는다.
 */
const DAY_COL_W = CARD_W / 5;
const SECTION_PAD = 8; // p-1(4px) 상하
// 명단 섹션 높이는 **그룹 내 최대 인원**(`group.rosterRows`, 상한 12)에서 온다 — 고정 행수 상수는 폐지.
// 배경·상한 근거는 class-grid.ts `rosterRows` 주석 참조(2026-07-27 "세로 여백이 너무 많다").
const sectionH = (rows: number) => (rows > 0 ? rows * STU_H + SECTION_PAD : 0);

function abbrev(label: string): string {
  return label.length > 4 ? label.slice(0, 4) : label;
}

/**
 * 반=열 카드가 공유하는 렌더 재료 — 편집 모드가 열마다 dnd 훅 컴포넌트를 끼울 때 그대로 넘겨받는다.
 * (훅은 열마다 하나씩 필요한데 `.map` 안에서 직접 부르면 훅 규칙 위반이라, 부모가 컴포넌트를 준다.)
 */
export type ColumnCommon = {
  group: RichCardGroup;
  subjectSoftClass: string;
  teacherColors: TeacherColorMap;
  /**
   * 표시 이름 → 영어 닉네임(한국인 강사만). 있으면 **담임 줄만** `한글이름(영어이름)`으로 적는다.
   * 🔴 미니그리드 셀엔 절대 안 쓴다(원장 2026-08-13 *"미니그리드는 제외"*) — 칸이 35px라 4자로 잘린다.
   */
  teacherNicknames?: TeacherNicknameMap;
  activeH: number;
  holdH: number;
  wdH: number;
  /** 명단 섹션 행 수 — '학생 명단 접기'면 전부 0(그룹 원본 `group.rosterRows`가 아니라 이 값을 볼 것). */
  rosterRows: { active: number; hold: number; withdrawn: number };
  /** 명단 접힘 — 카드 머리에 **인원**을 대신 적는다(접었다고 몇 명인지까지 사라지면 그건 은폐다). */
  hideStudents?: boolean;
  /**
   * **수업명 행만** 그린다(그룹 설정 = 배치 편집 모드). 담임·강의실·교시 격자·명단을 통째로 접어
   * 반 하나가 40px 한 칸이 된다 — 42반이면 원래 2만 칸 넘는 격자를 매 드롭마다 다시 그려야 해서
   * 끌 때 렉이 걸린다(원장 2026-08-06 *"수업명만 보여주던가"*). 서식은 통합뷰와 **같은 컴포넌트**라
   * 색·폭·모서리가 저절로 일치한다(따로 그리면 두 화면이 갈라진다).
   */
  namesOnly?: boolean;
};

/** 편집 모드에서 한 열에 붙는 드래그 배선 — 없으면(평소) 열은 지금까지와 완전히 동일하게 그려진다. */
export type ColumnEdit = {
  setNodeRef: (el: HTMLElement | null) => void;
  /** 헤더(반명 칸)에 뿌릴 dnd 손잡이 속성 — `aria-roledescription="draggable"`이 들어 있어야
   *  DragScrollArea의 '잡고 끌기'가 이 위에서는 팬을 시작하지 않는다(둘이 같은 포인터를 다투는 것 방지). */
  handleProps: HTMLAttributes<HTMLElement>;
  style?: CSSProperties;
  /** 지금 끌고 있는 열(원본은 흐리게). */
  dragging?: boolean;
  /** 이 열 **앞**에 끼워진다는 자리 표시(왼쪽 세로 막대). */
  insertBefore?: boolean;
};

/** 통합뷰 한 섹션(시작 교시 그룹) — 가로 드래그 + 좌측 sticky 라벨열 + 반=열 카드. */
export function RichCardGroupBoard({
  group,
  subjectSoftClass,
  teacherColors,
  teacherNicknames,
  renderCard,
  trailing,
  namesOnly,
  hideStudents = false,
}: {
  group: RichCardGroup;
  subjectSoftClass: string;
  teacherColors: TeacherColorMap;
  /** 담임 줄 `한글이름(영어이름)` 표기용(영어 시간표). 미지정=이름만. */
  teacherNicknames?: TeacherNicknameMap;
  /** 편집 모드 — 열을 dnd 훅 컴포넌트로 감싸 그린다(key도 호출부가 준다). 미지정=평소 렌더. */
  renderCard?: (card: RichClassCard, common: ColumnCommon) => ReactNode;
  /** 마지막 열 뒤에 붙는 칸(편집 모드의 '맨 뒤에 놓기' 자리). 미지정=없음. */
  trailing?: ReactNode;
  /** 수업명 행만(배치 편집) — ColumnCommon.namesOnly 주석 참조. */
  namesOnly?: boolean;
  /** '학생 명단 접기'(뷰 설정) — 명단 섹션을 통째로 안 그린다(카드가 그만큼 낮아진다). */
  hideStudents?: boolean;
}) {
  // 섹션 안에서는 모든 카드가 같은 높이(행이 맞물려 시트처럼 읽힌다) — 높이는 그 섹션의 최대 인원.
  // '학생 명단 접기'면 세 섹션을 0행으로 — 높이·라벨·행이 **같은 값 하나**를 보므로 카드와 라벨열이 어긋나지 않는다.
  const rosterRows = hideStudents ? { active: 0, hold: 0, withdrawn: 0 } : group.rosterRows;
  const activeH = sectionH(rosterRows.active);
  const holdH = sectionH(rosterRows.hold);
  const wdH = sectionH(rosterRows.withdrawn);
  const common: ColumnCommon = { group, subjectSoftClass, teacherColors, teacherNicknames, activeH, holdH, wdH, rosterRows, hideStudents, namesOnly };
  // 학생 검색 — 걸린 반만 남긴다. 섹션 높이(rosterRows)는 그룹 전체 기준 그대로라 남은 카드의 행이
  // 어긋나지 않는다.
  // 🔴 **배치 편집(renderCard)에선 절대 안 거른다** — 끌어 옮기는 화면에서 반이 사라지면 배치가
  //    깨진다. page가 그 모드에선 검색을 아예 안 열지만(enabled=false), 여기서도 못박아 둔다
  //    (멀리 있는 플래그 하나에만 기대면 나중에 조용히 뒤집힌다).
  const classVisible = useClassFilter();
  const cards = renderCard ? group.cards : group.cards.filter((c) => classVisible(c.classId));

  return (
    <DragScrollArea barX className={`${GRID} border-t`}>
      <div className="flex w-max items-stretch">
        <LabelColumn group={group} activeH={activeH} holdH={holdH} wdH={wdH} namesOnly={namesOnly} />
        {cards.map((c) =>
          renderCard ? renderCard(c, common) : <ClassColumn key={c.classId} card={c} {...common} />,
        )}
        {trailing}
      </div>
    </DragScrollArea>
  );
}

/** 좌측 고정 라벨열 — 카드와 동일 높이 섹션을 "라벨"로. */
function LabelColumn({
  group,
  activeH,
  holdH,
  wdH,
  namesOnly,
}: {
  group: RichCardGroup;
  activeH: number;
  holdH: number;
  wdH: number;
  namesOnly?: boolean;
}) {
  const cell = `${GRID} text-text-dim flex items-center justify-center border-b text-xs font-bold`;
  // 대기 라벨은 색 띠 위에 얹히므로 **글자색을 상속하지 않는다** — `cell`의 text-text-dim과 겹치면
  // 승자를 CSS 순서가 정해(같은 축 유틸, [[#116]]) 카드 쪽(잉크)과 레일 쪽이 다른 색이 된다.
  const cellNoColor = `${GRID} flex items-center justify-center border-b text-xs font-bold`;
  const rail = `bg-bg-soft ${GRID} sticky left-0 z-20 flex shrink-0 flex-col self-stretch border-r shadow-[4px_0_10px_-6px_rgba(29,29,31,0.18)]`;
  if (namesOnly)
    return (
      <div className={rail} style={{ width: LABEL_W }}>
        <div className={cell} style={{ height: NAME_H }}>수업명</div>
      </div>
    );
  return (
    <div className={rail} style={{ width: LABEL_W }}>
      {/* 강의실 라벨은 없앴다 — 카드 쪽에서 수업명 아래 둘째 줄로 들어가 별도 행이 사라졌다(NAME_ROOM_H). */}
      <div className={cell} style={{ height: NAME_ROOM_H }}>수업명</div>
      <div className={cell} style={{ height: TEACHER_H }}>담임</div>
      <div className={cell} style={{ height: DAYHEAD_H }}>교시</div>
      {visibleSpanRows(group.periodRows, group.rowPlan).map((p) => (
        <div
          key={p.order}
          className={`${GRID} text-text-faint flex flex-col items-center justify-center border-b num leading-none`}
          style={{ height: PERIOD_H }}
        >
          {/* 학원장이 교시 이름을 비우면 시간대가 이름 자리로 올라온다(2026-08-13, periodListLabel).
              ⚠️ `nowrap` — 시간대(`14:20~15:00`)가 줄바꿈되면 교시 한 칸이 두 줄로 부풀어 축이 어긋난다.
                 폭은 LABEL_W가 책임진다(둘을 같이 볼 것). */}
          <span className="text-foreground text-xs font-bold whitespace-nowrap">{p.label || p.time}</span>
          {/* 주말 섹션은 시각이 비어 온다(카드마다 시각이 달라 행에 못 적는다 — class-grid `weekendSelfShift`).
              교시표에 없는 시각의 행은 라벨 자체가 시각이라 같은 값을 두 번 적지 않는다(`slotPeriodRow` 폴백). */}
          {p.label && p.time && p.time !== p.label ? <span className="text-xs">{p.time}</span> : null}
        </div>
      ))}
      {/* 명단을 접으면(activeH 0) 라벨도 없다 — 카드 쪽과 높이가 같아야 줄이 어긋나지 않는다. */}
      {activeH > 0 ? (
        <div className={`text-primary ${GRID} flex items-center justify-center border-b text-xs font-bold`} style={{ height: activeH }}>
          재원
        </div>
      ) : null}
      {/* 대기·퇴원은 **항상** 선다(원장 2026-09-07) — 카드 쪽 높이와 같아 정렬이 유지된다. */}
      {holdH > 0 ? <div className={`${cellNoColor} ${HOLD_SECTION_CLASS}`} style={{ height: holdH }}>대기</div> : null}
      {wdH > 0 ? (
        <div className={`${GRID} text-text-dim flex items-center justify-center text-xs font-bold`} style={{ height: wdH }}>
          퇴원
        </div>
      ) : null}
    </div>
  );
}

/** 반=열 카드 — 헤더(반명·담임·강의실) + 요일×교시 미니그리드 + 재원/대기/퇴원. */
export function ClassColumn({
  card,
  group,
  subjectSoftClass,
  teacherColors,
  teacherNicknames,
  activeH,
  holdH,
  wdH,
  rosterRows,
  hideStudents,
  namesOnly,
  edit,
}: ColumnCommon & {
  card: RichClassCard;
  /** 있으면 편집 모드 — 헤더가 '반 창 열기 링크'가 아니라 **드래그 손잡이**가 된다. */
  edit?: ColumnEdit;
}) {
  // 요일축 = **이 반이 실제 수업하는 요일만**(원장 2026-08-11 "수업없는 요일 열도 숨겨버리고").
  // 카드 폭(CARD_W)은 그대로라 남은 칸이 넓어질 뿐, 카드 간 세로 정렬은 유지된다. 2026-07-27의
  // "항상 월~금 5칸" 규약을 뒤집은 배경은 class-grid.ts `days` 주석 참조(실측 42반 중 41반이 2~3일).
  // ⚠️ 단 **최소 3열**은 보장한다(원장 2026-08-13) — 2요일 반만 카드가 70px로 쪼그라들어 격자가
  //    들쭉날쭉했다. 모자란 만큼 수요일부터 **빈 더미 열**을 채운다(padCardDays, 주말 전용은 예외).
  const days: DayOfWeek[] = padCardDays(card.days?.length ? card.days : group.days);
  const gridCols = { gridTemplateColumns: `repeat(${Math.max(1, days.length)}, 1fr)` };
  // 교시축 접기(40분·60분 혼재) — 그릴 행과, 그 행 위에 얹힐 접힌 칸. 카드마다 한 번만 만든다.
  const gridRows = visibleSpanRows(group.periodRows, group.rowPlan);
  const moved = movedByTarget(group.rowPlan);
  // 카드 폭 = 요일 수 × 고정 칸 폭(DAY_COL_W). 배치 편집(namesOnly)은 격자를 안 그리므로 5칸 기준 폭 유지 —
  // 수업명만 남은 칩이 요일 수에 따라 들쭉날쭉하면 끌어 놓을 자리를 가늠하기 어렵다.
  // 🔴 카드 **최소 폭 = 3칸**(144px) — padCardDays가 못 채우는 주말 전용 반(토·일 하루)은 1칸(48px)이라 학생 이름이 통째로
  //    잘렸다(실측 2026-09-04 수학 통합뷰 20줄). 칸은 `1fr`이라 폭이 남으면 요일 칸이 그만큼 넓어질 뿐 정렬은 안 깨진다.
  const cardW = namesOnly ? CARD_W : Math.max(3, days.length) * DAY_COL_W;
  // 반 헤더색 — ijw bgColor 우선(인라인), 없으면 과목색 클래스.
  const headerStyle = card.bgColor
    ? { background: card.bgColor, color: card.textColor ?? "#121212" }
    : undefined;

  return (
    <div
      ref={edit?.setNodeRef}
      className={`${CARD_EDGE} flex shrink-0 flex-col ${edit ? "relative" : ""} ${
        edit?.dragging ? "opacity-35" : ""
      }`}
      style={{ width: cardW, ...edit?.style }}
    >
      {/* 끼워질 자리 — 끌고 있는 열이 **이 열 앞**에 들어간다는 표시(놓기 전에 결과를 보여준다). */}
      {edit?.insertBefore ? (
        <span aria-hidden className="bg-primary absolute inset-y-0 -left-px z-10 w-[3px] rounded-full" />
      ) : null}
      {/* 수업명 — 평소엔 클릭=반 창, 편집 모드엔 **드래그 손잡이**(같은 자리에서 뜻만 바뀐다).
          헤더색은 래퍼 div(WindowLink는 style 미지원). */}
      <div
        className={`${GRID} border-b ${card.bgColor ? "" : subjectSoftClass}`}
        style={{ height: namesOnly ? NAME_H : NAME_ROOM_H, ...headerStyle }}
      >
        {edit ? (
          <div
            {...edit.handleProps}
            title={`${card.className} — 끌어서 다른 줄로 옮기기`}
            className="flex h-full w-full cursor-grab items-center justify-center gap-1 px-1 text-center text-sm font-bold select-none active:cursor-grabbing"
          >
            <GripVertical className="size-3 shrink-0 opacity-45" />
            <span className="overflow-hidden whitespace-nowrap text-clip">{card.className}</span>
          </div>
        ) : (
          <HoverCard
            width={230}
            card={
              <ClassInfoCard
                className={card.className}
                subject={card.subject}
                teacherName={card.teacherName}
                room={card.classroomLabel}
                counts={{ active: card.activeCount, hold: card.hold.length, withdrawn: card.withdrawn.length }}
              />
            }
          >
            <WindowLink
              openOn="doubleClick"
              href={`/classes/${card.classId}`}
              title={card.className}
              ariaLabel={`${card.className} 반 정보`}
              className="flex h-full w-full flex-col items-center justify-center gap-0.5 px-1 text-center transition hover:brightness-95"
            >
              {/* 이름은 **두 줄까지** 접는다 — 칸 너비를 고정하면서(DAY_COL_W) 2요일 반 카드가 70px까지
                  좁아져 한 줄로는 `고등E_고1 특별 S` 같은 이름이 통째로 잘린다. 전체 이름은 title에도 있다. */}
              <span className="line-clamp-2 w-full text-sm leading-tight font-bold break-keep">
                {card.className}
              </span>
              {/* 강의실 — 전용 행 대신 수업명 바로 아래(원장 2026-08-11 "LS6 / 화 602 / 금 603 이렇게").
                  헤더색 위에 얹히므로 색을 따로 주지 않고 투명도만 낮춘다(반색이 어두우면 흰 글자가 유지된다).
                  ⚠️ namesOnly(배치 편집)에선 헤더가 NAME_H(40px)로 좁아 두 줄이 안 들어간다 → 안 그린다. */}
              {namesOnly ? null : (
                <span className="line-clamp-1 w-full text-xs leading-tight font-normal opacity-70" title={card.classroomLabel}>
                  {card.classroomLabel}
                  {/* 명단을 접으면 인원이 어디에도 안 남는다(기본뷰는 헤더에 있다) → 강의실 옆에 붙인다. */}
                  {hideStudents ? <span className="num"> · {card.activeCount}</span> : null}
                </span>
              )}
            </WindowLink>
          </HoverCard>
        )}
      </div>
      {/* 배치 편집(수업명만) — 여기서 끝. 아래 담임·격자·명단을 안 그려야 42반을 끌 때 안 버벅인다. */}
      {namesOnly ? null : (
      <>
      {/* 담임 — **이름만**(원장 2026-09-08 *"통합 시간표에서 담임 행에서 배경색 제거해줘"*).
          🔴 강사 저장색(`teacherColors`) 칩을 여기 다시 넣지 말 것 — 반 헤더색·교시 칸 색과 겹쳐
             한 카드에 색이 세 층이 됐다. 색은 칸(누가 그 교시에 들어가나)에만 남는다.
          한국인 강사는 `한글이름(영어이름)`(원장 2026-08-13) — 영어과는 서로를 닉네임으로 부른다.
          ⚠️ 넘치면 카드 안에서 **잘린다**(overflow-hidden) — 옆 반 칸 위로 삐져나오지 않게. */}
      <div className={`${GRID} flex min-w-0 items-center justify-center overflow-hidden border-b`} style={{ height: TEACHER_H }}>
        {!card.teacherName ? (
          <span className="text-text-faint text-xs">-</span>
        ) : (
          <span className="text-foreground overflow-hidden text-xs font-bold whitespace-nowrap text-clip">
            {card.teacherName}
            <TeacherNick name={card.teacherName} map={teacherNicknames} />
          </span>
        )}
      </div>
      {/* 요일 헤더 — 이 반이 실제 수업하는 요일만(빈 열 없음). */}
      <div className={`${GRID} grid border-b`} style={{ ...gridCols, height: DAYHEAD_H }}>
        {days.map((d) => (
          <DayHead key={d} day={d} />
        ))}
      </div>
      {/* 요일×교시 미니그리드 — 행은 섹션이 실제 쓰는 교시만(keepUsedRows). */}
      {gridRows.map((p) => (
        <div key={p.order} className={`${GRID} grid border-b`} style={{ ...gridCols, height: PERIOD_H }}>
          {days.map((d, di) => (
            // 칸 하나가 **한 칸보다 길 수 있다**(60분 수업 = 40분 눈금 1.5칸) → 요일마다 자리 상자를 두고
            // 접힌 칸을 그 안에 절대배치한다. 넘치는 부분은 아래 행 위로 그려진다(그 자리는 어차피 빈 칸이다).
            <div key={d} className="relative h-full">
              <Cell card={card} order={p.order} day={d} teacherColors={teacherColors} last={di === days.length - 1} />
              {(moved.get(p.order) ?? []).map((m) =>
                card.cells[`${m.from}:${d}`] ? (
                  <div
                    key={m.from}
                    className="absolute inset-x-0 z-[1]"
                    style={{ top: m.offset * PERIOD_H, height: m.span * PERIOD_H }}
                  >
                    <Cell card={card} order={m.from} day={d} teacherColors={teacherColors} last={di === days.length - 1} />
                  </div>
                ) : null,
              )}
            </div>
          ))}
        </div>
      ))}
      {/* 재원생 — 섹션 최대 인원(상한 12행). 넘치면 카드 안에서 스크롤하되 스크롤바는 숨기고 하단 페이드. */}
      <RosterSection h={activeH} rows={rosterRows.active} count={card.active.length} className={`bg-card ${GRID} border-b`}>
        {card.activeCount === 0 ? (
          <EmptyDash />
        ) : (
          card.active.map((s, i) => (
            <RosterRow key={s.studentId ?? `a-${i}`} s={s} classId={card.classId} cardName={card.className} />
          ))
        )}
      </RosterSection>
      <RosterSection
        h={holdH}
        rows={rosterRows.hold}
        count={card.hold.length}
        className={`${HOLD_SECTION_CLASS} ${GRID} border-b`}
        dropId={rosterDropId(card.classId, "hold")}
      >
        {card.hold.length === 0 ? (
          <EmptyDash />
        ) : (
          card.hold.map((s, i) => (
            <RosterRow key={s.studentId ?? `h-${i}`} s={s} classId={card.classId} cardName={card.className} />
          ))
        )}
      </RosterSection>
      {/* 퇴원 — 재원/대기와 동일 서식, 진회색 배경+흰 글자 톤으로 구분 */}
      <RosterSection
        h={wdH}
        rows={rosterRows.withdrawn}
        count={card.withdrawn.length}
        className="bg-bg-soft"
        dropId={rosterDropId(card.classId, "withdrawn")}
      >
        {card.withdrawn.length === 0 ? (
          <EmptyDash />
        ) : (
          card.withdrawn.map((s, i) => (
            <RosterRow key={s.studentId ?? `w-${i}`} s={s} classId={card.classId} cardName={card.className} />
          ))
        )}
      </RosterSection>
      </>
      )}
    </div>
  );
}

type MovableRowProps = {
  armed: boolean;
  rowKey: string;
  drag: RosterDragData;
  children: React.ReactNode;
  /** HoverCard가 `cloneElement`로 주입 — 덮지 않고 그대로 내려보낸다(카드가 안 뜨면 정보가 사라진다). */
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
};

/** 끌 수 있는 줄 — 무장 여부만 다르고 **DOM은 같다**(다르면 마우스가 지날 때마다 줄이 움찔한다). */
function MovableRosterRow(props: MovableRowProps) {
  return props.armed ? <ArmedRosterRow {...props} /> : <RestingRosterRow {...props} />;
}

/** 무장 전 — dnd 훅 없이 그리고, 포인터가 올라오면 그 줄만 무장시킨다. */
function RestingRosterRow({ rowKey, ...rest }: MovableRowProps) {
  return <RosterRowShell {...rest} onArm={() => setArmedRow(rowKey)} />;
}

/** 무장 후 — dnd-kit draggable. 떨어뜨리면 확인 팝업이 뜬다(그것만으로 바뀌지 않는다). */
function ArmedRosterRow({ drag, ...rest }: MovableRowProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `roster:${drag.enrollmentId}`,
    data: drag,
  });
  return (
    <RosterRowShell {...rest} drag={drag} dnd={{ attributes, listeners, setNodeRef, isDragging }} />
  );
}

function RosterRowShell({
  children,
  onArm,
  onMouseEnter,
  onMouseLeave,
  dnd,
}: Omit<MovableRowProps, "armed" | "rowKey"> & {
  onArm?: () => void;
  dnd?: {
    attributes: ReturnType<typeof useDraggable>["attributes"];
    listeners: ReturnType<typeof useDraggable>["listeners"];
    setNodeRef: ReturnType<typeof useDraggable>["setNodeRef"];
    isDragging: boolean;
  };
}) {
  return (
    <div
      ref={dnd?.setNodeRef}
      {...(dnd?.attributes ?? {})}
      {...(dnd?.listeners ?? {})}
      // ⚠️ `pointerover`(버블링) — enter/leave는 자식을 오갈 때 놓치기 쉽고, 같은 값 재설정은 무동작이다.
      onPointerOver={() => onArm?.()}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      title="끌어서 대기·퇴원으로 · 더블클릭 = 학생 정보"
      className={`cursor-grab touch-none select-none active:cursor-grabbing ${dnd?.isDragging ? "opacity-40" : ""}`}
    >
      {children}
    </div>
  );
}

/**
 * 빈 섹션 자리 표시 — 가로뿐 아니라 **세로도 가운데**(원장 2026-09-07: *"중앙 정렬만 되던걸 가운데 정렬까지"*).
 * 섹션 높이가 고정이라 `h-full`이 그 칸을 그대로 채운다(부모 `p-1` 안쪽 기준).
 */
function EmptyDash() {
  return <div className="text-text-faint flex h-full items-center justify-center text-xs">-</div>;
}

/**
 * 명단 섹션 한 칸(재원/대기/퇴원 공용).
 * - `rows`가 0이면 **아예 안 그린다**(그 섹션에 인원이 한 명도 없는 그룹 — 빈 "-" 줄이 사라진다).
 * - 인원이 표시 행수를 넘으면 카드 안에서만 스크롤한다. 카드 높이는 그대로라 이단 스크롤이 안 생긴다.
 *   ⚠️ 스크롤바는 숨기고(`scrollbar-hide`) **하단 페이드**로 "더 있음"을 알린다(원장 2026-07-27 지시).
 *   페이드는 넘칠 때만 — 안 넘치는 카드에 걸면 마지막 학생 이름이 괜히 흐려진다.
 */
function RosterSection({
  h,
  rows,
  count,
  className,
  dropId,
  children,
}: {
  h: number;
  rows: number;
  count: number;
  className: string;
  /** 대기·퇴원 칸이면 드롭 대상 id — 없으면(재원) 그냥 목록이다. */
  dropId?: string;
  children: React.ReactNode;
}) {
  // 🔴 훅은 이른 반환보다 **앞에** — 조건부로 부르면 훅 순서가 깨진다.
  const { setNodeRef, isOver } = useDroppable({ id: dropId ?? "roster-drop:none", disabled: !dropId });
  if (rows <= 0) return null;
  const overflowing = count > rows;
  return (
    <div
      ref={dropId ? setNodeRef : undefined}
      // 받을 수 있는 칸이라는 신호는 **끌고 있을 때만** 뜬다(평소엔 아무 표시도 없다).
      className={`${className} scrollbar-hide overflow-y-auto p-1 text-sm ${isOver ? "ring-primary ring-2 ring-inset" : ""}`}
      style={{
        height: h,
        // 아래 12px에 걸쳐 서서히 사라지게 — 잘린 이름이 "여기서 끝"으로 안 읽히도록.
        ...(overflowing
          ? {
              maskImage: "linear-gradient(to bottom, #000 calc(100% - 12px), transparent)",
              WebkitMaskImage: "linear-gradient(to bottom, #000 calc(100% - 12px), transparent)",
            }
          : null),
      }}
    >
      {children}
    </div>
  );
}

/** 담임 이름 뒤 `(영어이름)` — 한국인 강사이고 닉네임이 등록돼 있을 때만. 원어민·미등록은 안 그린다. */
function TeacherNick({ name, map }: { name: string; map?: TeacherNicknameMap }) {
  const nick = map?.[name];
  return nick ? <span className="text-xs font-bold opacity-85">({nick})</span> : null;
}

function DayHead({ day }: { day: DayOfWeek }) {
  const weekend = day === "sat" || day === "sun";
  return (
    <div
      className={`${GRID} flex items-center justify-center border-r text-xs font-bold last:border-r-0 ${
        weekend ? "text-rose" : "text-text-dim"
      }`}
    >
      {enumDayToKo(day)}
    </div>
  );
}

function Cell({
  card,
  order,
  day,
  teacherColors,
  last = false,
}: {
  card: RichClassCard;
  order: number;
  day: DayOfWeek;
  teacherColors: TeacherColorMap;
  /**
   * 이 요일이 카드의 마지막 열인가 — 오른쪽 격자선을 뺀다.
   * ⚠️ 예전엔 `last:border-r-0`(CSS)로 됐는데, 칸이 **자리 상자 안**으로 들어가면서 더는 마지막 형제가
   *    아니게 됐다(그대로 두면 마지막 열에만 없던 세로선이 생긴다).
   */
  last?: boolean;
}) {
  const base = `${GRID} h-full flex items-center justify-center overflow-hidden font-bold ${last ? "" : "border-r"}`;
  const c = card.cells[`${order}:${day}`];
  if (!c) return <div className={base} />;
  // 주말 셀은 행 라벨이 그 반의 시각이 아니다(class-grid `weekendSelfShift`) → 툴팁에 실제 시각을 붙인다.
  const tip = c.time ? `${c.label} · ${c.time}` : c.label;
  // 특수 자리(사람 아님) — LAB(603호)=파랑, JJ(305호)=보라. 서로 다른 방이라 색까지 갈라 둔다.
  if (c.isLab) {
    const tone = c.label === LAB_ROOM_LABEL ? "bg-blue-soft text-blue" : "bg-purple-soft text-purple";
    return (
      <div className={`${base} ${tone} ${cellFont(c.label)}`} title={tip}>
        {c.label}
      </div>
    );
  }
  if (!c.label) return <div className={base} title={c.time || undefined} />;
  // 저장된 강사색(ijw) 우선 — 라벨(한글명·영문닉네임)이 users 맵에 있으면 그 hex. 없으면 라벨 해시색.
  const tc = teacherColors[c.label];
  const text = abbrev(c.label);
  const cls = `${base} ${cellFont(text)}`;
  if (tc)
    return (
      <div className={cls} style={{ background: tc.bg, color: tc.text }} title={tip}>
        {text}
      </div>
    );
  return (
    <div className={`${cls} ${SUBJECT_SOLID[teacherColor(c.label)]} text-white`} title={tip}>
      {text}
    </div>
  );
}

/**
 * 셀 강사명 글자 크기 — 칸이 좁으면 줄인다.
 * ⚠️ 한글 이름 배선(2026-07-27) 전엔 라벨이 "Kris"·"Sam" 같은 짧은 닉네임이라 10px 한 줄로 충분했는데,
 * "크리스틴"·"플로렌스"(4자)가 들어오면서 35px 칸에서 **두 줄로 쪼개져** 행 높이가 들쭉날쭉해졌다.
 * 자르지 않고(사람 이름을 클립하면 누군지 모른다) 줄여서 한 줄에 넣는다 — 전체 이름은 title 툴팁에도 있다.
 *
 * ⚠️ 칸 너비는 **어느 카드든 DAY_COL_W 고정**이라(원장 2026-08-11 "dp처럼 주5일 기준") 요일 수로
 * 글자를 키우면 안 된다 — 잠깐 그렇게 뒀다가 폭 고정으로 되돌리며 함께 되돌렸다.
 */
function cellFont(text: string): string {
  if (text.length >= 4) return "text-xs tracking-tight whitespace-nowrap";
  if (text.length === 3) return "text-xs tracking-tight whitespace-nowrap";
  return "text-xs whitespace-nowrap";
}

/**
 * 학생 행 — 신입=빨강·전입=초록·퇴원=진회색 배경+흰 볼드. 클릭=학생 창.
 *
 * 서식은 **기본뷰와 동일**(`이름/학교학년` 한 덩어리, 원장 지시 2026-07-27). 예전엔 통합뷰만
 * `justify-between`으로 이름은 왼쪽·메타는 오른쪽 끝에 작은 흐린 글씨로 떼어 놨고 영문명을
 * 괄호로 덧붙여, 같은 학생이 뷰마다 다르게 보였다. 이름 우선·메타는 뒤에 붙어 잘리는 규약으로 통일.
 * ⚠️ 영문명은 행에서 뺐지만 hover 카드(StudentInfoCard)엔 그대로 있어 정보 손실은 없다.
 */
function RosterRow({
  s,
  classId,
  cardName,
}: {
  s: GridStudent;
  /** 이 줄이 속한 반 — 드롭 판정(같은 반인지)과 확인 팝업 문구에 쓴다. */
  classId?: string;
  cardName?: string;
}) {
  const withdrawn = s.status === "withdrawn";
  // 명단 이동(대기/퇴원 드롭) — 권한이 있고 **아직 살아 있는 수강**만 집는다(퇴원 줄은 끝난 기록이다).
  // ⚠️ 훅은 분기와 무관하게 항상 같은 순서로 부른다.
  const { enabled } = useRosterMove();
  const rowKey = `rc:${s.enrollmentId ?? s.studentId ?? ""}`;
  const armed = useIsArmedRow(rowKey);
  // 터치·펜엔 hover가 없어 무장이 안 걸린다 → 그 기기에선 모든 줄을 무장한다(기본뷰와 같은 규약).
  const touch = useTouchCapable();
  const movable = enabled && !withdrawn && !!s.enrollmentId && !!classId;
  const colorMode = useTimetableColorMode();
  // 재원/대기는 기본뷰와 **같은 tone 헬퍼**(색 강도 모드 반영). 예전엔 여기서 pastel 색을 손으로 박아
  // 뷰 설정 '색 강도'를 바꿔도 통합뷰만 안 따라왔다. 퇴원은 통합뷰에만 있는 섹션이라 전용 tone 유지.
  const baseTone = withdrawn ? withdrawnTone(colorMode) : timetableStudentTone(colorMode, s);
  // 검색에 걸린 학생 표식 — 기본뷰 StudentRow와 같은 함수(같은 필드로 판정, 같은 클래스로 표시).
  const tone = useSearchTone(s, baseTone);
  const meta = schoolGradeLabel(s.school, s.grade);
  // 기본뷰 StudentRow와 같은 조립 — 이름이 먼저, 메타는 `/`로 붙어 좁으면 메타부터 잘린다(생략부호 없이 clip).
  const inner = (
    <>
      {s.name}
      {/* 학교·학년 꼬리는 한 단계 작게(14px, v5 바닥) — 이름은 그대로 두고 꼬리만 줄여 좁은 2요일 카드에서도 덜 잘린다. */}
      {meta ? <span className="text-xs opacity-90">/{meta}</span> : null}
    </>
  );
  // ⚠️ 클래스 문자열도 기본뷰 StudentRow와 동일하게 유지할 것(px-2 py-[3px] leading-tight + hover:bg-bg-soft).
  //    글자 크기는 명단 컨테이너의 text-sm에서 상속 — 기본뷰 class-cell과 같은 값이다.
  const cls = `block overflow-hidden whitespace-nowrap text-clip px-2 py-[3px] leading-tight ${tone}`;
  const nameNode = s.studentId ? (
    <WindowLink openOn="doubleClick" href={`/students/${s.studentId}`} title={s.name} ariaLabel={`${s.name} 학생 정보`} className={`${cls} hover:bg-bg-soft`}>
      {inner}
    </WindowLink>
  ) : (
    <div className={cls}>{inner}</div>
  );
  const trigger = movable ? (
    <MovableRosterRow
      armed={armed || touch}
      rowKey={rowKey}
      drag={{
        enrollmentId: s.enrollmentId!,
        studentId: s.studentId,
        classId: classId!,
        className: cardName ?? "",
        name: s.name,
        meta,
        tone,
        from: s.status === "hold" ? "hold" : "active",
      }}
    >
      {nameNode}
    </MovableRosterRow>
  ) : (
    nameNode
  );
  return (
    <HoverCard
      width={240}
      card={
        <StudentInfoCard
          name={s.name}
          englishName={s.englishName}
          grade={s.grade}
          school={s.school}
          status={s.status}
          isNew={s.isNew}
          isTransferredIn={s.isTransferredIn}
          enrollmentDate={s.enrollmentDate}
          attendanceDays={s.attendanceDays}
          endDate={s.endDate}
          textbook={s.latestTextbook}
          report={s.latestReport}
        />
      }
    >
      {trigger}
    </HoverCard>
  );
}
