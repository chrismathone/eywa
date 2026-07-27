// 통합뷰(반=열 리치 그리드) 데이터 도출 — ijw EnglishClassTab 이식. 순수 함수(테스트 강제).
// 한 과목 슬롯을 **반(class)별 카드**로 묶고 **시작 교시별 섹션**으로 그룹화. 각 카드:
// 헤더(반명·담임·요일별 강의실) + **요일×교시 미니그리드**(셀마다 강사/LAB, ijw slotTeachers) + 재원/대기/퇴원.
// 셀 강사·LAB·요일별 강의실은 슬롯 라벨(class_schedules.slot_teacher_label/slot_room_label, 0041a 백필)에서 온다.
// ⚠️ server-only 금지 — 클라(rich-card-group)도 import. 순수·plain만.
import {
  slotPeriodRow,
  weekdayPeriodRowOrNull,
  subjectPeriodRows,
  enumDayToKo,
  type DayOfWeek,
  type PeriodsConfig,
  type TimetableSubject,
} from "./periods";

export type GridStudent = {
  name: string;
  grade: string | null;
  school: string | null;
  studentId?: string;
  status: "active" | "hold" | "withdrawn";
  isNew?: boolean;
  isTransferredIn?: boolean;
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

export type GridCell = { label: string; isLab: boolean };
export type GridPeriodRow = {
  order: number;
  label: string;
  time: string;
  /**
   * 이 행이 **축 생략(물결) 마커**면 접힌 교시 수. 일반 교시 행이면 undefined.
   * 막대그래프에서 최대·최소 차가 클 때 축을 끊고 물결을 넣는 것과 같은 표기(원장 2026-07-27).
   * `label`엔 접힌 교시 목록("7·8교시")이 들어가 툴팁으로 쓰인다.
   */
  gapRows?: number;
};

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
   * 이 **카드**가 실제 수업하는 요일축(ijw `finalDays` 이식, 2026-07-23 원장 지시).
   *
   * 🔴 왜 카드별인가: 예전엔 섹션 공통 요일축이 평일=월~금 **고정**이라, 평일+토 **혼합 반**의
   * 토요일 수업이 통합뷰에서 **통째로 사라졌다**(실측 4개 반·주말 슬롯 21개 — 반 이름이
   * "고등M 고1 BS4F 토"인데 정작 토요일이 안 보였다). 주말 **전용** 반만 별도 섹션으로 잘 나왔다.
   * ijw 통합뷰는 카드마다 자기 요일축(`finalDays`)을 써서 토요일이 있는 반에만 토 열이 붙는다.
   * → 같은 규약으로 되돌린다. 다른 반 카드에 빈 토 열이 생기지 않는다.
   * ⚠️ 셀은 (그룹 교시행 × 카드 요일)로 조회하므로, 주말 슬롯의 교시 order도 그룹 축에 있어야 보인다
   *    (아래 presentOrders에서 혼합 카드의 주말 order를 함께 넣는 이유).
   */
  days: DayOfWeek[];
  /**
   * **표시용** 요일축 — 항상 5칸(월~금 기준, `buildAxisDays` 참조). 렌더는 이걸 쓴다.
   * `days`(실제 수업 요일)와 분리한 이유: 실제 요일은 집계·테스트가 쓰는 사실이고, 축은 열 너비를
   * 고정하기 위한 표시 규약이라 서로 다른 관심사다. `null`은 라벨 없는 빈 칸(주말 섹션 패딩).
   */
  axisDays: (DayOfWeek | null)[];
  /**
   * 커스텀 그룹 안에서의 열 순서(그룹 정의에 적힌 반 순서). 미설정(자동 그룹)이면 undefined → 가나다.
   * 원장 시트의 좌우 순서를 그대로 재현하기 위한 값이라 **정의 순서가 곧 화면 순서**다.
   */
  groupSeq?: number;
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
};

const DAY_ORDER: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const WEEKEND = new Set<string>(["sat", "sun"]);
const WEEKDAYS: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri"];
/** 명단 섹션 최대 표시 행수(원장 2026-07-27 "최대 12명"). 넘치면 카드 안에서 스크롤(스크롤바 숨김+페이드). */
export const ROSTER_ROW_CAP = 12;

/** 교시표를 시각순으로 세우고 order→인덱스 맵을 만든다(시프트는 '분'이 아니라 '몇 번째 교시'로 센다). */
function periodIndexByOrder(rows: readonly { order: number; label: string; time: string }[]) {
  const sorted = [...rows].sort((a, b) => a.order - b.order);
  const byOrder = new Map<number, number>();
  sorted.forEach((r, i) => byOrder.set(r.order, i));
  return { rows: sorted, byOrder };
}

