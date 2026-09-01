/**
 * EiE **월간 계획서(MP)** 의 격자 규칙 — 순수(Vitest). 서버·클라·인쇄가 함께 쓰므로
 * `server-only` 금지([[#61]]).
 *
 * 원장 2026-09-01: *"미리 입력하는 월간 뷰와, 실제로 수업진행하면서 입력하는 주간뷰를 비교할 수 있게
 * 하려고 함."* → **월간 = 계획(사전) / 주간 시트 = 실제(수업하며)**.
 *
 * 이 파일이 정하는 것은 셋뿐이다.
 *  ① **열 구성**(요일마다 다르다) — 저장하지 않고 `ebook` 칸의 **존재**에서 파생한다.
 *  ② **휴강 판정**(학원설정 휴일 + 반별 명시 예외).
 *  ③ 칸 조회 키.
 * 그리기·조회·권한은 각 화면이 한다.
 */
import type { DowKey } from "./week";
import { dowKeyOf } from "./week";

/** DB `class_month_plan_cells.col_kind`. `off`는 열이 아니라 그 날의 상태 표식이다. */
export type MpColKind = "in_class" | "homework" | "ebook" | "test" | "off";

/**
 * 화면·인쇄에 실제로 열로 서는 칸 — **순서가 곧 열 순서**다(원본 시트 그대로).
 * 🔴 `ebook`이 `test` 앞이다(시트: `In-class | Homework | e-book | Test`).
 */
export const MP_BASE_COLUMNS = ["in_class", "homework", "test"] as const;
export const MP_ALL_COLUMNS = ["in_class", "homework", "ebook", "test"] as const;
export type MpColumnKind = (typeof MP_ALL_COLUMNS)[number];

/**
 * 열 라벨 — **원본 문서의 표기 그대로**다(raw enum 키 노출 금지 규칙의 단일 출처).
 * 학부모에게 나가는 인쇄물이 지금 쓰는 구글 시트와 같은 글자를 써야 해서 한글로 옮기지 않는다.
 */
export const MP_COLUMN_LABEL: Record<MpColumnKind, string> = {
  in_class: "In-class",
  homework: "Homework",
  ebook: "e-book",
  test: "Test",
};

/** 편집 화면에서 칸이 무엇인지 한 줄로(스크린리더 이름 · 툴팁). 라벨만으론 안 읽히는 자리용. */
export const MP_COLUMN_HINT: Record<MpColumnKind, string> = {
  in_class: "그 날 수업에서 나갈 교재·범위",
  homework: "그 날 내줄 과제(여러 줄 가능)",
  ebook: "e-book 과제(요일마다 있을 수도, 없을 수도)",
  test: "그 날 단어시험 범위(없으면 NO TEST)",
};

export const MP_DOW_LABEL_EN: Record<DowKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

/** 한 칸. `body`는 빈 문자열일 수 있다(= 열은 섰는데 아직 안 적음). */
export type MpCell = { planDate: string; colKind: MpColKind; body: string };

/** `YYYY-MM-DD|col_kind` — 칸 조회 키(저장 키와 같은 표기). */
export function mpCellKey(date: string, colKind: MpColKind): string {
  return `${date}|${colKind}`;
}

export type MpCellMap = Record<string, string>;

/** 행 목록 → 칸 맵. 같은 키가 둘이면(있을 수 없지만) 뒤엣것이 이긴다 — 유니크가 이미 막는다. */
export function mpCellMapOf(cells: readonly MpCell[]): MpCellMap {
  const out: MpCellMap = {};
  for (const c of cells) out[mpCellKey(c.planDate, c.colKind)] = c.body;
  return out;
}

/** 그 칸에 **사람이 적은 내용**이 있나 — 공백만이면 없는 것으로 본다(빈 ebook 행이 열만 세운다). */
export function mpHasBody(map: MpCellMap, date: string, colKind: MpColKind): boolean {
  return (map[mpCellKey(date, colKind)] ?? "").trim() !== "";
}

/**
 * 그 요일의 열 구성 — 기본 3열, **그 요일 어느 날에라도 `ebook` 칸이 있으면** 4열.
 *
 * 🔴 열 구성을 설정으로 저장하지 않는 이유: 시트는 반마다·요일마다 다르다(LE1은 화요일만 e-book,
 *    목·금은 3열 / PL3은 전 요일 3열). 설정 표를 하나 더 두면 "설정은 4열인데 칸은 3열" 같은
 *    어긋남이 생긴다 — 칸이 곧 사실이다.
 * ⚠️ **행의 존재**로 판정한다(내용이 아니라) — "e-book 열 추가"가 빈 칸을 만들어 열을 세우고,
 *    "열 숨기기"가 그 칸들을 지워 열을 내린다.
 */
