// 통합뷰(반=열 리치 그리드) 데이터 도출 — ijw EnglishClassTab 이식. 순수 함수(테스트 강제).
// 한 과목 슬롯을 **반(class)별 카드**로 묶고 **시작 교시별 섹션**으로 그룹화. 각 카드:
// 헤더(반명·담임·요일별 강의실) + **요일×교시 미니그리드**(셀마다 강사/특수자리, ijw slotTeachers) + 재원/대기/퇴원.
// 셀 강사·특수자리·요일별 강의실은 슬롯 라벨(class_schedules.slot_teacher_label/slot_room_label, 0041a 백필)에서 온다.
// ⚠️ server-only 금지 — 클라(rich-card-group)도 import. 순수·plain만.
import { isSpecialSlotLabel } from "./teacher-label";
import {
  slotPeriodRow,
  weekdayPeriodRowOrNull,
  subjectPeriodRows,
  enumDayToKo,
  type DayOfWeek,
  type PeriodsConfig,
  type TimetableSubject,
} from "./periods";

import { planRowSpans, type RowSpanPlan } from "./row-span";

export type GridStudent = {
  name: string;
  grade: string | null;
  school: string | null;
  studentId?: string;
  /** 이 반 수강 id — 통합뷰에서 대기/퇴원으로 끌어 옮길 때의 저장 키(서버가 그 한 건만 바꾼다). */
  enrollmentId?: string;
  status: "active" | "hold" | "withdrawn";
  isNew?: boolean;
  /** 등록 31~60일(신입 다음 단계). */
  isRecent?: boolean;
  isTransferredIn?: boolean;
  /**
   * **예약된 반 이동**(DB에 이미 저장된 것) — 나갈 예정 / 들어올 예정. 연보라 '이동 대기'로 표시하고
   * 툴팁이 기존 반 이름을 말한다(원장 2026-09-09). 판정·짝짓기는 서버(`pairScheduledMoves`) 단일 소스.
   * ⚠️ 저장 **전**의 큐(`useTimetableEdit().pending`)와 다른 축이다 — 색은 같고 문구가 다르다.
   */
  movingOut?: { on: string; className: string | null };
  movingIn?: { on: string; className: string | null };
  /**
   * 자리(랩실) **교시 고정** 표식 문구 — 있으면 이름을 파란 밑줄 이탤릭으로 그리고 이 문장이 툴팁이 된다.
   * 판정·서식은 [`seat-pin-mark.ts`](./seat-pin-mark.ts) 단일 소스(화면에서 다시 만들지 말 것).
   */
  seatPinNote?: string;
  englishName?: string | null;
  // hover 정보용 — 런타임엔 StudentLine 전체가 도착(서버 쿼리가 채움). 분리등원·퇴원일·최근 교재·최근 진도·수강 시작일.
  attendanceDays?: string[];
  /** 수강 시작일(YYYY-MM-DD) — hover에서 신입 시작일·전입일 표시용. */
  enrollmentDate?: string | null;
  endDate?: string | null;
  latestTextbook?: { name: string; date: string | null } | null;
  latestReport?: {
    date: string;
    progress: string | null;
    examInfo: string | null;
    homeworkScore: string | null;
    teacherName: string | null;
  } | null;
};

/** 빌더 입력 — ScheduleSlotWithStudents와 구조 호환(서버 타입 직접 import 회피, [[#61]]). */
export type GridSlot = {
  classId: string;
  className: string;
  subject: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  teacherName: string | null; // 반 기본 강사(담임)
  classroomName: string | null; // 반 기본 강의실
  slotTeacherLabel: string | null; // 셀 강사/LAB(ijw slotTeachers)
  slotRoomLabel: string | null; // 셀 강의실(ijw slotRooms)
  classBgColor: string | null;
  classTextColor: string | null;
  students: GridStudent[];
};

/**
 * 셀 하나 — `label`은 해석된 표시 이름(강사명 또는 자리명), `isLab`은 **특수 자리**(LAB·JJ) 여부.
 *
 * `time`(="15:00~16:00")은 **주말 셀에만** 실린다. 주말 슬롯은 행 라벨을 못 믿기 때문이다 —
 * 주말 셀은 평일 교시 행에 얹히거나(혼합 반) 1교시부터 시작하도록 당겨지므로(주말 전용 반,
 * 아래 `weekendSelfShift`) **행의 시각 ≠ 그 수업의 시각**이다. 잃으면 안 되는 사실이라 셀이 들고 간다.
 */
export type GridCell = { label: string; isLab: boolean; time?: string };
export type GridPeriodRow = { order: number; label: string; time: string };

/**
 * 섹션 제목("… 시작")에 쓸 앵커 교시 표기 — 교시 이름이 있으면 그 이름, **비었으면 시작 시각**.
 * 학원장이 이름을 비우면(2026-08-13) 이름이 빈 문자열로 내려오는데, 그대로 이으면 " 시작"이 된다.
 */
function startAnchorName(row: GridPeriodRow | undefined): string {
  if (!row) return ""; // 행 자체가 없는 경우 = 데이터 어긋남. 종전 동작 유지.
  return row.label || row.time.split("~")[0] || "";
}

/**
 * 강사 라벨(display_name·영문닉네임) → 저장된 색(#RRGGBB). 통합뷰 셀·담임색 배선용.
 * 서버가 users.bg_color/text_color + english_name으로 빌드해 클라 렌더에 plain 객체로 전달
 * (메서드 없는 순수 데이터라 [[#61]] server-only 무관). 미해결 라벨은 teacherColor 해시 폴백.
 */
export type TeacherColorMap = Record<string, { bg: string; text: string }>;