/**
 * 주말 슬롯의 교시 행을 **평일 교시 행으로 끌어올린다**(ijw `weekendShift` 이식, 원장 2026-07-27).
 *
 * 🔴 왜: 평일+토 혼합 반은 토요일 교시(예 09:00~)가 평일 교시표에 없는 시각이라, 예전엔 그 order를 축에
 * **행으로 추가**했다 → 같은 섹션의 **모든 카드**에 빈 행이 생겨 그리드가 세로로 늘어났다(실측 6행: 위 3행
 * 토·일 / 아래 3행 평일). ijw 영어 통합뷰는 주말 교시를 평일 교시 행에 **얹어** 행을 공유한다.
 *
 * ⚠️ eywa의 `order`는 교시 번호가 아니라 **자정 기준 분**이라 ijw처럼 번호를 빼면 안 된다(평일 40분·주말
 * 60분 간격이라 분 단위 시프트는 두 번째 교시부터 어긋난다). 그래서 **교시 인덱스** 공간에서 옮긴다:
 * 주말 k번째 교시 → 평일 (k + shift)번째 교시 행.
 *
 * 행의 라벨·시각은 **평일 것**이 된다(ijw도 동일 — 행은 "몇 번째 교시"를 뜻하지 절대 시각이 아니다).
 * 평일 표를 벗어나면(주말 교시가 더 많은 반) 원래 행을 그대로 써서 정보를 잃지 않는다.
 */
function shiftedWeekendRow(
  row: { order: number; label: string; time: string; key?: string },
  weekendIdx: { byOrder: Map<number, number> },
  weekdayRows: readonly { order: number; label: string; time: string }[],
  shift: number,
): { order: number; label: string; time: string } {
  if (shift <= 0) return row;
  const k = weekendIdx.byOrder.get(row.order);
  if (k === undefined) return row;
  return weekdayRows[k + shift] ?? row;
}
const clampRows = (n: number, min: number) => Math.min(ROSTER_ROW_CAP, Math.max(min, Number.isFinite(n) ? n : min));

/**
 * 아무 카드도 쓰지 않는 **중간** 교시 구간을 접어 축 생략(물결) 한 줄로 바꾼다.
 *
 * 🔴 왜(원장 2026-07-27 "그냥 7·8 없애도 되지 않나? 1·2·3 / 9·10·11만 있어도 될 듯 · 중간에 물결처리"):
 * 혼합 반 섹션은 위쪽(토요일이 얹힌 1~3교시)과 아래쪽(평일 9~11교시)만 쓰는데, 그 사이 윈도우 패딩(7·8교시)이
 * 통째로 비어 세로만 먹었다. 막대그래프에서 최대·최소 차가 크면 축을 끊고 물결을 넣는 것과 같은 처리다.
 *
 * ⚠️ **중간만** 접는다 — 위/아래 끝의 빈 패딩 행은 그대로 둔다(5칸 윈도우의 컨텍스트 보존,
 * 2026-07-06 사용자 결정). 접을 게 없으면 입력을 그대로 돌려준다(참조 동일).
 */
export function collapseEmptyRuns(rows: GridPeriodRow[], usedOrders: Set<number>): GridPeriodRow[] {
  const firstUsed = rows.findIndex((r) => usedOrders.has(r.order));
  const lastUsed = rows.findLastIndex((r) => usedOrders.has(r.order));
  if (firstUsed < 0 || lastUsed <= firstUsed) return rows;
  const out: GridPeriodRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    // 끝단 패딩이거나 실제로 쓰는 행이면 그대로.
    if (i < firstUsed || i > lastUsed || usedOrders.has(r.order)) {
      out.push(r);
      continue;
    }
    // 중간의 빈 구간 — 연속 구간을 통째로 한 줄로.
    let j = i;
    while (j <= lastUsed && !usedOrders.has(rows[j].order)) j++;
    const run = rows.slice(i, j);
    out.push({
      order: run[0].order,
      label: run.map((x) => x.label).join("·"),
      time: "",
      gapRows: run.length,
    });
    i = j - 1;
  }
  return out;
}
/** 통합뷰 카드 요일축의 **고정 열 수**(월~금 5일 기준). 요일이 늘고 줄어도 열 너비가 변하지 않게 하는 상수. */
export const AXIS_COLS = 5;

