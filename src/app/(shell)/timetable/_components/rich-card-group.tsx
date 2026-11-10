"use client";
import { useTimetableDisplay } from "@/features/teacher-view/use-timetable-display";
import { useTimetableText } from "@/features/teacher-view/use-timetable-text";
import { tipProps } from "@/components/hover-tip/tip";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { GripVertical } from "@/components/icons/aywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { SUBJECT_SOLID } from "@/features/owner/subjects";
import { type DayOfWeek } from "@/features/timetable/lib/periods";
import { LAB_ROOM_LABEL, type TeacherNicknameMap } from "@/features/timetable/lib/teacher-label";

import { readableTextColor } from "@/lib/color-utils";
import {
  padCardDays,
  teacherColor,
  type GridCell,
  type GridStudent,
  type RichCardGroup,
  type RichClassCard,
  type TeacherColorMap,
} from "@/features/timetable/lib/class-grid";
import { ClassInfoCard, HoverCard, StudentInfoCard } from "./hover-cards";
import { useClassFilter, useSearchTone } from "./search-context";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { holdTone, movingTone, timetableStudentTone, useTimetableColorMode, withdrawnTone } from "./timetable-color";
import { holdArmedRow, setArmedRow, useIsArmedRow, useTouchCapable } from "./drag-flag";
import { rosterDropId, useRosterMove, type RosterDragData, type RosterDropData } from "./roster-move";
// ⚠️ `movedCellBox` — 접힌 칸이 아래 행의 가로선을 덮던 것(2026-09-09). 기하는 row-span 단일 소스에 있다.
import {
  movedByTarget,
  movedCellBox,
  movedCellStartsOnRowLine,
  visibleSpanRows,
} from "@/features/timetable/lib/row-span";
import { useTimetableEdit, type IncomingStudent, type PendingTarget } from "./edit-context";
import { shortMoveDate } from "@/features/timetable/lib/move-date";
import { moveWaitTitle, savedMoveView } from "@/features/timetable/lib/move-note";
import { SEAT_PIN_MARK_CLASS } from "@/features/timetable/lib/seat-pin-mark";
// '따로 수업(*LAB)' 표식(원장 2026-09-17) — 수업설정에 있는 LAB 교시. 아래 임시 칸과 글자는 같고 모양이 다르다.
import {
  LAB_SEPARATE_LABEL,
  LAB_SEPARATE_STUDENT_CLASS,
  LAB_SEPARATE_TEXT_CLASS,
  LAB_SEPARATE_TIP,
  labSeparateMetaClass,
} from "@/features/timetable/lib/lab-separate";
// *LAB 임시 칸(원장 2026-09-11) — 판정은 서버가 끝냈고 여기선 **어디에 그릴지**와 서식만(단일 소스).
import {
  borrowFromRoster,
  NO_VIRTUAL_LAB_PLACEMENT,
  placeVirtualLabs,
  VIRTUAL_LAB_CELL_CLASS,
  VIRTUAL_LAB_LABEL,
  virtualLabNoteEn,
  type VirtualLabCell,
  type VirtualLabsByClass,
} from "@/features/timetable/lib/virtual-lab";
// 🔴 학생 드래그 빗금은 **반 단위**라 카드가 자기 id를 DOM에 달아 둔다(기본뷰 셀과 같은 표식·같은 CSS).
//    좌표(요일·시각)는 화면에 안 그려지는 숨은 표식이 들고 있다(rich-grid-view.tsx) — 카드 하나에
//    요일·교시가 여럿이라 카드 자신은 한 좌표로 답할 수 없다.
import { CLASS_CELL_ID_ATTR, CLASS_CELL_NAME_ATTR } from "@/features/timetable/lib/grid-attrs";

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
 * 전용 강의실 행(34px)을 없앤 대신 헤더가 늘고, 그만큼을 카드마다 회수한다.
 *
 * 🔴 2026-09-09: 54px이던 값이 **타입 스케일 v5를 안 따라와** 강의실 글자를 테두리가 가로질렀다
 *    (원장 캡처: *"이거 화금에 줄이 지나가는데"* — `화금 303 / 수 604`를 border-b가 관통).
 *    크롬 실측: 반 이름 두 줄(`text-sm` 16px × leading-tight 1.25 = 20px × 2 = 40) + 간격 2 +
 *    강의실 한 줄(`text-xs` 14px × 1.25 = 17.5) = **59.5px** → 54px 칸에서 5.5px이 넘쳤다.
 *    바로 위 `PERIOD_H`가 같은 이유로 26→32가 된 것과 **같은 계열의 결함**이다(고정 높이가 글자
 *    상승을 안 따라옴). ⚠️ 헤더의 글자 크기·줄 수를 바꾸면 이 값도 함께 재어 올릴 것.
 * ⚠️ 왼쪽 교시 축(`PeriodRail`)이 **같은 상수**를 쓰므로 여기만 고치면 두 열의 줄이 함께 맞는다.
 */
const NAME_ROOM_H = 60;
const TEACHER_H = 24;
const DAYHEAD_H = 22;
/**
 * 교시 한 행의 높이 — 라벨 열이 **두 줄**(`2교시` + `16:20~18:10`, 각 14px `leading-none`)을 담는다.
 * 🔴 2026-09-08: 26px이던 값이 타입 스케일 v5(라벨 12→14px)를 안 따라와 두 줄 28px이 넘쳐 **아래 행 글자와
 *    겹쳤다**(실브라우저 캡처: `16:20~18:10`과 `3교시`가 포개짐). 카드 쪽 미니격자·이동 오버레이도 같은 값을
 *    쓰므로 여기 하나만 올리면 줄이 함께 맞는다. ⚠️ 라벨 글자 크기를 바꾸면 이 값도 같이.
 */
const PERIOD_H = 32;
// 학생 1행 높이 — 기본뷰 StudentRow 실측(13px × leading-tight + py-[3px] = 23.1px)에 맞춘 값.
// ⚠️ 서식을 기본뷰와 동일하게 두는 한 이 값도 함께 따라가야 한다(안 그러면 행이 잘린다).
/**
 * 학생 한 줄의 높이 — **실제 줄 높이와 같아야 한다**(명단 섹션 높이가 `줄 수 × 이 값`이라서).
 * 🔴 2026-09-08: 24px이던 값이 타입 스케일 v5(명단 글자 `text-sm` 14→16px)를 안 따라와, 실제 줄(16 × 1.25
 *    + `py-[3px]` 6 = 26px)보다 작아졌다 → 섹션이 학생을 **반 줄에서 잘랐다**(원장 캡처: 이름이 가로로 잘린 채 끝남).
 * ⚠️ 줄의 글자 크기나 세로 여백을 바꾸면 **이 값도 같이** 바꿀 것(둘이 갈리면 또 잘린다).
 */
const STU_H = 26;
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
/**
 * 배치 편집(그룹 설정) 카드의 **최소 폭** — 이 아래로는 안 줄인다.
 * 실측 기준: 가장 긴 반 이름 `중등E_초등 브릿지 C2`(14자)가 두 줄로 접혀 읽히는 폭. 더 줄이면 이름이
 * 세 줄이 되어 줄 높이가 튀고, 그때는 스크롤이 없어진 대신 아무것도 못 읽는다.
 */