export type RichClassCard = {
  classId: string;
  className: string;
  subject: string; // 과목 키(hover 과목 pill용)
  teacherName: string | null; // 담임
  classroomLabel: string; // "월수 304 / 목 LAB실"
  bgColor: string | null; // ijw 반 헤더색(#RRGGBB) — null이면 과목색 폴백
  textColor: string | null;
  cells: Record<string, GridCell>; // `${order}:${day}` → 셀
  periodRows: GridPeriodRow[]; // 이 카드가 쓰는 교시행(그룹 축 union 재료)
  active: GridStudent[];
  hold: GridStudent[];
  withdrawn: GridStudent[];
  activeCount: number;
  groupOrder: number;
  groupLabel: string;
  /**
   * 이 반이 주말 전용인지 — 섹션의 축(교시표·요일열)을 평일/주말 중 무엇으로 잡을지 결정한다.
   * ⚠️ 예전엔 `groupOrder === WEEKEND_ORDER`로 판정했는데, 커스텀 그룹은 groupOrder를 그룹 번호로
   * 덮어쓰므로 그 판정이 깨진다(주말 반이 평일 축에 얹혀 요일열이 어긋남). 그래서 카드에 못박는다.
   */
  weekendOnly: boolean;
  /**
   * 이 **카드**가 실제 수업하는 요일축(ijw `finalDays` 이식, 2026-07-23 원장 지시). **렌더도 이걸 쓴다.**
   *
   * 🔴 왜 카드별인가: 예전엔 섹션 공통 요일축이 평일=월~금 **고정**이라, 평일+토 **혼합 반**의
   * 토요일 수업이 통합뷰에서 **통째로 사라졌다**(실측 4개 반·주말 슬롯 21개 — 반 이름이
   * "고등M 고1 BS4F 토"인데 정작 토요일이 안 보였다). 주말 **전용** 반만 별도 섹션으로 잘 나왔다.
   * ijw 통합뷰는 카드마다 자기 요일축(`finalDays`)을 써서 토요일이 있는 반에만 토 열이 붙는다.
   *
   * 🔴 **빈 요일 열은 그리지 않는다**(원장 2026-08-11 *"수업없는 요일 열도 숨겨버리고"*) — 2026-07-27에
   *    도입한 "항상 월~금 5칸"(`buildAxisDays`/`axisDays`) 규약을 **뒤집은 것**이다. 그 규약의 목적은
   *    "한 칸 너비가 카드마다 같아야 시트처럼 읽힌다"였는데, 실측(영어 활성 42반)에서 **2일 12반·3일 29반·
   *    5일 1반** — 즉 거의 모든 카드의 격자 **40~60%가 빈 칸**이었다. 카드 폭은 그대로 두고 열만 없애므로
   *    남은 칸이 넓어질 뿐 카드 간 세로 정렬(시트로 읽히는 성질)은 그대로다.
   * ⚠️ 셀은 (그룹 교시행 × 카드 요일)로 조회하므로, 주말 슬롯의 교시 order도 그룹 축에 있어야 보인다
   *    (아래 presentOrders에서 혼합 카드의 주말 order를 함께 넣는 이유).
   */
  days: DayOfWeek[];
  /**
   * 커스텀 그룹 안에서의 열 순서(그룹 정의에 적힌 반 순서). 미설정(자동 그룹)이면 undefined → 가나다.
   * 원장 시트의 좌우 순서를 그대로 재현하기 위한 값이라 **정의 순서가 곧 화면 순서**다.
   */
  groupSeq?: number;
  /**
   * 이 카드를 가져간 **커스텀 그룹(줄)의 id** — 미배정('기타' 섹션)은 `OTHERS_GROUP_ID`, 자동 그룹은 undefined.
   * 통합뷰 '배치 편집'이 "이 섹션 = 설정의 어느 줄인가"를 groupOrder 산수(BASE+i*10)로 되짚지 않게
   * 못박아 둔다(그 산수는 주말 하위 섹션·기타에서 쉽게 어긋난다).
   */
  groupCustomId?: string;
};

/**
 * 통합뷰 섹션을 "N교시 시작" 자동 그룹 대신 **원장이 정한 그룹**으로 묶는 설정(과목별).
 * ijw-calander 통합뷰의 `viewMode: CUSTOM_GROUP`을 이식한 것 — 반을 원하는 행(섹션)에 배치한다.
 * 어느 그룹에도 없는 반은 `showOthers`면 맨 아래 '기타' 섹션으로, 아니면 화면에서 빠진다.
 */
export type IntegrationGroupsConfig = {
  groups: { id: string; title: string; classIds: string[] }[];
  showOthers: boolean;
  othersTitle: string;
};

export type RichCardGroup = {
  key: string;
  label: string; // "1교시 시작" | "주말"
  order: number;
  /** 이 그룹이 속한 "N교시 시작" 섹션의 식별자(=groupOrder). '1시간 단위' 토글은 섹션 단위(같은 sectionKey를 켜고 끔). */
  sectionKey: number;
  /** 이 섹션이 현재 '1시간 단위'로 압축됐는지(토글 체크 상태). 압축 섹션은 부그룹 ②③로 나뉠 수 있어 각 부그룹이 동일 sectionKey·compacted. */
  compacted: boolean;
  /**
   * '1시간 단위' 토글을 붙일 수 있는 섹션인지 = 평일 섹션. 주말은 교시 체계가 없어 압축 대상이 아니다.
   * ⚠️ 소비처가 `sectionKey !== WEEKEND_ORDER`로 판정하면 **커스텀 그룹의 주말 하위 섹션**을 놓친다
   * (그쪽 sectionKey는 그룹 번호라 WEEKEND_ORDER가 아니다) → 이 플래그를 볼 것.
   */
  compactable: boolean;
  cards: RichClassCard[];
  periodRows: GridPeriodRow[]; // 그룹 공통 교시축(카드 union, order순)
  /**
   * 교시축 접기 계획(화면 전용) — 40분·60분 두 체계가 한 줄에 섞였을 때 긴 행을 짧은 눈금에 얹는다.
   * 🔴 `periodRows` 자체는 **안 건드린다** — 엑셀 내보내기가 같은 배열을 축으로 쓰는데, 행을 지우면
   *    그 시각의 수업이 에러 없이 통째로 빠진다(칸을 `${order}:${day}`로 찾는다).
   */
  rowPlan?: RowSpanPlan;
  days: DayOfWeek[]; // 그룹 공통 요일축(카드 union)
  /**
   * 명단 섹션 표시 행수 — **그룹 내 최대 인원**(카드·라벨열 높이 동기화) + `ROSTER_ROW_CAP` 상한.
   *
   * 🔴 왜 그룹 max인가(원장 2026-07-27 "세로 여백이 너무 많다"): 예전엔 12/3/5 **고정**이라 실제 인원과
   * 무관하게 카드마다 20행(504px)을 잡았다. 실측(injaewon 이번 주) 재원 최대가 수학 9명·영어 11명이라
   * **12행을 채우는 반이 하나도 없었고**, 대기는 103개 반 중 4개만 인원이 있어 3행이 통째로 빈칸.
   * 영어 통합뷰 기준 명단 영역의 **65%가 빈칸**이었다.
   * 그룹 max로 맞추면 카드 간 행 정렬(시트처럼 읽히는 성질)은 그대로면서 빈칸만 사라진다.
   *
   * ⚠️ 상한이 **반드시** 필요하다 — 2026-07-06에 고정 행수로 바꾼 이유가 "한 반(DP5 퇴원 10명)이 전 카드를
   * 세로로 폭주시킴"이었다. 상한을 넘는 명단은 카드 안에서 스크롤(스크롤바 숨김 + 하단 페이드).
   * 0이면 그 섹션은 **아예 안 그린다**(대기 0명인 그룹에서 '대기 —' 빈 줄이 사라진다).
   */
  rosterRows: { active: number; hold: number; withdrawn: number };
  /**
   * 이 섹션이 속한 커스텀 그룹(줄)의 id — 미배정('기타')은 `OTHERS_GROUP_ID`, 자동 그룹은 undefined.
   * 한 줄이 평일/주말 두 섹션으로 갈라져도 **같은 id**다(줄은 하나이고 축만 둘이다).
   */
  customGroupId?: string;
};

/** 미배정('기타 수업') 섹션의 `customGroupId` — 실제 그룹 id(uuid)와 절대 안 겹치게 예약어로 둔다. */
export const OTHERS_GROUP_ID = "__others__";

const DAY_ORDER: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKEND = new Set<string>(["sat", "sun"]);

/** 통합뷰 카드가 최소로 갖는 요일 열 수(원장 2026-08-13 *"강제로 열 3개로"*). */
export const MIN_CARD_DAY_COLS = 3;
/**
 * 더미 열로 채울 요일 우선순위 — **수요일 먼저**(원장 지시), 이미 있으면 금·월·화·목 순.
 * 순서 근거: 실제 배치가 월목·화금·월수금 계열이라 수 다음으로 금·월을 넣어야 `월수금`·`화수금`처럼
 * 학원에서 실제 쓰는 조합으로 읽힌다(더미인 줄 몰라도 어색하지 않게).
 */
const FILLER_DAY_ORDER: DayOfWeek[] = ["wed", "fri", "mon", "tue", "thu"];