/**
 * 통합뷰 카드의 **표시 요일축** — 항상 `AXIS_COLS`(5)칸. ijw `useEnglishClasses`의 `finalDays` 이식.
 *
 * 🔴 왜 5칸 고정인가(원장 지시 2026-07-27): 예전엔 카드가 **실제 수업 요일만** 열로 그려서, 2요일 반은
 * 열 2개(폭 88px)·5요일 반은 열 5개(폭 35px)로 **한 칸 너비가 카드마다 달랐다**. 시트처럼 읽히려면
 * 열 너비가 카드 간 같아야 한다 → 축을 월~금 5칸으로 못박고, 남는 요일은 빈 칸으로 둔다.
 *
 * 🔴 그러면서도 토요일은 안 잃는다(2026-07-23 회귀 방지, [[class-grid-saturday.test.ts]]): 평일 섹션의
 * 축을 월~금 **고정**으로 되돌리면 평일+토 혼합 반의 토요일이 통째로 사라졌었다. ijw 영어 규약은
 * **주말 요일이 "그 반이 안 쓰는 평일" 칸을 대체**하는 것 — 열 수는 5로 유지되면서 토 열이 생긴다.
 * (대체할 빈 평일이 없으면 금요일 칸을 내준다 = ijw 폴백 동일.)
 *
 * 주말 **전용** 반은 별도 주말 섹션이라 평일 라벨이 노이즈다 → 실제 주말 요일만 앞에 두고 나머지는
 * `null`(빈 칸)로 채운다. 열 수는 5 그대로라 너비 불변 규칙은 지켜진다.
 */