const EDIT_CARD_MIN_W = 116;
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
   * 통합뷰 **\*LAB 임시 칸**(반 id → 칸, 원장 2026-09-11) — 자리 출석부에서 다른 시간 랩실로 옮겨 앉는 학생 때문에
   * 서는 표시 전용 칸. 판정은 서버([`virtual-lab.ts`](../../../../features/timetable/lib/virtual-lab.ts))가 끝냈다 —
   * 카드는 **어디에 그릴지**만 정한다(`placeVirtualLabs`).
   * 🔴 카드 칸(`card.cells`)·교시축(`group.periodRows`)에 섞지 않는다 — 인원·드래그·엑셀이 이 칸을 모르게.
   */
  virtualLabs?: VirtualLabsByClass;
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
  hidePeriods = false,
  virtualLabs,
}: {
  group: RichCardGroup;
  subjectSoftClass: string;
  teacherColors: TeacherColorMap;
  /** 담임 줄 `한글이름(영어이름)` 표기용(영어 시간표). 미지정=이름만. */
  teacherNicknames?: TeacherNicknameMap;
  /** *LAB 임시 칸(반 id → 칸) — ColumnCommon.virtualLabs 주석 참조. 미지정=없음. */
  virtualLabs?: VirtualLabsByClass;
  /** 편집 모드 — 열을 dnd 훅 컴포넌트로 감싸 그린다(key도 호출부가 준다). 미지정=평소 렌더. */
  renderCard?: (card: RichClassCard, common: ColumnCommon) => ReactNode;
  /** 마지막 열 뒤에 붙는 칸(편집 모드의 '맨 뒤에 놓기' 자리). 미지정=없음. */
  trailing?: ReactNode;
  /** 수업명 행만(배치 편집) — ColumnCommon.namesOnly 주석 참조. */
  namesOnly?: boolean;
  /** '학생 명단 접기'(뷰 설정) — 명단 섹션을 통째로 안 그린다(카드가 그만큼 낮아진다). */
  hideStudents?: boolean;
  hidePeriods?: boolean;
}) {
  // 섹션 안에서는 모든 카드가 같은 높이(행이 맞물려 시트처럼 읽힌다) — 높이는 그 섹션의 최대 인원.
  // '학생 명단 접기'면 세 섹션을 0행으로 — 높이·라벨·행이 **같은 값 하나**를 보므로 카드와 라벨열이 어긋나지 않는다.
  /**
   * 🔴 **전입 예정 미리보기가 들어갈 자리를 함께 잡는다** — 안 잡으면 대기 0명인 줄에서는 대기 섹션 자체가
   *    안 그려져(`rows <= 0` → null) 예약 이동 미리보기가 **통째로 안 보인다**(끌어다 놓았는데 아무 일도
   *    안 일어난 것처럼 보인다 — 원장 2026-09-09 제보의 그 증상).
   * 🔑 큐가 비면 더하는 값이 0이라 **평소 화면은 한 픽셀도 안 바뀐다**(편집 중에만 자란다).
   * ⚠️ 라벨열도 같은 값(`activeH`·`holdH`)을 쓰므로 두 열의 줄이 함께 맞는다.
   * ⚠️ '학생 명단 접기'면 그대로 0 — 접어 둔 화면에 미리보기만 튀어나오면 접은 뜻이 사라진다(툴바가 대신 알린다).
   */
  const { incomingByClass } = useTimetableEdit();
  const extraRows = (kind: "now" | "later") =>
    hideStudents
      ? 0
      : group.cards.reduce(
          (max, c) =>
            Math.max(
              max,
              (incomingByClass.get(c.classId) ?? []).filter((s) =>
                kind === "later" ? s.landsInHold : !s.landsInHold,
              ).length,
            ),
          0,
        );
  const baseRows = hideStudents ? { active: 0, hold: 0, withdrawn: 0 } : group.rosterRows;
  const rosterRows = {
    active: baseRows.active + extraRows("now"),
    hold: baseRows.hold + extraRows("later"),
    withdrawn: baseRows.withdrawn,
  };
  const activeH = sectionH(rosterRows.active);
  const holdH = sectionH(rosterRows.hold);
  const wdH = sectionH(rosterRows.withdrawn);
  const common: ColumnCommon = { group, subjectSoftClass, teacherColors, teacherNicknames, activeH, holdH, wdH, rosterRows, hideStudents, namesOnly, virtualLabs };
  // 학생 검색 — 걸린 반만 남긴다. 섹션 높이(rosterRows)는 그룹 전체 기준 그대로라 남은 카드의 행이
  // 어긋나지 않는다.
  // 🔴 **배치 편집(renderCard)에선 절대 안 거른다** — 끌어 옮기는 화면에서 반이 사라지면 배치가
  //    깨진다. page가 그 모드에선 검색을 아예 안 열지만(enabled=false), 여기서도 못박아 둔다
  //    (멀리 있는 플래그 하나에만 기대면 나중에 조용히 뒤집힌다).
  const classVisible = useClassFilter();
  const cards = renderCard ? group.cards : group.cards.filter((c) => classVisible(c.classId));

  return (
    // 🔴 배치 편집엔 `barX`를 걸지 않는다 — `overflow-x: scroll`은 **넘치지 않아도 트랙을 예약**해서
    //    꽉 찬 thumb의 **가짜 스크롤바**가 줄마다 남는다([[#87]]). 원장 캡처에서 다 들어가는 줄(2·3·6)에도
    //    바가 그려져 있던 게 그것이다. 넘침 판정은 브라우저에 맡긴다(auto).
    // 🔴 배치 편집(namesOnly)에는 **팬도** 걸지 않는다 — 카드를 끌어 줄을 바꾸는 모드라 같은 포인터를
    //    다툰다(기본뷰·강사뷰와 같은 규약, 원장 2026-09-09). 읽기 모드는 끌어 옮길 것이 없어 그대로 둔다.
    <DragScrollArea barX={!namesOnly} pan={!namesOnly} className={`${GRID} border-t ${hidePeriods ? 'timetable-periods-hidden' : ''}`}>
      {/* 🔴 배치 편집은 `w-max`가 아니라 **화면 폭**이다 — w-max면 카드가 제 폭을 고집해 flex가 안 줄어든다. */}
      <div className={`flex items-stretch ${namesOnly ? "w-full" : "w-max"}`}>
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
  const tt = useTimetableText();
  const cell = `${GRID} text-text-dim flex items-center justify-center border-b text-xs font-bold`;
  const rail = `bg-bg-soft ${GRID} sticky left-0 z-20 flex shrink-0 flex-col self-stretch border-r shadow-[4px_0_10px_-6px_rgba(29,29,31,0.18)]`;
  if (namesOnly)
    return (
      <div className={rail} style={{ width: LABEL_W }}>
        <div className={cell} style={{ height: NAME_H }}>{tt("수업명")}</div>
      </div>
    );
  return (
    <div className={rail} style={{ width: LABEL_W }}>
      {/* 강의실 라벨은 없앴다 — 카드 쪽에서 수업명 아래 둘째 줄로 들어가 별도 행이 사라졌다(NAME_ROOM_H). */}
      <div className={cell} style={{ height: NAME_ROOM_H }}>{tt("수업명")}</div>
      <div data-timetable-period-section className={cell} style={{ height: TEACHER_H }}>{tt("담임")}</div>
      {/* 축 이름도 '시간'이다(원장 2026-09-12) — 아래 칸이 교시 번호 없이 시각만 적으므로 머리만 '교시'면 어긋난다. */}
      <div data-timetable-period-section className={cell} style={{ height: DAYHEAD_H }}>{tt("시간")}</div>
      {visibleSpanRows(group.periodRows, group.rowPlan).map((p) => (
        <div
          key={p.order}
          data-timetable-period-section
          className={`${GRID} text-text-faint flex flex-col items-center justify-center border-b num leading-none`}
          style={{ height: PERIOD_H }}
        >
          {/* 🔴 교시 **이름은 적지 않는다 — 시각만**(원장 2026-09-12 *"수학 통합뷰에 교시표시 없애고 시간만"*).
              통합뷰는 과목이 한 표에 섞이는데 교시 번호 체계가 과목마다 달라(영어 6교시 14:00 · 수학 3교시 18:20)
              시각 순으로 세우면 번호가 거꾸로 보인다 — 번호가 거짓 신호였다.
              🔴 시각은 **한 줄**이다(원장 2026-08-14 *"시간 표시하는 열너비 조금만 넓혀서 두줄 안되도록"* — LABEL_W 104와
                 `nowrap`이 짝이다). 기본뷰 교시 열은 두 줄이지만 그쪽은 칸이 좁아서고, 여기선 쪼개면 옛 지시를 되돌리는 꼴이다.
              ⚠️ 주말 섹션·비표준 시각 행은 `time`이 비거나 라벨 자체가 시각이다(class-grid `weekendSelfShift`·`slotPeriodRow` 폴백)
                 — 그때는 가진 값을 그대로 적는다(빈 칸을 만들지 않는다). */}
          <span className="text-foreground text-xs font-bold whitespace-nowrap">{p.time || p.label}</span>
        </div>
      ))}
      {/* 명단을 접으면(activeH 0) 라벨도 없다 — 카드 쪽과 높이가 같아야 줄이 어긋나지 않는다. */}
      {activeH > 0 ? (
        <div className={`text-primary ${GRID} flex items-center justify-center border-b text-xs font-bold`} style={{ height: activeH }}>
          {tt("재원")}</div>
      ) : null}
      {/* 대기·퇴원은 **항상** 선다(원장 2026-09-07) — 카드 쪽 높이와 같아 정렬이 유지된다. */}
      {holdH > 0 ? <div className={cell} style={{ height: holdH }}>{tt("대기")}</div> : null}
      {wdH > 0 ? (
        <div className={`${GRID} text-text-dim flex items-center justify-center text-xs font-bold`} style={{ height: wdH }}>
          {tt("퇴원")}</div>
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
  virtualLabs,
  edit,
}: ColumnCommon & {
  card: RichClassCard;
  /** 있으면 편집 모드 — 헤더가 '반 창 열기 링크'가 아니라 **드래그 손잡이**가 된다. */
  edit?: ColumnEdit;
}) {
  const display = useTimetableDisplay();
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
  /**
   * 교시 order → **그 행이 적는 시각**('다른 시각' 표식의 판정 기준).
   * 🔴 `gridRows`가 아니라 **섹션 축 전체**(`group.periodRows`)에서 만든다 — 접힌 칸은 감춰진 행(`m.from`)에
   *    속하는데 그 행은 `gridRows`에 없어서, 여기서 찾으면 접힌 칸의 판정이 통째로 빠진다.
   */
  const rowTimeByOrder = new Map(group.periodRows.map((r) => [r.order, r.time] as const));
  // *LAB 임시 칸 — 격자 안(그 교시 행이 있고 칸이 비어 있을 때) / 격자에 자리가 없으면 **이 카드에만** 아래 행.
  // 배치 편집(수업명만)엔 격자가 없어 그리지 않는다. 판정은 서버가 끝냈다 — 여기선 자리만 정한다.
  const cardLabs = namesOnly ? undefined : virtualLabs?.[card.classId];
  const labs = cardLabs?.length
    ? placeVirtualLabs({ labs: cardLabs, cells: card.cells, rows: gridRows, plan: group.rowPlan })
    : NO_VIRTUAL_LAB_PLACEMENT;
  // 카드 폭 = 요일 수 × 고정 칸 폭(DAY_COL_W). 배치 편집(namesOnly)은 격자를 안 그리므로 5칸 기준 폭 유지 —
  // 수업명만 남은 칩이 요일 수에 따라 들쭉날쭉하면 끌어 놓을 자리를 가늠하기 어렵다.
  // 🔴 카드 **최소 폭 = 3칸**(144px) — padCardDays가 못 채우는 주말 전용 반(토·일 하루)은 1칸(48px)이라 학생 이름이 통째로
  //    잘렸다(실측 2026-09-04 수학 통합뷰 20줄). 칸은 `1fr`이라 폭이 남으면 요일 칸이 그만큼 넓어질 뿐 정렬은 안 깨진다.
  const cardW = namesOnly ? CARD_W : Math.max(3, days.length) * DAY_COL_W + (display.lang === "en" ? 30 : 0);
  /**
   * 배치 편집(그룹 설정)에서는 카드 폭을 **화면에 맞춰 줄인다**(원장 2026-09-09: *"수업당 열너비가 너무
   * 넓어서 화면을 넘어가서 이동시키기가 매우 안좋아 … 하단에 스크롤이 없으면 좋겠다"*).
   * 🔴 여기서만 유연하다 — 통합뷰 본체는 카드 안에 요일 격자·명단이 들어가 폭이 곧 **데이터 크기**라
   *    줄이면 학생 이름이 잘린다(2026-09-08에 한 글자분 넓혔던 그 이유). 배치 편집은 수업명 칩뿐이라
   *    좁아져도 잃는 정보가 없다.
   * ⚠️ 하한(`EDIT_CARD_MIN_W`)은 지킨다 — 한 줄에 반이 많으면 결국 스크롤이 돌아오지만, 그때는 이름이
   *    읽히는 게 먼저다(폭을 0까지 줄이면 스크롤이 없어지는 대신 아무것도 못 읽는다).
   */
  const editFlex = namesOnly ? { flex: `1 1 ${EDIT_CARD_MIN_W}px`, minWidth: EDIT_CARD_MIN_W, maxWidth: CARD_W } : null;
  /**
   * 저장 대기 중인 이동 — **카드 하나가 한 번만** 컨텍스트를 구독하고 줄에는 prop으로 내려보낸다.
   * 🔴 줄마다 구독하면(카드당 10~20줄 × 42카드) 큐가 바뀔 때마다 수백 줄이 함께 다시 그려진다
   *    (기본뷰가 픽업 렉으로 겪었던 것과 같은 계열 — drag-flag.ts 주석).
   */
  const { pending: pendingMoves, incomingByClass } = useTimetableEdit();
  const incomingAll = incomingByClass.get(card.classId) ?? [];
  // 🔴 미리보기는 **저장하면 실제로 앉을 자리**에 그린다 — 즉시 이동은 재원, 예약 이동은 대기
  //    (RPC가 새 수강의 start_date를 적용일로 잡고, 명단은 `start > 기준일`을 대기로 읽는다).
  //    자리를 안 가르면 "오늘부터 이 반 학생"이라는 거짓 약속이 된다(원장 2026-09-09 지시의 핵심).
  const incomingNow = incomingAll.filter((s) => !s.landsInHold);
  const incomingLater = incomingAll.filter((s) => s.landsInHold);
  // *LAB 추가 행의 높이는 **이 카드 재원 칸의 남는 자리**에서 빌린다 — 카드 전체 높이가 이웃·라벨열과 같게 남아
  // 대기·퇴원 줄이 어긋나지 않는다. 명단이 가려질 만큼은 안 빌린다(모자라면 그 카드만 길어진다).
  const labBorrow = borrowFromRoster({
    extraH: labs.extraRows.length * PERIOD_H,
    sectionH: activeH,
    usedH: SECTION_PAD + Math.max(1, card.active.length + incomingNow.length) * STU_H,
  });
  // 반 헤더색 — ijw bgColor 우선(인라인), 없으면 과목색 클래스.
  const headerStyle = card.bgColor
    ? { background: card.bgColor, color: card.textColor ?? "var(--ink)" }
    : undefined;

  return (
    <div
      ref={edit?.setNodeRef}
      // 🔴 학생을 끌 때 "이 반엔 못 간다"를 **카드 통째로** 칠한다(빗금 그림은 globals.css 한 곳,
      //    격자 칸과 같은 표식). 판정 단위가 반이라 카드 전체가 막히는 것이 맞다 — 일부만 치면
      //    "다른 칸엔 놓을 수 있나?"로 읽힌다.
      // ⚠️ 좌표(요일·시각)는 여기 안 싣는다 — 카드 하나가 요일·교시 여럿이라 한 좌표로 답할 수 없다.
      //    숨은 좌표 표식은 rich-grid-view.tsx가 슬롯에서 그대로 그린다(같은 `annotateStudentBlocks`가 읽는다).
      {...(namesOnly ? {} : { [CLASS_CELL_ID_ATTR]: card.classId, [CLASS_CELL_NAME_ATTR]: card.className })}
      className={`${CARD_EDGE} flex flex-col ${editFlex ? "" : "shrink-0"} ${edit ? "relative" : ""} ${
        edit?.dragging ? "opacity-35" : ""
      }`}
      style={editFlex ? { ...editFlex, ...edit?.style } : { width: cardW, ...edit?.style }}
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
            title={`${display.className(card.className)} — 끌어서 다른 줄로 옮기기`}
            className="flex h-full w-full cursor-grab items-center justify-center gap-1 px-1 text-center text-sm font-bold select-none active:cursor-grabbing"
          >
            <GripVertical className="size-3 shrink-0 opacity-45" />
            {/* 🔴 칩이 화면에 맞춰 좁아지므로(EDIT_CARD_MIN_W) 이름은 **두 줄까지 접는다** — 한 줄로 두면
                `중등E_초등 브릿지 D`가 말줄임도 없이 글자 중간에서 잘린다(원장 캡처 2026-09-09).
                평소 카드 헤더가 같은 이유로 이미 `line-clamp-2`다 — 같은 규약을 편집 모드에도 맞춘다. */}
            <span className="line-clamp-2 min-w-0 break-keep">{display.className(card.className)}</span>
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
              href={`/classes/${card.classId}`}
              title={card.className}
              ariaLabel={`${card.className} 반 정보`}
              className="flex h-full w-full flex-col items-center justify-center gap-0.5 px-1 text-center transition hover:brightness-95"
            >
              {/* 이름은 **두 줄까지** 접는다 — 칸 너비를 고정하면서(DAY_COL_W) 2요일 반 카드가 70px까지
                  좁아져 한 줄로는 `고등E_고1 특별 S` 같은 이름이 통째로 잘린다. 전체 이름은 title에도 있다. */}
              <span className="line-clamp-2 w-full text-sm leading-tight font-bold break-keep">
                {display.className(card.className)}
              </span>
              {/* 강의실 — 전용 행 대신 수업명 바로 아래(원장 2026-08-11 "LS6 / 화 602 / 금 603 이렇게").
                  헤더색 위에 얹히므로 색을 따로 주지 않고 투명도만 낮춘다(반색이 어두우면 흰 글자가 유지된다).
                  ⚠️ namesOnly(배치 편집)에선 헤더가 NAME_H(40px)로 좁아 두 줄이 안 들어간다 → 안 그린다. */}
              {namesOnly ? null : (
                <span className="line-clamp-1 w-full text-xs leading-tight font-normal opacity-70" title={card.classroomLabel}>
                  {display.room(card.classroomLabel)}
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
      <div data-timetable-period-section className={`${GRID} flex min-w-0 items-center justify-center overflow-hidden border-b`} style={{ height: TEACHER_H }}>
        {!card.teacherName ? (
          <span className="text-text-faint text-xs">-</span>
        ) : (
          <span className="text-foreground overflow-hidden text-xs font-bold whitespace-nowrap text-clip">
            {display.teacher(card.teacherName)}
            <TeacherNick name={card.teacherName} map={teacherNicknames} />
          </span>
        )}
      </div>
      {/* 요일 헤더 — 이 반이 실제 수업하는 요일만(빈 열 없음). */}
      <div data-timetable-period-section className={`${GRID} grid border-b`} style={{ ...gridCols, height: DAYHEAD_H }}>
        {days.map((d) => (
          <DayHead key={d} day={d} />
        ))}
      </div>
      {/* 요일×교시 미니그리드 — 행은 섹션이 실제 쓰는 교시만(keepUsedRows). */}
      {gridRows.map((p) => (
        <div key={p.order} data-timetable-period-section className={`${GRID} grid border-b`} style={{ ...gridCols, height: PERIOD_H }}>
          {days.map((d, di) => (
            // 칸 하나가 **한 칸보다 길 수 있다**(60분 수업 = 40분 눈금 1.5칸) → 요일마다 자리 상자를 두고
            // 접힌 칸을 그 안에 절대배치한다. 넘치는 부분은 아래 행 위로 그려진다(그 자리는 어차피 빈 칸이다).
            <div key={d} className="relative h-full">
              {/* *LAB 임시 칸 — 그 칸이 비어 있을 때만 격자 안에 앉는다(자리는 placeVirtualLabs가 정했다). */}
              {labs.inGrid[`${p.order}:${d}`] ? (
                <VirtualLabCellView lab={labs.inGrid[`${p.order}:${d}`]!} last={di === days.length - 1} />
              ) : (
                <Cell
                  card={card}
                  order={p.order}
                  day={d}
                  teacherColors={teacherColors}
                  last={di === days.length - 1}
                  // 이 행이 **화면에 적는** 시각 — 라벨열(`p.time || p.label`)과 같은 값이라야 표식이 거짓이 안 된다.
                  rowTime={p.time}
                />
              )}
              {(moved.get(p.order) ?? []).map((m) => {
                const mc = card.cells[`${m.from}:${d}`];
                if (!mc) return null;
                // 🔴 **칠할 게 있는 칸에만** 바탕·테두리를 준다 — 라벨도 자리도 없는 칸은 `Cell`이
                //    배경 없이 테두리만 그리므로(아래 `cellPaintsBackground`), 바탕을 깔면 1.5행이
                //    **흰 구멍**이 되어 그 열의 교시선만 사라진다(담임 미지정 신설 반에서 난다).
                const paints = cellPaintsBackground(mc);
                return (
                  <div
                    key={m.from}
                    // 🔴 `bg-card` = **불투명 바탕**. 접힌 칸은 제 span 안쪽 교시선을 덮는 게 규약인데
                    //    (60분 수업 가운데를 선이 가로지르면 두 칸으로 읽힌다), 자리 칸(JJ·LAB)만
                    //    `bg-*-soft`(알파 0.12)라 아래 선이 그대로 비쳐 **색에 따라 규약이 갈렸다**
                    //    (원장 2026-09-10 *"JJ에서는 가로선이 보이는데, 왜 전양원 위로는 안보이지?"*).
                    //    바탕을 깔면 반투명 색이 카드 흰 바탕 위에 얹혀 색은 그대로, 선만 사라진다([[#74]]).
                    // 🔴 `border-t` = 행 한가운데서 시작하는 칸만 **제 위 경계를 직접** 긋는다
                    //    (행 머리에서 시작하는 칸은 격자가 이미 그었다 — 둘 다 그으면 2px).
                    className={`absolute inset-x-0 z-[1] ${paints ? "bg-card" : ""} ${
                      paints && !movedCellStartsOnRowLine(m) ? `${GRID} border-t` : ""
                    }`}
                    // 상자는 `movedCellBox`가 정한다 — 행 경계에서 끝나는 칸은 그 행 구분선(1px) 자리를
                    // 비워 준다(안 비우면 겹쳐 그린 칸이 선을 덮어 그 줄만 가로선이 사라진다).
                    style={movedCellBox(m, PERIOD_H)}
                  >
                    {/* 접힌 칸도 **자기 행(`m.from`)의 시각 자리**에 앉으므로(`movedCellBox`) 판정 기준은 그 행의
                        시각이다. 평일 칸은 그 값이 곧 제 시각이라 표식이 안 뜨고, lift된 주말 칸은 어긋난 채로
                        접힌 행에 앉으니 **떠야 한다** — 안 넘기면 정당한 표식이 조용히 빠진다(재리뷰 2026-09-14). */}
                    <Cell
                      card={card}
                      order={m.from}
                      day={d}
                      teacherColors={teacherColors}
                      last={di === days.length - 1}
                      rowTime={rowTimeByOrder.get(m.from)}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}
      {/* *LAB 임시 칸 중 격자에 자리가 없는 것 — **이 카드에만** 행을 더한다(섹션 교시축·다른 카드는 그대로).
          라벨열엔 이 행이 없으므로 칸이 제 시각을 함께 적는다. 높이는 아래 재원 칸의 남는 자리에서 빌린다(labBorrow). */}
      {labs.extraRows.map((r) => (
        <div
          key={`vlab:${r.start}`}
          data-timetable-period-section
          data-virtual-lab-row=""
          className={`${GRID} grid border-b`}
          style={{ ...gridCols, height: PERIOD_H }}
        >
          {days.map((d, di) => {
            const lab = r.cells[d];
            const last = di === days.length - 1;
            return lab ? (
              <VirtualLabCellView key={d} lab={lab} last={last} withTime />
            ) : (
              <div key={d} className={`${GRID} h-full ${last ? "" : "border-r"}`} />
            );
          })}
        </div>
      ))}
      {/* 재원생 — 섹션 최대 인원(상한 12행). 넘치면 카드 안에서 스크롤하되 스크롤바는 숨기고 하단 페이드.
          🔴 **다른 반에서 끌어온 학생을 받는 칸**이기도 하다(원장 2026-09-09 "드래그 이동") — 대기·퇴원과
             달리 이 칸은 *남의 반* 학생을 받는다. */}
      <RosterSection
        h={activeH - labBorrow}
        rows={rosterRows.active}
        count={card.active.length + incomingNow.length}
        className={`bg-card ${GRID} border-b`}
        drop={{ classId: card.classId, className: card.className, kind: "active" }}
      >
        {card.activeCount === 0 && incomingNow.length === 0 ? (
          <EmptyDash />
        ) : (
          card.active.map((s, i) => (
            <RosterRow
              key={s.studentId ?? `a-${i}`}
              s={s}
              classId={card.classId}
              cardName={card.className}
              move={pendingMoves.get(s.enrollmentId ?? "")}
            />
          ))
        )}
        {incomingNow.map((s) => (
          <IncomingRow key={`in-${s.enrollmentId}`} s={s} toClassName={card.className} />
        ))}
      </RosterSection>
      <RosterSection
        h={holdH}
        rows={rosterRows.hold}
        count={card.hold.length + incomingLater.length}
        className={`bg-bg-soft ${GRID} border-b`}
        drop={{ classId: card.classId, className: card.className, kind: "hold" }}
      >
        {card.hold.length === 0 && incomingLater.length === 0 ? (
          <EmptyDash />
        ) : (
          card.hold.map((s, i) => (
            <RosterRow
              key={s.studentId ?? `h-${i}`}
              s={s}
              classId={card.classId}
              cardName={card.className}
              move={pendingMoves.get(s.enrollmentId ?? "")}
            />
          ))
        )}
        {incomingLater.map((s) => (
          <IncomingRow key={`in-${s.enrollmentId}`} s={s} toClassName={card.className} />
        ))}
      </RosterSection>
      {/* 퇴원 — 재원/대기와 동일 서식, 진회색 배경+흰 글자 톤으로 구분 */}
      <RosterSection
        h={wdH}
        rows={rosterRows.withdrawn}
        count={card.withdrawn.length}
        className="bg-bg-soft"
        drop={{ classId: card.classId, className: card.className, kind: "withdrawn" }}
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
      // 🔴 누르는 순간 무장을 잠근다(학생 줄과 같은 규약 — drag-flag.ts `holdArmedRow` 주석).
      onPointerDownCapture={() => holdArmedRow()}
      onPointerOver={() => onArm?.()}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      // 🔴 조작법 안내 툴팁은 뺐다(원장 2026-09-14, 기본뷰 학생 줄과 같은 규약) — 되살리지 말 것.
      //    예약 이동 같은 **사실**은 안쪽 이름 노드(`nameNode`의 `moveTitle`)가 계속 말한다.
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
 * **전입 예정 미리보기 한 줄** — 다른 반에서 끌어와 아직 저장하지 않은 학생(원장 2026-09-09 *"미래에
 * 이동할 반에서는 '대기'생 상태가 되는것"*).
 *
 * 🔴 저장하면 실제로 앉을 자리에 그린다 — 즉시 이동은 **재원**, 예약 이동은 **대기** 칸(호출부가 가른다).
 * 🔴 **저장 전이라는 사실**을 점선으로 말한다 — 예약으로 이미 저장된 줄과 색(연보라)이 같기 때문이다.
 *    문구도 `moveWaitTitle(saved:false)`가 그렇게 적는다(같은 색, 다른 말).
 * ⚠️ 좁은 칸이라 화면엔 이름 + 날짜만 — 어디서 오는지(기존 반)는 툴팁이 말한다(원장 명시).
 */
function IncomingRow({ s, toClassName }: { s: IncomingStudent; toClassName: string }) {
  const tt = useTimetableText();
  return (
    <div
      title={moveWaitTitle({
        side: "in",
        fromClassName: s.fromClassName,
        toClassName,
        on: s.applyOn,
        saved: false,
      })}
      // ⚠️ 테두리는 `border`가 아니라 **`outline`** — border는 줄 높이를 2px 밀어서 섹션이 미리 잡아 둔
      //    높이(`STU_H` × 행 수)를 넘긴다(그만큼 아래 줄이 잘려 보인다). outline은 레이아웃 밖이라 안 민다.
      className={`flex items-baseline justify-between gap-1 overflow-hidden rounded-[2px] px-2 py-[3px] leading-tight whitespace-nowrap outline-1 outline-dashed -outline-offset-1 ${
        s.scheduled ? "bg-purple-soft text-purple outline-purple/50" : "bg-primary-soft text-primary outline-primary/50"
      }`}
    >
      <span className="min-w-0 overflow-hidden text-clip">← {s.name}</span>
      <span className="shrink-0 text-xs font-bold">{s.scheduled ? shortMoveDate(s.applyOn) : tt("반이동")}</span>
    </div>
  );
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
  drop,
  children,
}: {
  h: number;
  rows: number;
  count: number;
  className: string;
  /**
   * 이 칸이 받는 것 — 재원=다른 반에서 오는 학생(반 이동) · 대기/퇴원=같은 반 안의 상태 변경.
   * 🔴 **반 이름까지 싣는다**(id를 쪼개지 말 것) — 거절·팝업 문구가 반 이름을 필요로 한다.
   */
  drop?: RosterDropData;
  children: React.ReactNode;
}) {
  // 🔴 훅은 이른 반환보다 **앞에** — 조건부로 부르면 훅 순서가 깨진다.
  const { setNodeRef, isOver, active } = useDroppable({
    id: drop ? rosterDropId(drop.classId, drop.kind) : "roster-drop:none",
    data: drop,
    disabled: !drop,
  });
  /**
   * 🔴 **받을 수 없는 드래그엔 링을 켜지 않는다** — 재원 칸은 *남의 반* 학생만 받고, 대기·퇴원 칸은
   *    *제 반* 학생만 받는다. 안 가르면 놓을 수 없는 자리가 "여기 놓으세요"로 빛나고, 놓으면 아무 일도
   *    안 일어나 고장으로 읽힌다(원장 2026-09-08 *"드랍해도 아무런 반응이 없음"*의 반대편 얼굴).
   * ⚠️ 못 가는 반(빗금)까지는 여기서 못 가른다 — 그건 카드 전체를 덮는 빗금이 말한다(같은 드래그, 다른 층).
   */
  const fromClassId = (active?.data.current as { classId?: string } | undefined)?.classId;
  const accepts =
    !!drop && !!fromClassId && (drop.kind === "active" ? fromClassId !== drop.classId : fromClassId === drop.classId);
  if (rows <= 0) return null;
  const overflowing = count > rows;
  return (
    <div
      ref={drop ? setNodeRef : undefined}
      // 받을 수 있는 칸이라는 신호는 **끌고 있을 때만** 뜬다(평소엔 아무 표시도 없다).
      className={`${className} scrollbar-hide overflow-y-auto p-1 text-sm ${isOver && accepts ? "ring-primary ring-2 ring-inset" : ""}`}
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
  const display = useTimetableDisplay();
  if (display.lang === "en") return null;
  const nick = map?.[name];
  return nick ? <span className="text-xs font-bold opacity-85">({nick})</span> : null;
}

function DayHead({ day }: { day: DayOfWeek }) {
  const display = useTimetableDisplay();
  const weekend = day === "sat" || day === "sun";
  return (
    <div
      className={`${GRID} flex items-center justify-center border-r text-xs font-bold last:border-r-0 ${
        weekend ? "text-rose" : "text-text-dim"
      }`}
    >
      {display.dow(day)}
    </div>
  );
}

/**
 * 이 칸이 **제 배경을 칠하나** — 자리(LAB·JJ) 또는 라벨이 있을 때만 칠한다.
 *
 * 🔴 접힌 칸 오버레이가 불투명 바탕(`bg-card`)을 깔지 말지의 **단일 판정**이다. 안 칠하는 칸에 바탕을
 *    깔면 1.5행이 흰 구멍이 되어 그 열의 교시선만 사라진다(칠할 게 없으면 덮을 이유도 없다).
 * ⚠️ 그래서 `Cell`도 이 함수로 갈래를 탄다 — 두 곳에서 따로 판정하면 조용히 갈린다.
 */
function cellPaintsBackground(c: GridCell | undefined): boolean {
  return !!c && (c.isLab || !!c.label);
}

/**
 * **\*LAB 임시 칸** — 그 반 학생이 이 시각에 랩실로 옮겨 앉는다(자리 출석부 교시 이동·고정). 수업설정에 없는 표시 전용 칸.
 * 서식·글자는 [`virtual-lab.ts`](../../../../features/timetable/lib/virtual-lab.ts) 단일 소스(LAB 칸 계열 + 점선·이탤릭
 * = 임시, 바탕 없음). 누가·하루/상시는 툴팁(`lab.note`, 서버가 만든 한글 문장).
 * `withTime` = 이 카드에만 더한 행 — 라벨열에 그 행이 없어 칸이 제 시각을 함께 적는다(두 줄, 행 높이 안).
 */
function VirtualLabCellView({ lab, last, withTime = false }: { lab: VirtualLabCell; last: boolean; withTime?: boolean }) {
  const display = useTimetableDisplay();
  const note = display.lang === "en" ? virtualLabNoteEn(lab, display.dow(lab.dayOfWeek)) : lab.note;
  return (
    <div
      data-virtual-lab=""
      {...tipProps(note)}
      className={`${GRID} flex h-full flex-col items-center justify-center overflow-hidden text-xs leading-none font-bold whitespace-nowrap ${
        last ? "" : "border-r"
      } ${VIRTUAL_LAB_CELL_CLASS}`}
    >
      <span>{VIRTUAL_LAB_LABEL}</span>
      {withTime ? <span className="num font-normal not-italic">{lab.start}</span> : null}
    </div>
  );
}

/**
 * 🔺 **다른 시각 표식** — 이 칸은 **그려진 행의 시각이 아니다**(주말 수업을 그 반의 평일 교시 행으로
 * 끌어올린 것, [class-grid.ts](../../../../features/timetable/lib/class-grid.ts) `liftToWeekday`·
 * `weekendSelfShift`). 토 10:00 수업이 "19:20~20:10" 행에 앉는 식인데, 그건 버그가 아니라 원장 지시로
 * 일부러 만든 동작이라(*"행을 6개가 아닌 3개만"*) **동작은 그대로 두고 사실만 화면에 남긴다.**
 *
 * 🔴 **언제 뜨는지는 `Cell`이 정한다** — 여기는 그리기만 한다. 판정 근거는 그쪽 `offAxisTime` 주석에.
 * 🔴 **칸 안에 시각을 적지 않는다**(원장 2026-09-14: *"마우스오버했을때 시간이 나오면 충분함 … 좌상단에
 *    삼각형같은 메모있음 표시 있으면 된다"*) — 실제 시각은 칸이 이미 가진 툴팁(`tip`)이 말한다.
 * 🔴 색은 **강사뷰의 같은 표식과 같은 빨강**이다([teacher-chip.tsx](./teacher-chip.tsx) `offAxisNote`) —
 *    같은 뜻이면 어느 화면에서든 같은 색이 캐논의 대원칙이다(semantic-color.ts). 한 사실을 두 뷰가
 *    다른 색으로 말하면 그 순간 색이 어휘이기를 멈춘다.
 * 🔴 바탕이 **강사 저장색(임의 hex)**이라 빨강 하나면 짙은 붉은 칸에서 사라진다 → 그쪽과 **같은 장치**로
 *    바탕에서 읽히는 색(`readableTextColor`)을 한 겹 깔고 그 위에 빨강을 얹는다(치수도 9/7px 동일).
 * 🔴 `absolute` + `size-0` — 행 높이(`PERIOD_H`)를 한 픽셀도 건드리면 안 된다(격자가 통째로 어긋난다).
 * ⚠️ `sr-only`는 absolute라 **positioned 부모 안**에 있어야 한다([[#79]]) — 호출부가 칸에 `relative`를 준다.
 */
function OffAxisMark({ time, edge }: { time: string; edge: string }) {
  const tt = useTimetableText();
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 size-0 border-t-[9px] border-r-[9px] border-r-transparent"
        style={{ borderTopColor: edge }}
      />
      <span
        aria-hidden
        className="border-t-danger pointer-events-none absolute top-0 left-0 size-0 border-t-[7px] border-r-[7px] border-r-transparent"
      />
      {/* 표식은 눈에만 보인다 — 같은 사실을 글자로도 남긴다(칸의 기존 툴팁 문구는 그대로 둔다). */}
      <span className="sr-only">{tt("실제 수업 시각")} {time}</span>
    </>
  );
}

function Cell({
  card,
  order,
  day,
  teacherColors,
  rowTime,
  last = false,
}: {
  card: RichClassCard;
  order: number;
  day: DayOfWeek;
  teacherColors: TeacherColorMap;
  /**
   * **이 칸이 앉은 행이 화면에 적는 시각** — 격자 칸은 그 행(`p.time`, 라벨열과 같은 값), 접힌 칸은
   * 제가 속한 감춰진 행(`m.from`)의 시각이다(`movedCellBox`가 그 행의 시각 자리에 앉힌다).
   * 비면(주말 전용 섹션처럼 행이 시각을 아예 안 적으면) 어긋날 것도 없다는 뜻이라 표식이 뜨지 않는다.
   */
  rowTime?: string;
  /**
   * 이 요일이 카드의 마지막 열인가 — 오른쪽 격자선을 뺀다.
   * ⚠️ 예전엔 `last:border-r-0`(CSS)로 됐는데, 칸이 **자리 상자 안**으로 들어가면서 더는 마지막 형제가
   *    아니게 됐다(그대로 두면 마지막 열에만 없던 세로선이 생긴다).
   */
  last?: boolean;
}) {
  const display = useTimetableDisplay();
  const tt = useTimetableText();
  const base = `${GRID} h-full flex items-center justify-center overflow-hidden font-bold ${last ? "" : "border-r"}`;
  const c = card.cells[`${order}:${day}`];
  if (!c) return <div className={base} />;
  // 주말 셀은 행 라벨이 그 반의 시각이 아니다(class-grid `weekendSelfShift`) → 툴팁에 실제 시각을 붙인다.
  const label = display.teacher(c.label) ?? c.label;
  const tip = [c.time ? `${label} · ${c.time}` : label, ...c.notes ?? []].join('\n');
  /**
   * 🔺 **'다른 시각' 표식을 띄울까** — `c.time`만 보면 안 된다(적대 리뷰 2026-09-14에서 잡혔다).
   * `class-grid.ts`는 **주말 셀이면 무조건** `time`을 싣는다("이 칸은 주말 슬롯"이라는 뜻이지
   * "행과 어긋났다"가 아니다). 그대로 쓰면 거짓 표식이 두 갈래로 난다:
   *  ① **주말 전용 섹션** — 행에서 시각을 떼고 "1교시"만 적는데(`groupRichCards`) 전 칸에 삼각형이
   *     깔린다. 행이 시각을 주장하지도 않으니 오독할 것이 없는데 신호만 희석된다.
   *  ② **평일과 같은 시각에 토요일 수업을 하는 반** — `liftToWeekday`가 제자리에 떨어뜨리는데도 붙는다.
   * 🔑 그래서 기준은 **그 행이 화면에 적는 시각**(`rowTime`)이고, 비교는 **시작 시각만** 본다 —
   *    끝만 다른 교시([[#106]] 영어 17건)는 원장이 이번 범위에서 뺐고, 폴백 행은 `time`이 시작 시각
   *    한 토막(`periods.ts` `x-HH:MM`)이라 전체 문자열로 비교하면 그 행이 통째로 거짓 표식이 된다.
   */
  const startOf = (t: string) => t.split("~")[0] ?? "";
  const offAxisTime =
    c.time && rowTime && startOf(rowTime) && startOf(rowTime) !== startOf(c.time) ? c.time : null;
  // 특수 자리(사람 아님) — LAB(603호)=파랑, JJ(305호)=보라. 서로 다른 방이라 색까지 갈라 둔다.
  if (c.isLab) {
    const tone = c.label === LAB_ROOM_LABEL ? "bg-blue-soft text-blue" : "bg-purple-soft text-purple";
    // '따로 수업(*LAB)'(원장 2026-09-17) — LAB 칸 그대로(파란 바탕) + 밑줄·이탤릭. 바탕 없는 점선 `*LAB`(임시 칸)과 다르다.
    const separate = c.labSeparate === true && c.label === LAB_ROOM_LABEL;
    const text = separate ? LAB_SEPARATE_LABEL : c.label;
    return (
      <div
        className={`${base} ${tone} ${cellFont(text)} ${separate ? LAB_SEPARATE_TEXT_CLASS : ""} ${offAxisTime ? "relative" : ""}`}
        title={separate ? (c.time ? `${tt(LAB_SEPARATE_TIP)} · ${c.time}` : tt(LAB_SEPARATE_TIP)) : tip}
      >
        {text}
        {/* 자리 칸은 연한 틴트 바탕이라 테두리는 경계만 만들면 된다(빨강이 이미 또렷하다). */}
        {offAxisTime ? <OffAxisMark time={offAxisTime} edge="#ffffff" /> : null}
      </div>
    );
  }
  // 여기까지 왔으면 `isLab`은 false라 판정은 곧 "라벨이 있나"다 — 오버레이와 **같은 함수**를 탄다.
  if (!cellPaintsBackground(c)) return <div className={base} title={c.time || undefined} />;
  // 저장된 강사색(ijw) 우선 — 라벨(한글명·영문닉네임)이 users 맵에 있으면 그 hex. 없으면 라벨 해시색.
  const tc = teacherColors[c.label];
  const text = abbrev(label);
  const cls = `${base} ${cellFont(text)}`;
  if (tc)
    return (
      <div
        className={`${cls} ${offAxisTime ? "relative" : ""}`}
        style={{ background: tc.bg, color: tc.text }}
        title={tip}
      >
        {text}
        {/* 강사 저장색은 임의 hex다 — 테두리 색을 그 바탕에서 뽑아야 어떤 색을 새로 넣어도 표식이 안 사라진다. */}
        {offAxisTime ? <OffAxisMark time={offAxisTime} edge={readableTextColor(tc.bg)} /> : null}
      </div>
    );
  return (
    <div
      className={`${cls} ${SUBJECT_SOLID[teacherColor(c.label)]} text-white ${offAxisTime ? "relative" : ""}`}
      title={tip}
    >
      {text}
      {/* 해시색은 전부 솔리드 채움 + 흰 글자라 테두리도 흰색(글자와 같은 근거). */}
      {offAxisTime ? <OffAxisMark time={offAxisTime} edge="#ffffff" /> : null}
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
  move,
}: {
  s: GridStudent;
  /** 이 줄이 속한 반 — 드롭 판정(같은 반인지)과 확인 팝업 문구에 쓴다. */
  classId?: string;
  cardName?: string;
  /** 저장 대기 중인 이동(카드가 한 번 읽어 내려보낸다 — 줄마다 컨텍스트를 구독하지 않게). */
  move?: PendingTarget;
}) {
  const display = useTimetableDisplay();
  const withdrawn = s.status === "withdrawn";
  // 명단 이동 — 축이 둘이다: 대기·퇴원(학생 기록 권한) / 다른 반으로 이동(시간표 편집 권한).
  // 🔴 **하나라도** 열려 있으면 줄을 집을 수 있어야 한다(어디에 놓을 수 있는지는 놓는 순간 판정한다).
  // ⚠️ 훅은 분기와 무관하게 항상 같은 순서로 부른다.
  const { enabled, canMoveClass } = useRosterMove();
  const rowKey = `rc:${s.enrollmentId ?? s.studentId ?? ""}`;
  const armed = useIsArmedRow(rowKey);
  // 터치·펜엔 hover가 없어 무장이 안 걸린다 → 그 기기에선 모든 줄을 무장한다(기본뷰와 같은 규약).
  const touch = useTouchCapable();
  const movable = (enabled || canMoveClass) && !withdrawn && !!s.enrollmentId && !!classId;
  const colorMode = useTimetableColorMode();
  // 재원/대기는 기본뷰와 **같은 tone 헬퍼**(색 강도 모드 반영). 예전엔 여기서 pastel 색을 손으로 박아
  // 뷰 설정 '색 강도'를 바꿔도 통합뷰만 안 따라왔다. 퇴원은 통합뷰에만 있는 섹션이라 전용 tone 유지.
  // 퇴원·대기는 **사람에게 붙는 칩**이다(섹션 배경이 아니라) — 원장 2026-09-08 *"대기 셀 색상이 아니고 퇴원생처럼"*.
  const baseTone = withdrawn
    ? withdrawnTone(colorMode)
    : s.status === "hold"
      ? holdTone(colorMode)
      : timetableStudentTone(colorMode, s);
  /**
   * 저장 대기 중인 **반 이동** — 기본뷰 학생 줄과 같은 규약.
   * 🔴 적용일이 미래면 연보라 '이동 대기'(원장 2026-09-09), 오늘이면 종전대로 취소선+화살표.
   * ⚠️ 예약 tone은 **바탕**으로 넘긴다(덧붙이지 않는다) — 검색에 걸리면 검색 표식이 이겨야 하고,
   *    두 클래스를 이어 붙이면 같은 축 유틸이 겹쳐 승자를 CSS 순서가 정한다([[#116]]).
   */
  const moving = !!move && !move.sameClass;
  const scheduledMove = moving && move!.scheduled;
  /**
   * **이미 저장된 예약 이동** — 저장 전 큐(`move`)와 색은 같고 문구가 다르다(`saved: true`).
   * 🔴 지금 끌어 옮기는 중이면(큐) 그쪽이 이긴다 — 사람이 방금 한 일이 화면의 주인공이다.
   */
  const saved = moving ? null : savedMoveView({ status: s.status, movingOut: s.movingOut, movingIn: s.movingIn, thisClassName: cardName ?? "" });
  const waiting = scheduledMove || !!saved;
  // 검색에 걸린 학생 표식 — 기본뷰 StudentRow와 같은 함수(같은 필드로 판정, 같은 클래스로 표시).
  const tone = useSearchTone(s, waiting ? movingTone(colorMode) : baseTone);
  const meta = display.school(s.school, s.grade);
  const shownName = display.student(s.name, s.englishName);
  const moveTitle = moving
    ? moveWaitTitle({
        side: "out",
        fromClassName: cardName ?? "",
        toClassName: move!.toClassName,
        on: move!.applyOn,
        saved: false,
      })
    : (saved?.title ?? "");
  const metaMark = labSeparateMetaClass(s.labSeparate, s.seatPinNote);
  // 기본뷰 StudentRow와 같은 조립 — 이름이 먼저, 메타는 `/`로 붙어 좁으면 메타부터 잘린다(생략부호 없이 clip).
  const inner = (
    <>
      {/* 자리(랩실) 교시 고정 — 기본뷰 학생 줄과 **같은 서식 상수·같은 문구**(뷰마다 다르게 보이면 안 된다). */}
      <span
        className={`${moving && !scheduledMove ? "line-through" : ""}${
          s.seatPinNote ? ` ${SEAT_PIN_MARK_CLASS}` : s.labSeparate ? ` ${LAB_SEPARATE_STUDENT_CLASS}` : ""
        }`}
      >
        {shownName}
      </span>
      {/* 학교·학년 꼬리는 한 단계 작게(14px, v5 바닥) — 이름은 그대로 두고 꼬리만 줄여 좁은 2요일 카드에서도 덜 잘린다.
          🔴 이동 대기 줄은 꼬리 대신 **어디로·언제 가는지**를 적는다(좁은 칸이라 둘 다는 안 들어간다). */}
      {moving ? (
        <span className={`text-xs font-bold ${scheduledMove ? "" : "text-primary"}`}>
          {" "}
          →{scheduledMove ? shortMoveDate(move!.applyOn) : ""}
        </span>
      ) : saved ? (
        // 🔴 방향이 곧 뜻이다 — `→`는 나감, `←`는 들어옴. 날짜는 그 사건이 **언제**인지.
        <span className="text-xs font-bold">
          {" "}
          {saved.side === "out" ? "→" : "←"}
          {shortMoveDate(saved.on)}
        </span>
      ) : meta ? (
        // 🔴 꼬리도 이름과 같은 색·기울기(*LAB 줄은 한 줄 통째로 — 원장 2026-09-18 *"전체를 파랑 및 이탤릭으로"*).
        <span className={`text-xs opacity-90${metaMark ? ` ${metaMark}` : ""}`}>/{meta}</span>
      ) : null}
    </>
  );
  // ⚠️ 클래스 문자열도 기본뷰 StudentRow와 동일하게 유지할 것(px-2 py-[3px] leading-tight + hover:bg-bg-soft).
  //    글자 크기는 명단 컨테이너의 text-sm에서 상속 — 기본뷰 class-cell과 같은 값이다.
  const cls = `block overflow-hidden whitespace-nowrap text-clip px-2 py-[3px] leading-tight ${tone}`;
  const nameNode = s.studentId ? (
    <WindowLink
      href={`/students/${s.studentId}`}
      // 🔴 이동 대기면 **그 사실**이 툴팁이다(기존 반 이름 포함, 원장 2026-09-09 명시).
      title={moveTitle ? display.note(moveTitle) : shownName}
      ariaLabel={display.lang === "en" ? `${shownName}: student details` : `${s.name} 학생 정보`}
      className={`${cls} hover:bg-bg-soft`}
    >
      {inner}
    </WindowLink>
  ) : (
    <div className={cls} title={moveTitle ? display.note(moveTitle) : undefined}>
      {inner}
    </div>
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
        // 출발 시점 등원 요일 — 반 이동의 no-op 판정(같은 반·같은 요일)에 쓰인다(기본뷰 drag data와 같은 칸).
        attendanceDays: s.attendanceDays,
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
          pinNote={s.seatPinNote}
          labSeparate={s.labSeparate === true}
        />
      }
    >
      {trigger}
    </HoverCard>
  );
}