/**
 * 카드 요일 열이 `min`개보다 적으면 **수업 없는 더미 요일**을 채워 넣는다(원장 2026-08-13 —
 * *"요일이 2개라 열이 2개밖에 없는 수업은 강제로 수요일을 추가해서 열을 3개로"*).
 *
 * 왜: 요일 칸 폭이 고정(DAY_COL_W)이라 2요일 반의 카드가 3요일 반보다 눈에 띄게 좁아, 나란히 놓으면
 * 카드 크기가 들쭉날쭉해 시트로 안 읽힌다. 채운 열엔 셀이 없으므로(그 요일 키의 셀이 애초에 없다)
 * **빈 칸**만 늘어난다 — 데이터가 아니라 격자만 늘리는 조작이다.
 *
 * ⚠️ **주말 전용 카드는 손대지 않는다** — 토·일반에 평일 더미를 붙이면 평일 반처럼 읽힌다.
 * ⚠️ 렌더 전용이다(`RichClassCard.days`는 그대로 = 실제 수업 요일). 엑셀·시트 내보내기는 이 함수를
 *    거치지 않으므로 없는 요일이 문서로 새지 않는다.
 */
export function padCardDays(days: readonly DayOfWeek[], min: number = MIN_CARD_DAY_COLS): DayOfWeek[] {
  if (days.length === 0 || days.length >= min) return [...days];
  if (days.every((d) => WEEKEND.has(d))) return [...days];
  const have = new Set<DayOfWeek>(days);
  for (const d of FILLER_DAY_ORDER) {
    if (have.size >= min) break;
    have.add(d);
  }
  return DAY_ORDER.filter((d) => have.has(d));
}
/** 명단 섹션 최대 표시 행수(원장 2026-07-27 "최대 12명"). 넘치면 카드 안에서 스크롤(스크롤바 숨김+페이드). */
export const ROSTER_ROW_CAP = 12;
/**
 * 재원 명단이 **기본으로 잡는 줄 수**(원장 2026-09-08: *"재원생이 10명은 기본으로 공간 배정. 통합뷰에서"*).
 * 인원이 적은 반도 이만큼은 자리를 잡아서, 한 줄에 늘어선 카드들의 명단 바닥이 들쭉날쭉하지 않는다.
 * 🔴 `ROSTER_ROW_CAP`(12)보다 크게 두지 말 것 — 상한보다 바닥이 높으면 clamp가 뒤집힌다.
 */
export const ROSTER_ACTIVE_MIN_ROWS = 10;

/** 교시표를 시각순으로 세우고 order→인덱스 맵을 만든다(시프트는 '분'이 아니라 '몇 번째 교시'로 센다). */
function periodIndexByOrder(rows: readonly { order: number; label: string; time: string }[]) {
  const sorted = [...rows].sort((a, b) => a.order - b.order);
  const byOrder = new Map<number, number>();
  sorted.forEach((r, i) => byOrder.set(r.order, i));
  return { rows: sorted, byOrder };
}

/**
 * 교시 행을 **같은 표 안에서 인덱스만큼 옮긴다**(ijw `weekendShift` 이식, 원장 2026-07-27).
 *
 * 🔴 지금 쓰이는 곳은 **주말 전용 반을 자기 1교시로 당기는 것 하나뿐**이다(`weekendSelfShift`).
 *    혼합 반(평일+주말)의 주말 블록은 인덱스 간격이 아니라 **순번**으로 얹는다(`liftToWeekday`,
 *    2026-08-14) — 간격 방식은 평일 표에 교시가 끼면 마지막 칸이 표 끝을 넘어 제자리에 남았다.
 *
 * ⚠️ eywa의 `order`는 교시 번호가 아니라 **자정 기준 분**이라 ijw처럼 번호를 빼면 안 된다(평일 40분·주말
 * 60분 간격이라 분 단위 시프트는 두 번째 교시부터 어긋난다). 그래서 **교시 인덱스** 공간에서 옮긴다.
 *
 * 행의 라벨·시각은 **옮겨간 자리의 것**이 된다(행은 "몇 번째 교시"를 뜻하지 절대 시각이 아니다).
 * 표를 벗어나면 원래 행을 그대로 써서 정보를 잃지 않는다.
 */
function shiftedWeekendRow(
  row: { order: number; label: string; time: string; key?: string },
  /** 이 행이 **원래 앉아 있던 표**의 order→인덱스 맵(주말 표일 수도, 평일 표일 수도 있다). */
  fromIdx: { byOrder: Map<number, number> },
  targetRows: readonly { order: number; label: string; time: string }[],
  shift: number,
): { order: number; label: string; time: string } {
  if (shift === 0) return row;
  const k = fromIdx.byOrder.get(row.order);
  if (k === undefined) return row;
  // 음수 시프트도 허용(위로 당김) — 범위를 벗어나면 원래 행을 유지해 정보를 잃지 않는다.
  return targetRows[k + shift] ?? row;
}
const clampRows = (n: number, min: number) => Math.min(ROSTER_ROW_CAP, Math.max(min, Number.isFinite(n) ? n : min));

/**
 * 아무 카드도 쓰지 않는 교시 행을 **통째로 뺀다**(원장 2026-08-11 *"수업없는 교시행도 숨겨버려"*).
 *
 * 🔴 뒤집힌 규약 두 가지 — 되돌리기 전에 여기를 읽을 것:
 *  · 2026-07-06 "5칸 윈도우의 위·아래 패딩은 컨텍스트라 유지" → **폐기**(끝단 빈 행도 뺀다).
 *  · 2026-07-27 "중간 빈 구간은 물결(〜〜〜) 한 줄로 접는다" → **폐기**(접는 게 아니라 없앤다).
 *    행 라벨에 "1교시·8교시"처럼 교시 번호가 그대로 남아서, 사이가 비었다는 사실은 라벨로 읽힌다.
 *
 * ⚠️ **전부 비면 원본을 돌려준다** — 격자가 0행인 카드는 "반이 깨진 것"으로 보인다. 셀이 하나도 없는
 *    카드는 정상 상태가 아니지만(슬롯이 있어야 카드가 생긴다), 방어적으로 윈도우를 남긴다.
 * ⚠️ '1시간 단위' 토글은 **여전히 의미가 있다** — 그 토글의 본체는 행 숨김이 아니라 **교시 체계가 다른
 *    반을 부그룹으로 쪼개는 것**이다(안 쪼개면 두 체계의 union이 전 행을 덮어 아무것도 안 없어진다).
 */
function keepUsedRows(rows: GridPeriodRow[], usedOrders: Set<number>): GridPeriodRow[] {
  const kept = rows.filter((r) => usedOrders.has(r.order));
  return kept.length > 0 ? kept : rows;
}
/** 주말 섹션의 groupOrder(=sectionKey). 교시 체계가 없어 '1시간 단위' 압축 대상이 아니다. */
export const WEEKEND_ORDER = 100000;
/**
 * 커스텀 그룹 섹션의 groupOrder 시작값 — 자동 그룹(교시 order, 최대 1440)·주말(100000)과 안 겹치게 크게 잡는다.
 * 그룹 i = BASE + i*10(평일) / +1(그 그룹의 주말 반). '기타'는 항상 맨 아래.
 * ⚠️ 정수만 쓴다 — sectionKey는 '1시간 단위' 쿠키·URL에 실려 다니는데 쿠키 형식이 `.`를 구분자로 쓴다.
 */
const CUSTOM_BASE = 200000;
const CUSTOM_OTHERS = 299000;
const GRID_MIN = 5; // 미니그리드 기본 크기 — 평일 섹션은 항상 5요일(월~금) × 5교시(섹션 시작부터).

/** "15:00:00" → "15:00". DB time 문자열을 사람이 읽는 시각으로(초는 항상 00이라 버린다). */
const hhmm = (t: string): string => t.slice(0, 5);