export function buildAxisDays(activeDays: DayOfWeek[], weekendOnly: boolean): (DayOfWeek | null)[] {
  const active = new Set<DayOfWeek>(activeDays);
  if (weekendOnly) {
    const used = DAY_ORDER.filter((d) => WEEKEND.has(d) && active.has(d));
    return [...used, ...Array<null>(Math.max(0, AXIS_COLS - used.length)).fill(null)].slice(0, AXIS_COLS);
  }
  const axis: DayOfWeek[] = [...WEEKDAYS];
  for (const wknd of DAY_ORDER.filter((d) => WEEKEND.has(d) && active.has(d))) {
    if (axis.includes(wknd)) continue;
    // 이 반이 **안 쓰는** 평일 칸을 내준다(빈 칸이면 정보 손실 0). 전부 쓰면 ijw와 동일하게 금요일 칸.
    const free = axis.findIndex((d) => !active.has(d));
    axis[free === -1 ? AXIS_COLS - 1 : free] = wknd;
  }
  return axis.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
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

/** "본원304" → "304"(공통 건물 접두사 제거로 라벨 압축). "LAB실"·타건물은 그대로 — 건물 구분 유지. */
function shortRoom(room: string): string {
  return room.replace(/^본원/, "") || room;
}

/**
 * 요일별 강의실 → "월수 304 / 목 LAB실·304". 한 요일에 교시마다 강의실이 다르면(LAB 교시 등)
 * 그 요일의 강의실을 "·"로 모아 보여주고(ijw "목 LAB실-본원304" 패턴), 같은 강의실 집합인 요일끼리 묶는다.
 * 전부 같으면 단일, 비면 "-". 방 이름은 shortRoom으로 공통 "본원" 접두사를 떼 압축.
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
      });
      continue;
    }
    const title = groups[idx].title.trim();
    out.push({
      ...c,
      groupOrder: CUSTOM_BASE + idx * 10 + (c.weekendOnly ? 1 : 0),
      groupLabel: c.weekendOnly ? `${title} (주말)` : title,
      groupSeq: seqOf.get(c.classId),
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
      const onWeekday = isW && hasWeekday ? weekdayPeriodRowOrNull(subject, s.startTime, config) : null;
      return {
        s,
        day,
        row: onWeekday ?? slotPeriodRow(subject, s.startTime, day, config),
        weekend: isW,
        // 이미 평일 행에 앉은 주말 슬롯은 시프트 대상이 아니다(더 옮기면 엉뚱한 교시로 간다).
        shiftable: isW && !onWeekday,
      };
    });
    let wdStartIdx = Infinity;
    let wkStartIdx = Infinity;
    for (const { row, weekend: isW, shiftable } of scanned) {
      if (isW && !shiftable) {
        // 평일 행에 앉은 주말 슬롯은 평일 기준점에 포함(시프트 폭 계산의 앵커가 흔들리지 않게).
        const i = weekdayIdx.byOrder.get(row.order);
        if (i !== undefined) wdStartIdx = Math.min(wdStartIdx, i);
        continue;
      }
      const i = (isW ? weekendIdx : weekdayIdx).byOrder.get(row.order);
      if (i === undefined) continue;
      if (isW) wkStartIdx = Math.min(wkStartIdx, i);
      else wdStartIdx = Math.min(wdStartIdx, i);
    }
    // 주말 교시를 평일 교시 행으로 끌어올리는 폭(교시 **개수** 단위). ijw `useEnglishClasses`의 weekendShift 이식.
    const weekendShift =
      wdStartIdx !== Infinity && wkStartIdx !== Infinity && wdStartIdx > wkStartIdx ? wdStartIdx - wkStartIdx : 0;

    for (const { s, day, row, weekend: isW, shiftable } of scanned) {
      // 혼합 반의 주말 슬롯은 **평일 교시 행에 얹는다** — 새 행을 만들지 않는다(shiftedWeekendRow 주석).
      const eff = isW && shiftable ? shiftedWeekendRow(row, weekendIdx, weekdayRows, weekendShift) : row;
      if (!periodMap.has(eff.order)) periodMap.set(eff.order, { order: eff.order, label: eff.label, time: eff.time });
      const teacher = s.slotTeacherLabel ?? s.teacherName ?? "";
      cells[`${eff.order}:${day}`] = { label: teacher, isLab: s.slotTeacherLabel === "LAB" };
      if (s.slotTeacherLabel && s.slotTeacherLabel !== "LAB")
        slotTeacherCount.set(s.slotTeacherLabel, (slotTeacherCount.get(s.slotTeacherLabel) ?? 0) + 1);
      const room = s.slotRoomLabel ?? s.classroomName;
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
      axisDays: buildAxisDays(cardDays, weekend),
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
      groupOrder: weekend ? WEEKEND_ORDER : weekdayStart,
      groupLabel: weekend ? "주말" : `${periodMap.get(weekdayStart)?.label ?? ""} 시작`,
      weekendOnly: weekend,
    });
  }

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
      // 요일축 = 평일 섹션은 항상 월~금(5열), 주말 섹션은 실제 주말요일.
      // 그룹 축은 **폴백·집계용**(렌더는 카드별 `card.days`). 평일 섹션은 월~금을 항상 보장하되
      // 이 섹션에 실제 등장하는 주말 요일을 뒤에 덧붙인다(혼합 반이 있으면 토/일).
      const days = weekend
        ? DAY_ORDER.filter((d) => WEEKEND.has(d) && daySet.has(d))
        : DAY_ORDER.filter((d) => !WEEKEND.has(d) || daySet.has(d));
      // compact = 이 그룹이 실제 쓰는 교시 범위 [lo,hi] "사이"의 빈 행만 제거.
      // 범위 밖(그룹 위아래 패딩 행)은 유지 — 5칸 윈도우의 컨텍스트 보존(사용자 결정 2026-07-06).
      const winList = [...winRows.values()].sort((a, b) => a.order - b.order);
      let periodRows = winList;
      if (sectionCompact && presentStd.length > 0) {
        const lo = Math.min(...presentStd);
        const hi = Math.max(...presentStd);
        periodRows = winList.filter((r) => r.order <= lo || r.order >= hi || presentOrders.has(r.order));
      }
      // 아무 카드도 안 쓰는 **중간** 교시 구간은 접고 축 생략(물결) 한 줄로 대체한다.
      periodRows = collapseEmptyRuns(periodRows, new Set([...presentOrders, ...mixedWeekendOrders]));
      // 분리된 부그룹은 라벨에 ②③… 접미(같은 "N교시 시작"이 두 박스로 나뉠 때 구분).
      const label = ci === 0 ? cluster[0].groupLabel : `${cluster[0].groupLabel} ${"②③④⑤"[ci - 1] ?? `(${ci + 1})`}`;
      out.push({
        key: `${cluster[0].groupOrder}::${cluster[0].groupLabel}::${ci}`,
        label,
        order: cluster[0].groupOrder + ci * 0.001, // 같은 앵커의 부그룹은 바로 뒤에 정렬
        sectionKey: cluster[0].groupOrder,
        compacted: sectionCompact,
        compactable: !weekend,
        cards: cluster,
        periodRows,
        days,
        rosterRows: {
          // 재원은 빈 반도 "-" 한 줄은 보여준다(반이 있는데 명단 칸이 통째로 없으면 오독).
          active: clampRows(Math.max(...cluster.map((c) => c.active.length)), 1),
          hold: clampRows(Math.max(...cluster.map((c) => c.hold.length)), 0),
          withdrawn: clampRows(Math.max(...cluster.map((c) => c.withdrawn.length)), 0),
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