export function mpColumnsForDow(
  dow: DowKey,
  dates: readonly string[],
  cells: readonly MpCell[],
): MpColumnKind[] {
  const has = cells.some(
    (c) => c.colKind === "ebook" && dowKeyOf(c.planDate) === dow && dates.includes(c.planDate),
  );
  return has ? [...MP_ALL_COLUMNS] : [...MP_BASE_COLUMNS];
}

/**
 * 휴강 명시 예외(`col_kind='off'`)의 값. 행이 없으면 `auto` = 학원설정 휴일을 그대로 따른다.
 * ⚠️ 이 칸의 body는 **자유 텍스트가 아니다**(다른 칸과 유일하게 다른 점).
 */
export type MpOffOverride = "auto" | "off" | "open";

export function readMpOffOverride(raw: string | null | undefined): MpOffOverride {
  const v = (raw ?? "").trim();
  return v === "off" || v === "open" ? v : "auto";
}

/**
 * 그 날 이 반이 쉬는가.
 *
 * 기본은 **학원설정 `operations.holidays`**(2026-09-01 원장이 2027년까지 등록 — 그전엔 3건뿐이라
 * 자동 생성한 날짜에 추석이 그대로 남았다). 🔴 `features/calendar/holidays.ts`의 내장 법정공휴일
 * 표를 쓰지 말 것 — 그건 캘린더 탭 전용이고 **학원 휴원일이 아니다**.
 *
 * ⚠️ 법정공휴일인데 학원이 수업하는 날이 실제로 있다(2026-08-17 대체공휴일에 출결 21행) → 그래서
 *    반별 명시 예외가 설정을 이긴다. 반대로 설정에 없는 날을 강사가 끌 수도 있다.
 * ⚠️ 휴일 **목록**은 앱 전체가 한 벌을 본다(`buildHolidayMap(settings.operations.holidays)`) —
 *    2026-09-01 오후 원장 지시(*"ecs/mcs 휴일참조 시켜"*)로 주간 시트·달력·진도표·MCS도 같은 맵을
 *    읽는다(규약 = [`holiday.ts`](./holiday.ts): 안 쓴 휴일=분모 밖 · 쓴 휴일=100% 인정).
 * ⚠️ **다른 것은 반별 예외(`override`)뿐이다** — 그건 MP 칸에만 있고 저쪽엔 없다. 그러니 저쪽 판정에
 *    이 함수를 끌어다 쓰지 말 것(같은 날을 두 화면이 다르게 부르게 된다).
 */
export function mpDayIsOff(
  date: string,
  holidayMap: Readonly<Record<string, string>>,
  override: MpOffOverride,
): boolean {
  if (override === "off") return true;
  if (override === "open") return false;
  return Boolean(holidayMap[date]);
}

/** 칸 맵에서 그 날의 명시 예외를 읽는다. */
export function mpOffOverrideOf(map: MpCellMap, date: string): MpOffOverride {
  return readMpOffOverride(map[mpCellKey(date, "off")]);
}

/**
 * 휴강 토글이 저장할 값 — **자동 판정과 같아지면 행을 지운다**(`null`).
 *
 * 🔑 지우는 게 중요하다: 명시 예외를 남겨 두면 나중에 원장이 학원설정 휴일을 고쳐도 그 반만
 *    옛 판정에 묶인다(설정을 바꿔도 화면이 안 바뀌는 "설정 무시"의 씨앗).
 */
export function mpOffToggleValue(
  date: string,
  holidayMap: Readonly<Record<string, string>>,
  nextOff: boolean,
): "off" | "open" | null {
  const auto = Boolean(holidayMap[date]);
  if (auto === nextOff) return null;
  return nextOff ? "off" : "open";
}

/**
 * 인쇄물 꼬리말의 기간 표기 — `9월 1일 ~ 9월 30일`.
 * ⚠️ 값은 **`operating_periods`가 해석한 창**(`resolvePeriodWindow`)에서 온다 — 문자열을 하드코딩하지
 *    말 것(세션이 라벨월을 넘길 수 있어 "9월 1일~30일"이 항상 맞지는 않다).
 */
export function mpPeriodRangeLabel(window: { start: string; end: string }): string {
  const one = (iso: string) => `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(window.start) || !/^\d{4}-\d{2}-\d{2}$/.test(window.end)) return "";
  return `${one(window.start)} ~ ${one(window.end)}`;
}

/** 그 달에서 이 반이 실제로 쓰는 날 — 배정이 있고(수업일) 휴강이 아닌 날. */
export function mpActiveDates(
  dates: readonly string[],
  hasClassOn: (date: string) => boolean,
  isOff: (date: string) => boolean,
): string[] {
  return dates.filter((d) => hasClassOn(d) && !isOff(d));
}