/** "본원304" → "304"(공통 건물 접두사 제거로 라벨 압축). "LAB실"·타건물은 그대로 — 건물 구분 유지. */
function shortRoom(room: string): string {
  return room.replace(/^본원/, "") || room;
}

/**
 * 요일별 강의실 → "월수 304 / 목 605". 한 요일에 교시마다 강의실이 다르면 그 요일의 강의실을 "·"로
 * 모아 보여주고, 같은 강의실 집합인 요일끼리 묶는다.
 * 전부 같으면 단일, 비면 "-". 방 이름은 shortRoom으로 공통 "본원" 접두사를 떼 압축.
 *
 * 🔴 **자리(LAB·JJ) 교시의 방은 안 싣는다**(원장 2026-08-11 *"LAB 및 JJ는 강의실이 안보여도됨"*).
 *    자리는 사람이 아니라 방이라 셀에 이미 `LAB`·`JJ`로(색까지 갈라) 찍힌다 — 강의실 줄에 603·305를
 *    또 적으면 같은 사실이 두 번 나오면서 줄이 "603·605·본원602·본원605"처럼 불어난다.
 *    실측(영어 활성 42반): 41반의 라벨이 짧아지고, **방이 통째로 사라지는 반은 0개**(자리 교시만 있는
 *    반이 없다). 제외는 `perDayRooms`에 넣기 전에 — 여기 함수는 들어온 것만 조립한다.
 */
function classroomLabel(perDayRooms: Map<DayOfWeek, Set<string>>): string {
  if (perDayRooms.size === 0) return "-";
  const dayStr = new Map<DayOfWeek, string>();
  for (const [d, set] of perDayRooms)
    dayStr.set(d, [...set].map(shortRoom).sort((a, b) => a.localeCompare(b, "ko")).join("·"));
  const distinct = [...new Set(dayStr.values())];
  if (distinct.length === 1) return distinct[0];
  const byRooms = new Map<string, DayOfWeek[]>();
  for (const d of DAY_ORDER) {
    const r = dayStr.get(d);
    if (!r) continue;
    (byRooms.get(r) ?? byRooms.set(r, []).get(r)!).push(d);
  }
  return [...byRooms.entries()]
    .map(([rooms, days]) => `${days.map(enumDayToKo).join("")} ${rooms}`)
    .join(" / ");
}

/**
 * 카드를 커스텀 그룹에 배정 — `groupOrder`(정렬·섹션키)와 `groupLabel`(제목)만 덮어쓴다.
 *
 * 규칙(ijw 통합뷰와 동일):
 * · 한 반이 여러 그룹에 적혀 있으면 **먼저 나온 그룹**이 갖는다(중복 노출 금지 — 같은 반이 두 줄에 뜨면
 *   인원·명단이 두 번 세어진 것처럼 보인다).
 * · 어느 그룹에도 없는 반은 `showOthers`면 맨 아래 '기타' 섹션, 아니면 **화면에서 뺀다**.
 * · 주말 전용 반은 같은 그룹 안에서도 **별도 섹션**(제목 뒤 "(주말)") — 교시표·요일열 체계가 평일과
 *   달라 한 축에 얹으면 요일이 어긋난다.
 * 미설정(그룹 0개)이면 원본 배열을 그대로 돌려준다 = 지금까지의 "N교시 시작" 자동 그룹.
 */
function applyCustomGroups(
  cards: RichClassCard[],
  custom?: IntegrationGroupsConfig | null,
): RichClassCard[] {
  const groups = custom?.groups?.filter((g) => g.title.trim()) ?? [];
  if (!groups.length) return cards;

  const groupOf = new Map<string, number>(); // classId → 그룹 인덱스(먼저 나온 그룹이 이긴다)
  const seqOf = new Map<string, number>(); // classId → 그룹 안 열 순서(정의 순서 = 화면 순서)
  groups.forEach((g, i) => {
    (g.classIds ?? []).forEach((classId, seq) => {
      if (groupOf.has(classId)) return;
      groupOf.set(classId, i);
      seqOf.set(classId, seq);
    });
  });

  const out: RichClassCard[] = [];
  for (const c of cards) {
    const idx = groupOf.get(c.classId);
    if (idx === undefined) {
      if (!custom?.showOthers) continue; // '기타' 숨김 = 미배정 반은 화면에서 제외(원장 선택)
      out.push({
        ...c,
        groupOrder: CUSTOM_OTHERS + (c.weekendOnly ? 1 : 0),
        groupLabel: othersLabel(custom, c.weekendOnly),
        groupCustomId: OTHERS_GROUP_ID,
      });
      continue;
    }
    const title = groups[idx].title.trim();
    out.push({
      ...c,
      groupOrder: CUSTOM_BASE + idx * 10 + (c.weekendOnly ? 1 : 0),
      groupLabel: c.weekendOnly ? `${title} (주말)` : title,
      groupSeq: seqOf.get(c.classId),
      groupCustomId: groups[idx].id,
    });
  }
  return out;
}

const othersLabel = (custom: IntegrationGroupsConfig, weekend: boolean) => {
  const base = custom.othersTitle?.trim() || "기타 수업";
  return weekend ? `${base} (주말)` : base;
};

/**
 * 한 과목 슬롯 → 시작 교시별 리치 카드 섹션. 교시 정렬은 평일 기준, 주말 전용 반은 "주말" 섹션.
 * '1시간 단위'는 **섹션(N교시 시작)별 토글**(사용자 결정 2026-07-06 — 전역 아님): compactSections(=압축할
 * 섹션의 groupOrder 집합)에 든 섹션만 압축. 압축 섹션은:
 * ① 같은 시작 교시라도 **교시 체계가 다른 반은 별도 부그룹(②③)으로 분리**(예: 영어 16:20 시작 = 1시간
 *    체계 4·6·8교시 ↔ 40분 체계 4·5·7교시 — 한 축에 섞으면 서로가 상대의 빈 행을 점유해 못 숨김).
 * ② 각 부그룹에서 실제 쓰는 교시 "사이"의 빈 행만 제거(위아래 윈도우 패딩은 유지). 실제 쓰는 교시는 항상 유지 → 클립 없음.
 * 압축 안 된 섹션은 한 그룹·풀 윈도우(빈 행 유지).
 */
export function buildRichCardGroups(
  slots: GridSlot[],
  config: PeriodsConfig,
  compactSections: Set<number> = new Set(),
  /** 커스텀 그룹(학원설정 과목별). 미지정·빈 그룹이면 지금까지처럼 "N교시 시작" 자동 그룹. */
  custom?: IntegrationGroupsConfig | null,
): RichCardGroup[] {
  return groupRichCards(buildRichClassCards(slots, config), config, compactSections, custom);
}

/**
 * 1단계 — 슬롯 → **반 카드**(셀·명단·요일축까지 완성). 그룹 배정과 무관한 부분만 한다.
 *
 * 🔴 왜 2단계로 쪼갰나(2026-08-06): 통합뷰 '배치 편집'이 반을 다른 줄로 끌 때마다 **그 자리에서**
 * 진짜 표를 다시 그려야 하는데(줄이 바뀌면 교시축·요일축·명단 행수가 같이 바뀐다), 서버 왕복 없이
 * 하려면 2단계(`groupRichCards`)만 클라에서 다시 돌리면 된다. 카드 빌드(무거운 쪽)는 서버 1회.
 * 두 단계를 합친 `buildRichCardGroups`는 그대로 남겨 기존 소비처·테스트는 무변경.
 */
export function buildRichClassCards(slots: GridSlot[], config: PeriodsConfig): RichClassCard[] {
  const subject = (slots[0]?.subject ?? "math") as TimetableSubject;
  const byClass = new Map<string, GridSlot[]>();
  for (const s of slots) (byClass.get(s.classId) ?? byClass.set(s.classId, []).get(s.classId)!).push(s);
  // 교시축 시프트 계산용 — 평일/주말 표준 교시표를 시각순으로. order(자정 기준 분) → 그 표에서의 인덱스.
  const weekdayIdx = periodIndexByOrder(subjectPeriodRows(subject, false, config));
  const weekendIdx = periodIndexByOrder(subjectPeriodRows(subject, true, config));
  const weekdayRows = [...weekdayIdx.rows];

  const cards: RichClassCard[] = [];
  for (const group of byClass.values()) {
    const first = group[0];
    const cells: Record<string, GridCell> = {};
    const perDayRooms = new Map<DayOfWeek, Set<string>>();
    const periodMap = new Map<number, GridPeriodRow>();
    const slotTeacherCount = new Map<string, number>(); // 담임 폴백용(최빈 슬롯 강사, LAB 제외)
    let weekdayStart = Infinity;
    // 1차 스캔 — 슬롯의 교시 행을 뽑고 평일/주말 **시작 교시 인덱스**를 잰다(시프트 재료).
    const hasWeekday = group.some((s) => !WEEKEND.has(s.dayOfWeek as DayOfWeek));
    const scanned = group.map((s) => {
      const day = s.dayOfWeek as DayOfWeek;
      const isW = WEEKEND.has(day);
      // 혼합 반의 주말 슬롯이 **평일 교시 시각 그대로**면(토 14:20 = 영어 평일 1교시) 그 평일 행에 바로 놓는다.
      // ⚠️ 주말표보다 먼저 본다 — 15:00처럼 양쪽 표에 다 있는 시각이 있어서, 주말표를 먼저 보면 같은 반의
      //    연속 3교시(14:20·15:00·15:40)가 1교시·주말7교시·3교시로 찢어진다(실측).
      const onWeekday =
        isW && hasWeekday ? weekdayPeriodRowOrNull(subject, s.startTime, config, s.endTime) : null;
      return {
        s,
        day,
        row: onWeekday ?? slotPeriodRow(subject, s.startTime, day, config, s.endTime),
        weekend: isW,
        // 이미 평일 행에 앉은 주말 슬롯은 시프트 대상이 아니다(더 옮기면 엉뚱한 교시로 간다).
        shiftable: isW && !onWeekday,
      };
    });
    // 기준점 셋을 **따로** 잰다. 🔴 예전엔 "평일 행에 앉은 주말 슬롯"을 평일 기준점(wdStartIdx)에
    // 섞었는데, 그러면 토 14:20(=영어 평일 1교시) 하나가 앵커를 1교시로 끌어내려 **시프트가 0이 됐다**
    // — 그래서 저녁 반(평일 9·10·11교시)의 토요일이 1·2·3교시에 따로 앉아 한 반이 6행을 먹었다.
    let wdStartIdx = Infinity; // 진짜 평일 슬롯의 시작(평일 표 인덱스)
    let wkOnWeekendIdx = Infinity; // 주말 표에 앉은 주말 슬롯의 시작(주말 표 인덱스)
    for (const { row, weekend: isW, shiftable } of scanned) {
      if (!isW) {
        const i = weekdayIdx.byOrder.get(row.order);
        if (i !== undefined) wdStartIdx = Math.min(wdStartIdx, i);
      } else if (shiftable) {
        const i = weekendIdx.byOrder.get(row.order);
        if (i !== undefined) wkOnWeekendIdx = Math.min(wkOnWeekendIdx, i);
      }
    }
    /**
     * 🔴 **혼합 반(평일+주말)의 주말 수업은 그 반의 평일 교시 행에 겹쳐 놓는다** — 한 반은 자기 교시 수만큼만
     * 행을 쓴다(원장 2026-08-11 *"행을 6개가 아닌 3개만 하고 싶다니까?"* · *"주말수업 9, 10, 11로 맞추란
     * 뜻이야. 123 하지말고"*).
     *
     * 실측(영어 고등 3반): 평일 수업이 9·10·11교시(19:20~22:00)인데 토요일 수업이 14:20·15:00·15:40이라
     * **평일 1·2·3교시 시각과 정확히 같았다.** 그래서 `weekdayPeriodRowOrNull`이 그 슬롯을 평일 1교시 행에
     * 앉히고 시프트 대상에서 뺐고(`shiftable=false`), 결과가 한 반에 6행이었다. 이제 그 블록도 통째로 옮긴다.
     *
     * 놓는 자리 = 평일 시작 행부터 **주말 교시 순번대로**(아래 `liftToWeekday`). ⚠️ **위로도 아래로도**
     * 옮긴다 — 예전 `weekendShift`는 주말이 평일보다 이를 때만 내렸는데, 그 가정은 오전 평일·오후 주말
     * 조합에서 다시 두 덩어리로 갈라진다.
     */
    /**
     * 🔴 **주말 전용 반은 무조건 1교시부터 시작하게 당긴다**(원장 2026-08-11 *"주말 수업은 6행이나 차지하게
     * 두지말고, 그냥 3행으로 처리해 보기 편하게 강제로 … 평일수업에 맞춰서"*).
     *
     * 왜: 주말 섹션은 반들이 제각각 다른 시각에 시작한다(실측 수학 주말전용 3반 = 09~11시 / 14~16시 /
     * 15~16시). 섹션 교시축은 카드들의 **합집합**이라 그대로 두면 **6행**인데, 정작 어느 반도 3교시를
     * 넘지 않는다 — 카드마다 3분의 2가 빈 칸이었다. 각 카드를 자기 1교시부터 시작하게 당기면 **3행**.
     *
     * ⚠️ 그 대가로 **행 라벨의 시각이 그 반의 시각이 아니게 된다**(09시 반과 14시 반이 같은 "1교시" 행).
     *    그래서 ① 주말 섹션은 행 라벨에서 시각을 뗀다(`groupRichCards`) ② 실제 시각은 셀(`GridCell.time`)이
     *    들고 간다. 행은 "몇 번째 교시"라는 뜻이고, 그건 이 뷰가 원래 쓰던 규약이다(weekendShift 주석).
     */
    const weekendSelfShift = !hasWeekday && wkOnWeekendIdx !== Infinity ? -wkOnWeekendIdx : 0;
    const weekendRows = [...weekendIdx.rows];
    /**
     * 혼합 반의 주말 블록을 평일 행으로 옮길 때 쓰는 **순번**(그 반의 주말 교시 중 몇 번째인가).
     *
     * 🔴 왜 인덱스 간격이 아니라 순번인가(2026-08-14): 예전엔 `평일시작 − 주말시작`만큼 **인덱스를 밀었다**.
     * 그러면 주말 블록이 평일 표에서 **연속 인덱스일 때만** 맞는다 — 표 중간에 교시가 하나라도 끼면
     * 간격이 그대로 벌어져 마지막 슬롯이 표 끝을 넘고, `targetRows[k+shift] ?? row`가 **원래 행을 남겨**
     * 그 칸만 딴 줄에 앉는다(실측: 영어 교시표에 60분 교시 2개를 더하자 고등 주말 3반이 3행→4행).
     * 순번으로 옮기면 블록이 항상 평일 시작부터 **붙어서** 놓여 밀도 변화에 흔들리지 않는다.
     * (연속 블록에서는 종전과 결과가 같다 — 기존 토요일 배치는 그대로다.)
     */
    const rankByOrder = (orders: number[]) => {
      const uniq = [...new Set(orders)].sort((a, b) => a - b);
      return new Map(uniq.map((o, i) => [o, i]));
    };
    /**
     * 🔴 **순번은 그 카드의 주말 슬롯 전체에서 한 번만 매긴다** — 어느 교시표에서 행을 찾았는지와 무관하게
     * (2026-08-24, 원장 제보 *"13:00~14:00도 없고 순서도 이상한데?"*).
     *
     * 예전엔 `shiftable`(주말표에서 찾음) / `!shiftable`(평일표에 그 시각이 그대로 있음) 두 바구니에
     * **각각 0부터** 순번을 매겼다. 그러면 한 반의 주말 블록이 두 표에 걸치는 순간 **두 순번이 0에서 겹쳐**
     * 같은 `cells["<order>:sat"]` 키에 두 번 쓰이고 나중 것이 앞엣것을 덮는다.
     * 실측(고등E_고2 심화, 토 13:00·14:00·15:00 + 영어 평일표에 15:00~16:00 실재):
     *   13:00(주말표)→순번0 / 14:00(주말표)→순번1 / 15:00(평일표)→순번0  ⇒ 13:00 칸이 증발하고 15→14 순.
     * 같은 화면의 고등E_고3 정규(토 10·11·12시)는 평일표에 하나도 없어 한 바구니라 멀쩡했다.
     *
     * 합칠 수 있는 근거: `row.order`는 교시 번호가 아니라 **자정 기준 분**이라(`periodIndexByOrder`·
     * `shiftedWeekendRow` 주석) 평일표에서 온 값과 주말표에서 온 값이 **서로 비교 가능**하다.
     * ⚠️ 앵커(`wdStartIdx`·`wkOnWeekendIdx`)는 **여전히 따로** 잰다 — 그건 다른 버그(2026-08-14 주석)를
     *    막는 장치라 같이 합치면 안 된다. 합치는 건 순번 하나뿐이다.
     */
    const weekendRank = rankByOrder(scanned.filter((x) => x.weekend).map((x) => x.row.order));
    /** 주말 행 → 평일 표의 (평일 시작 + 순번)번째 행. 못 옮기면 원래 행(정보 유실 금지). */
    const liftToWeekday = (row: GridPeriodRow, rank: number | undefined) =>
      wdStartIdx !== Infinity && rank !== undefined ? (weekdayRows[wdStartIdx + rank] ?? row) : row;

    for (const { s, day, row, weekend: isW } of scanned) {
      // 혼합 반의 주말 슬롯은 **평일 교시 행으로** 옮기고(어느 표에서 왔든), 주말 전용 반은 자기 1교시로 당긴다.
      const eff = !isW ? row : liftToWeekday(row, weekendRank.get(row.order));
      const effWeekend =
        isW && weekendSelfShift !== 0
          ? shiftedWeekendRow(eff, weekendIdx, weekendRows, weekendSelfShift)
          : eff;
      if (!periodMap.has(effWeekend.order))
        periodMap.set(effWeekend.order, {
          order: effWeekend.order,
          label: effWeekend.label,
          time: effWeekend.time,
        });
      const teacher = s.slotTeacherLabel ?? s.teacherName ?? "";
      const isSeat = isSpecialSlotLabel(s.slotTeacherLabel);
      cells[`${effWeekend.order}:${day}`] = {
        label: teacher,
        isLab: isSeat,
        // 주말 셀만 실제 시각을 들고 간다 — 행 라벨이 그 반의 시각이 아닐 수 있다(GridCell.time 주석).
        ...(isW ? { time: `${hhmm(s.startTime)}~${hhmm(s.endTime)}` } : null),
      };
      // 담임 폴백 집계에서 특수 자리는 제외 — LAB·JJ는 방(자리)이라 담임이 될 수 없다.
      if (s.slotTeacherLabel && !isSeat)
        slotTeacherCount.set(s.slotTeacherLabel, (slotTeacherCount.get(s.slotTeacherLabel) ?? 0) + 1);
      // 자리(LAB·JJ) 교시의 방은 강의실 줄에 안 싣는다 — 셀이 이미 자리 이름을 보여준다(classroomLabel 주석).
      const room = isSeat ? null : (s.slotRoomLabel ?? s.classroomName);
      if (room) (perDayRooms.get(day) ?? perDayRooms.set(day, new Set()).get(day)!).add(room);
      if (!isW && row.order < weekdayStart) weekdayStart = row.order;
    }
    // 담임 = 반 기본 강사 우선, 없으면 가장 많이 가르치는 슬롯 강사(ijw homeroom은 영문닉네임이라 FK 미해결).
    const topSlotTeacher = [...slotTeacherCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const students = first.students;
    const split = (st: GridStudent["status"]) => students.filter((x) => x.status === st);
    const weekend = weekdayStart === Infinity;
    // 이 카드가 실제 수업하는 요일(ijw finalDays) — 평일 반이라도 토·일 슬롯이 있으면 그 요일이 들어간다.
    const cardDays = DAY_ORDER.filter((d) => group.some((s) => (s.dayOfWeek as DayOfWeek) === d));
    cards.push({
      days: cardDays,
      classId: first.classId,
      className: first.className,
      subject: first.subject,
      teacherName: first.teacherName ?? topSlotTeacher,
      classroomLabel: classroomLabel(perDayRooms),
      bgColor: first.classBgColor,
      textColor: first.classTextColor,
      cells,
      periodRows: [...periodMap.values()].sort((a, b) => a.order - b.order),
      active: split("active"),
      hold: split("hold"),
      withdrawn: split("withdrawn"),
      activeCount: students.filter((x) => x.status === "active").length,
      // 같은 시작시각의 서로 다른 교시는 행 식별용 소수부만 다르다. 섹션 정렬키는 실제 시작 분으로 유지한다.
      groupOrder: weekend ? WEEKEND_ORDER : Math.floor(weekdayStart),
      // 🔴 학원장이 교시 **이름을 비우면**(2026-08-13) label이 빈 문자열이라 제목이 " 시작"이 된다
      //    (화면 섹션 머리글 + 영어 통합 엑셀 섹션행이 같은 문자열을 쓴다) → 시작 시각으로 적는다.
      //    ⚠️ 행 자체가 없을 때의 `""`는 종전 동작 그대로 둔다(그건 데이터가 어긋난 경우다).
      groupLabel: weekend ? "주말" : `${startAnchorName(periodMap.get(weekdayStart))} 시작`,
      weekendOnly: weekend,
    });
  }
  return cards;
}

/**
 * 2단계 — 반 카드 → **섹션(줄)**. 커스텀 그룹 배정·'1시간 단위' 압축·교시축/요일축/명단 행수 계산.
 * 순수 함수라 서버(첫 렌더)와 클라(배치 편집 중 즉시 재계산)가 **같은 입력에 같은 결과**를 낸다.
 */
export function groupRichCards(
  cards: RichClassCard[],
  config: PeriodsConfig,
  compactSections: Set<number> = new Set(),
  custom?: IntegrationGroupsConfig | null,
): RichCardGroup[] {
  const subject = (cards[0]?.subject ?? "math") as TimetableSubject;

  // 커스텀 그룹 — 카드의 소속(groupOrder·groupLabel)만 갈아끼운다. 아래 클러스터링·압축·정렬은
  // 그 두 값만 보고 돌아가므로 자동 그룹과 완전히 같은 경로를 탄다(분기 없음).
  const assignedCards = applyCustomGroups(cards, custom);

  // 시작 교시별 그룹 + 그룹 공통 교시·요일 축(카드 union).
  const groupMap = new Map<string, RichClassCard[]>();
  for (const c of assignedCards) {
    const key = `${c.groupOrder}::${c.groupLabel}`;
    (groupMap.get(key) ?? groupMap.set(key, []).get(key)!).push(c);
  }

  /** 카드가 이 섹션 체계(평일/주말)에서 실제 쓰는 표준 교시 order 집합. */
  const cardStdOrders = (c: RichClassCard, weekend: boolean, standardByOrder: Map<number, GridPeriodRow>) => {
    const out = new Set<number>();
    for (const k of Object.keys(c.cells)) {
      const [ordPart, dayPart] = k.split(":");
      if (WEEKEND.has(dayPart) !== weekend) continue;
      const o = Number(ordPart);
      if (standardByOrder.has(o)) out.add(o);
    }
    return out;
  };
  /** rows의 [min,max] 사이에서 비어있는 표준 교시(=사이 빈 행). */
  const interiorGaps = (rows: Set<number>, standard: GridPeriodRow[]) => {
    if (rows.size < 2) return new Set<number>();
    const lo = Math.min(...rows);
    const hi = Math.max(...rows);
    return new Set(standard.filter((r) => r.order > lo && r.order < hi && !rows.has(r.order)).map((r) => r.order));
  };

  const out: RichCardGroup[] = [];
  for (const cs of groupMap.values()) {
    // 카드 순서 = 커스텀 그룹이면 **원장이 정한 순서**(groupSeq), 아니면 가나다.
    // 그룹 안 열 순서까지 원장 시트와 같아야 "동일한 뷰"가 된다(가나다로 재정렬하면 DP5·LT2·LS2a…가
    // DP5·JP1·KW6…로 뒤섞인다). 자동 그룹은 groupSeq가 없어 tie → 지금까지처럼 가나다.
    cs.sort(
      (a, b) =>
        (a.groupSeq ?? Number.POSITIVE_INFINITY) - (b.groupSeq ?? Number.POSITIVE_INFINITY) ||
        a.className.localeCompare(b.className, "ko"),
    );
    const weekend = cs[0].weekendOnly;
    const standard = subjectPeriodRows(subject, weekend, config);
    const standardByOrder = new Map(standard.map((r) => [r.order, r]));
    // '1시간 단위'는 섹션별 토글(사용자 결정 2026-07-06 "각 교시 시작별로 세팅, 전역 아님").
    // 이 섹션(groupOrder)이 압축 집합에 있을 때만 압축한다.
    const sectionCompact = compactSections.has(cs[0].groupOrder);

    // 압축 섹션 = 같은 시작 교시라도 **교시 체계가 다른 반은 별도 그룹으로 분리**. 예: 영어 16:20 시작에
    // 1시간 체계(4·6·8교시)와 40분 체계(4·5·7교시)가 공존 — 한 축에 두면 서로의 교시가 상대 그룹의
    // '사이 빈 행'을 점유해 아무것도 못 숨긴다. 클러스터 규칙: 서로의 사이 빈 행(interiorGaps)을 안 침범하는 카드끼리 병합.
    let clusters: RichClassCard[][];
    if (sectionCompact) {
      const acc: { rows: Set<number>; cards: RichClassCard[] }[] = [];
      for (const c of cs) {
        const rows = cardStdOrders(c, weekend, standardByOrder);
        const fit = acc.find((cl) => {
          const clGaps = interiorGaps(cl.rows, standard);
          const cGaps = interiorGaps(rows, standard);
          return ![...rows].some((o) => clGaps.has(o)) && ![...cl.rows].some((o) => cGaps.has(o));
        });
        if (fit) {
          for (const o of rows) fit.rows.add(o);
          fit.cards.push(c);
        } else acc.push({ rows: new Set(rows), cards: [c] });
      }
      // 큰 클러스터(주 체계) 먼저, 동수면 첫 반 이름순.
      acc.sort(
        (a, b) =>
          b.cards.length - a.cards.length ||
          a.cards[0].className.localeCompare(b.cards[0].className, "ko"),
      );
      clusters = acc.map((cl) => cl.cards);
    } else {
      clusters = [cs];
    }

    clusters.forEach((cluster, ci) => {
      // 셀(order:day)에서 "이 섹션 체계(평일/주말)의 요일"에 실제 있는 교시 order만 수집.
      // order=자정기준 분이라 평일 영어 2교시(15:00)와 주말 7교시(토 15:00)가 충돌 → 요일로 체계를 가른다.
      const daySet = new Set<DayOfWeek>();
      const presentOrders = new Set<number>();
      // 평일 섹션에 섞여 있는 **주말 슬롯의 교시 order** — 평일 표준표엔 없는 시각이라(수학 토 12:00 등)
      // 따로 모아 축에 얹어야 한다. 안 그러면 토요일 열을 붙여도 셀이 놓일 행이 없어 여전히 안 보인다.
      const mixedWeekendOrders = new Set<number>();
      for (const c of cluster) {
        for (const k of Object.keys(c.cells)) {
          const [ordPart, dayPart] = k.split(":");
          const day = dayPart as DayOfWeek;
          daySet.add(day);
          if (WEEKEND.has(day) === weekend) presentOrders.add(Number(ordPart));
          else if (!weekend) mixedWeekendOrders.add(Number(ordPart));
        }
      }
      // 교시축 = 표준 교시표에서 섹션 시작 교시부터 5칸 윈도우(5×5 기본). 끝 가까운 섹션은
      // 윈도우를 당겨 항상 5칸 확보(표준 교시가 5개 미만인 수학계열은 전부).
      // 앵커 = 섹션에 실제 등장하는 표준 교시 중 가장 이른 것(폴백 시각·다른 체계는 제외됨).
      const presentStd = [...presentOrders].filter((o) => standardByOrder.has(o));
      const anchorOrder = presentStd.length ? Math.min(...presentStd) : standard[0]?.order ?? 0;
      let startIdx = standard.findIndex((r) => r.order === anchorOrder);
      if (startIdx < 0) startIdx = 0;
      startIdx = Math.min(startIdx, Math.max(0, standard.length - GRID_MIN));
      const winRows = new Map<number, GridPeriodRow>();
      for (const r of standard.slice(startIdx, startIdx + GRID_MIN))
        winRows.set(r.order, { order: r.order, label: r.label, time: r.time });
      // 윈도우 밖이어도 실제 등장하는 표준 교시는 포함(긴 수업 클립 방지). 다른 체계(주말)·폴백 시각은
      // 제외 — 한 카드가 두 교시체계를 섞어도 그리드가 폭발하지 않게.
      for (const o of presentStd) {
        if (winRows.has(o)) continue;
        const r = standardByOrder.get(o)!;
        winRows.set(o, { order: r.order, label: r.label, time: r.time });
      }
      // 혼합 반(평일+토·일)의 주말 교시는 **행을 추가하지 않는다** — 카드 빌드 단계에서 `shiftedWeekendRow`가
      // 이미 평일 교시 행으로 끌어올려 뒀다(ijw weekendShift). 예전엔 여기서 주말 order를 축에 얹었는데,
      // 그러면 같은 섹션의 **모든 카드**에 빈 행이 생겨 그리드가 세로로 늘어났다(2026-07-27 원장 지적).
      // 시프트로 평일 표를 벗어난 주말 교시만 예외적으로 남으므로, 그것만 축에 얹어 클립을 막는다.
      if (!weekend && mixedWeekendOrders.size) {
        for (const c of cluster) {
          for (const r of c.periodRows) {
            if (!mixedWeekendOrders.has(r.order) || winRows.has(r.order)) continue;
            winRows.set(r.order, { order: r.order, label: r.label, time: r.time });
          }
        }
      }
      // 🔴 **표준 교시표에 없는 시각의 수업도 행을 준다**(적대 리뷰 2026-08-11에 적발한 기존 버그).
      //    위 `presentStd`는 표준표에 있는 order만 추리므로, 교시표에 없는 시각(실측 injaewon 12종 —
      //    `[특강]중3-2 개념 완성반` 월화목금 11:00, `중등E_초5 의치대` 화·금 16:00 등)은 셀은 만들어졌는데
      //    **앉을 행이 없어 화면에서 통째로 사라졌다**. 특히 슬롯이 전부 비표준인 특강 반은 격자가 빈 칸만
      //    남았다. `slotPeriodRow`가 이미 폴백 행(시각 그대로 라벨)을 만들어 두므로 그걸 축에 얹는다.
      //    ⚠️ 빈 행은 안 생긴다 — 아래 keepUsedRows가 실제 셀이 있는 행만 남긴다.
      for (const c of cluster) {
        for (const r of c.periodRows) {
          if (winRows.has(r.order) || !presentOrders.has(r.order)) continue;
          winRows.set(r.order, { order: r.order, label: r.label, time: r.time });
        }
      }
      // 요일축 = 평일 섹션은 항상 월~금(5열), 주말 섹션은 실제 주말요일.
      // 그룹 축은 **폴백·집계용**(렌더는 카드별 `card.days`). 평일 섹션은 월~금을 항상 보장하되
      // 이 섹션에 실제 등장하는 주말 요일을 뒤에 덧붙인다(혼합 반이 있으면 토/일).
      const days = weekend
        ? DAY_ORDER.filter((d) => WEEKEND.has(d) && daySet.has(d))
        : DAY_ORDER.filter((d) => !WEEKEND.has(d) || daySet.has(d));
      // 위 winRows는 이제 **후보 행 풀**이다(라벨·시각의 출처) — 실제로 그릴 행은 바로 아래에서 고른다.
      // 아무 카드도 안 쓰는 교시 행은 통째로 뺀다(끝단 패딩 포함 — keepUsedRows 주석의 뒤집힌 규약 2건).
      // ⚠️ 그래서 sectionCompact가 여기서 행을 더 지울 일은 없다 — 그 토글의 몫은 **클러스터 분리**뿐이다
      //    (교시 체계가 다른 반을 안 쪼개면 두 체계의 union이 전 행을 덮어 아무것도 안 없어진다).
      const winList = [...winRows.values()].sort((a, b) => a.order - b.order);
      let periodRows = keepUsedRows(winList, new Set([...presentOrders, ...mixedWeekendOrders]));
      // 🔴 주말 섹션 행은 **교시 번호가 아니라 시각(9시·10시·11시)으로** 적는다
      //    (원장 2026-08-11 *"주말수업 9, 10, 11로 맞추란 뜻이야. 123 하지말고"*).
      //    주말은 정시 단위 운영이라 "1교시"라는 번호가 뜻하는 게 없다 — 시계가 곧 축이다.
      // ⚠️ 카드는 자기 첫 교시로 당겨져 있으므로(weekendSelfShift) 14시 시작 반도 "9시" 행에 앉는다.
      //    원장이 "강제로" 3행을 지시한 결과라 행 라벨은 **그 반의 몇 번째 시간**을 가리키는 자리표이고,
      //    그 반의 진짜 시각은 셀(`GridCell.time`, 화면에선 툴팁)이 든다. 시각 범위 부제는 안 적는다 —
      //    "09:00~10:00"까지 적으면 14시 반에 대해 대놓고 틀린 문장이 된다.
      // ⚠️ 한때 라벨을 "9시·10시·11시"(시계)로 바꿨다가 되돌렸다 — 원장이 말한 "123 하지말고 9/10/11"은
      //    주말 섹션이 아니라 **혼합 반이 1·2·3교시와 9·10·11교시로 갈라지던 것**을 뜻했다(위 시프트).
      //    시계 라벨은 여기서도 같은 이유로 거짓이 된다(14시 반이 "9시" 행에 앉는다).
      if (weekend) periodRows = periodRows.map((r) => ({ ...r, time: "" }));
      // 분리된 부그룹은 라벨에 ②③… 접미(같은 "N교시 시작"이 두 박스로 나뉠 때 구분).
      const label = ci === 0 ? cluster[0].groupLabel : `${cluster[0].groupLabel} ${"②③④⑤"[ci - 1] ?? `(${ci + 1})`}`;
      // 🔴 key에 **제목을 넣지 말 것**(2026-08-14). 커스텀 줄의 제목은 배치 편집에서 **입력칸**이라,
      //    한 글자 칠 때마다 key가 바뀌어 섹션이 통째로 리마운트되고 **입력칸이 포커스를 잃는다**
      //    (원장 *"그룹 명 수정시에 뒤로가기가 되어버림"* — 포커스가 body로 빠진 뒤의 백스페이스를
      //    브라우저가 뒤로가기로 해석한다). 커스텀 줄은 **불변 id**로 잡고, 자동 그룹만 라벨로 잡는다
      //    (자동 라벨은 "N교시 시작"이라 사람이 못 바꾼다).
      // ⚠️ 같은 줄의 평일·주말은 groupCustomId가 **같다** → 주말 쪽에 접미를 붙여 key 충돌을 막는다.
      const keyBase = cluster[0].groupCustomId
        ? `${cluster[0].groupCustomId}${weekend ? "::w" : ""}`
        : cluster[0].groupLabel;
      out.push({
        key: `${cluster[0].groupOrder}::${keyBase}::${ci}`,
        label,
        order: cluster[0].groupOrder + ci * 0.001, // 같은 앵커의 부그룹은 바로 뒤에 정렬
        sectionKey: cluster[0].groupOrder,
        compacted: sectionCompact,
        compactable: !weekend,
        customGroupId: cluster[0].groupCustomId,
        cards: cluster,
        periodRows,
        // 접기 계획은 축이 확정된 **뒤** 계산한다(감출 행·앉힐 자리 둘 다 이 목록이 기준).
        rowPlan: planRowSpans(periodRows),
        days,
        rosterRows: {
          // 세 섹션 모두 빈 반도 "-" 한 줄은 보여준다(반이 있는데 명단 칸이 통째로 없으면 오독).
          // 🔴 대기·퇴원도 **항상 자리를 잡는다**(원장 2026-09-07) — 예전엔 0명이면 줄이 통째로 사라져서
          //    누가 퇴원하는 순간 카드가 아래로 밀리고, 옮겨 놓을 자리(드롭 대상)도 화면에 없었다.
          active: clampRows(Math.max(...cluster.map((c) => c.active.length)), ROSTER_ACTIVE_MIN_ROWS),
          hold: clampRows(Math.max(...cluster.map((c) => c.hold.length)), 1),
          withdrawn: clampRows(Math.max(...cluster.map((c) => c.withdrawn.length)), 1),
        },
      });
    });
  }
  return out.sort((a, b) => a.order - b.order);
}

// 솔리드 배경 + 흰 글자라 대비가 충분한 색만(amber·gold 제외 — 흰 글자 대비 미달로 셀 강사명이 안 읽힘).
const TEACHER_PALETTE = ["blue", "purple", "rose", "primary", "danger"] as const;
/** 강사명(라벨) → 결정적 색 키(이름 해시). eywa엔 강사 색 설정이 없어 라벨 해시로 안정 배정. */
export function teacherColor(name: string | null): (typeof TEACHER_PALETTE)[number] {
  if (!name) return "blue";
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TEACHER_PALETTE[h % TEACHER_PALETTE.length];
}
