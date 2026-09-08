/**
 * 반 시간표 슬롯 → 사람이 읽는 요약. 순수 함수(Vitest).
 *
 * 🔴 왜 필요한가(2026-07-30, 실측): 반 상세(/classes/[id])의 '시간표' 카드가 `class_schedules`를
 *    **전 행 그대로** 한 줄씩 그렸다. 그런데 이 테이블은 운영 이력을 함께 담는다(영어 시트 구조
 *    가져오기가 옛 배치를 `valid_to`로 마감하고 새 배치를 넣는다) — injaewon 실데이터에서
 *    전체 1,068행 중 **480행이 이미 만료**. 그래서 카드가
 *     ① **거짓말을 했다** — DP5는 지금 14:20~15:40(하루 2교시)인데 3~7월 배치까지 섞여
 *        16:20·17:00 교시가 아직 있는 것처럼 25줄이 나왔다(활성 반 108개 중 41개가 이 상태).
 *     ② **길었다** — 같은 시각이 요일마다 한 줄씩 반복돼 스크롤을 먹었다.
 *    편집 화면은 이미 `isCurrentSlot`으로 만료 행을 빼고 있었다 — 상세만 안 걸러졌다.
 *
 * 해법: (a) 오늘 기준 current/upcoming/past로 가르고 (b) current를 **시각으로 묶어** 요일을 칩으로
 * 펴고 (c) **붙어 있는 교시는 한 줄로 잇는다**(`mergeAdjacent`, 2026-07-30 원장 지시
 * *"이어지는 시간인데 그냥 이어버리면 안 되나?"*). DP5 = **25줄 → 1줄**(`월~금 14:20~15:40`).
 *
 * ⚠️ 숨긴 건 반드시 밝힌다 — `pastCount`/`upcoming`을 호출부가 카드 아래에 적는다. 조용히 빼면
 *    "왜 내가 넣은 교시가 없지"가 되고, 그건 지금 버그(거짓 표시)를 반대 방향으로 되풀이하는 것이다.
 * ⚠️ 강사·강의실은 묶음 키에 **넣지 않는다**. 슬롯 오버라이드(특히 강의실 132건)가 요일마다 갈려
 *    묶음이 274 → 343줄로 되레 늘고, `slot_teacher_label`은 사람이 아니라 자리(LAB·JJ)일 수 있어
 *    "강사"로 적으면 거짓이 된다. 교시별 강사/강의실은 시간표 화면의 몫.
 */

import { DEFAULT_SHEET_LANG, sheetDowLabel, sheetTf, type SheetLang } from "@/features/teacher-view/i18n";

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const DAY_ORDER: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/**
 * **이 분(分) 이하로 비면 쉬는 시간으로 보고 한 자리로 잇는다** (원장 2026-09-08:
 * *"10분 비는건 사실상 쉬는시간이니 그냥 이런경우에 붙여줘"*).
 *
 * 🔴 **2026-07-30 결정의 명시적 반전**이다 — 그때는 *"10분이라도 비면 쉬었다 다시 앉는 별개 자리"*라
 *    딱 붙은 것(앞 종료 == 뒤 시작)만 이었다. 되돌리지 말 것.
 * 🔑 실측(2026-09-08, 활성 반·오늘 유효 슬롯)으로 안전을 확인했다 — 같은 반·같은 요일에서 연속한 교시
 *    사이의 공백은 **0분 281건 · 10분 35건 · 20분 5건이 전부**다. 저녁·점심 같은 큰 공백이 아예 없어서
 *    "집에 갔다 다시 오는 자리"를 실수로 이을 위험이 없다. ⚠️ 공백이 더 다양해지면 이 값을 다시 재라.
 * 🔴 **20분(5건)은 안 잇는다 — 원장 확정**(2026-09-08 *"20분은 냅두고 10분만"*). 이 값을 올리지 말 것.
 */
export const BREAK_GAP_MINUTES = 10;


/** 요약이 필요로 하는 최소 슬롯 모양 — `ClassScheduleSlot`이 구조적으로 만족한다. */
export type SummarySlot = {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  validFrom?: string | null;
  validTo?: string | null;
};

/** 한 줄 = 같은 요일 집합이 쓰는 **이어진 한 자리**(붙은 교시는 합쳐져 있다). */
export type ScheduleRow = {
  startTime: string;
  endTime: string;
  days: DayKey[];
  /** 이 자리의 주당 회차(= 요일 수. 같은 요일에 같은 시각이 중복된 행이면 커질 수 있다). */
  count: number;
  /** **한 번 앉는 길이**(분) — 붙은 교시를 합친 뒤의 구간. 시각이 깨졌으면 0. */
  minutes: number;
};

/**
 * 한 줄 = **같은 시각 구성을 쓰는 요일 묶음**(2026-09-07 원장 지시 *"요일을 기준으로 시간대를 표시해주면
 * 좋을듯. 시간대를 기준으로 요일을 표시하지말고"*). `ScheduleRow`(시각이 주인, 요일이 칩)의 축을 뒤집은 것.
 *
 * ⚠️ 요일을 **한 줄씩** 세우지 않는다 — 월~금 반이 5줄이 되어 2026-07-30에 "25줄 → 1줄"로 줄인 것을
 *    되돌리게 된다. 시각 구성이 글자까지 같은 요일은 한 줄로 묶는다(`화·금` → 자리 2개).
 */
export type ScheduleDayRow = {
  /** 이 줄이 대표하는 요일들(요일 순). */
  days: DayKey[];
  /** 그 요일에 앉는 자리들 — 붙은 교시는 이어져 있다(`mergeTimeRanges`). 시작시각 순. */
  ranges: { start: string; end: string }[];
  /**
   * 하루에 **가르치는** 총 분 — 원래 슬롯 길이의 합.
   * ⚠️ `ranges`의 폭 합과 다를 수 있다(쉬는 시간을 건너뛰고 이었으므로). 시수는 이 값이다.
   */
  minutes: number;
};

export type ScheduleSummary = {
  /** 오늘 유효한 시각 묶음(시작시각 순). */
  current: ScheduleRow[];
  /** 아직 시작 전(valid_from > 오늘)인 시각 묶음. */
  upcoming: ScheduleRow[];
  /** upcoming 중 가장 이른 시작일(YYYY-MM-DD). 없으면 null. */
  upcomingFrom: string | null;
  /** 만료(valid_to < 오늘)라 화면에서 뺀 슬롯 수 — 카드에 밝힐 것. */
  pastCount: number;
  /** 오늘 기준 운영 요일. ⚠️ 배정 다이얼로그·분리등원 후보는 이 값을 써야 한다(만료 요일 금지). */
  days: DayKey[];
  /**
   * 주당 **앉는 횟수** — 요일축 기준(그 요일에 앉는 자리 수의 합).
   *
   * 🔴 시각축(`current`)으로 세면 안 된다(2026-09-07 실측 112반 중 **12반**이 어긋났다): 요일 집합이
   *    달라 못 이은 조각이 각각 한 회로 세어져, 월요일에 15:00~17:00 한 번 앉는 반이 `주 6회`가 됐다.
   *    이 값의 뜻은 처음부터 "교시 수가 아니라 앉는 횟수"였으니 요일축이 그 정의를 지키는 쪽이다.
   * ⚠️ 완전 중복 슬롯(이력 겹침)은 한 번으로 센다 — 사람은 같은 시각에 두 번 앉지 못한다(실데이터 0건).
   *    중복 자체는 `current[].count`에 그대로 남아 있어 데이터 이상을 놓치지 않는다.
   */
  sessions: number;
  /** 주당 총 분. */
  minutes: number;
  /** 화면용 — current를 **요일 기준**으로 뒤집은 줄들. 숫자(sessions·minutes)는 여기서 만들지 않는다. */
  byDay: ScheduleDayRow[];
  /** 화면용 — upcoming의 요일 기준 줄들. */
  upcomingByDay: ScheduleDayRow[];
};

const ymd = (v: string | null | undefined): string | null =>
  v ? String(v).slice(0, 10) : null;

const hm = (t: string): string => String(t).slice(0, 5);

/** "HH:MM" → 분. 형식이 아니면 null(계산에서 빠진다). */
function toMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 1회 길이(분). 자정을 넘기거나 시각이 깨졌으면 0(음수 시수 금지). */
export function slotMinutes(startTime: string, endTime: string): number {
  const a = toMinutes(startTime);
  const b = toMinutes(endTime);
  if (a === null || b === null) return 0;
  return Math.max(0, b - a);
}

/**
 * 이 슬롯이 오늘 기준 언제인가.
 * · `past` = 종료일이 지났다(`valid_to < today`) — 지난 배치의 이력.
 * · `upcoming` = 아직 시작 전(`valid_from > today`).
 * · `current` = 그 외.
 * ⚠️ `valid_to`는 **포함(inclusive)** — 시간표 쿼리(`valid_to.gte.today`)·`isCurrentSlot`과 같은 경계.
 */
export function slotPhase(
  slot: SummarySlot,
  today: string,
): "current" | "upcoming" | "past" {
  const to = ymd(slot.validTo);
  if (to && to < today) return "past";
  const from = ymd(slot.validFrom);
  if (from && from > today) return "upcoming";
  return "current";
}

const dayIndex = (d: string): number => DAY_ORDER.indexOf(d as DayKey);

/** 같은 시각(시작·종료)끼리 묶어 요일을 편다. 시작시각 → 종료시각 순. */
function groupByTime(slots: SummarySlot[]): ScheduleRow[] {
  const rows = new Map<string, ScheduleRow>();
  for (const s of slots) {
    if (dayIndex(s.dayOfWeek) < 0) continue; // 알 수 없는 요일 값은 버린다(raw 코드 노출 금지)
    const startTime = hm(s.startTime);
    const endTime = hm(s.endTime);
    const key = `${startTime}|${endTime}`;
    const row = rows.get(key);
    if (row) {
      row.count += 1;
      if (!row.days.includes(s.dayOfWeek as DayKey)) row.days.push(s.dayOfWeek as DayKey);
    } else {
      rows.set(key, {
        startTime,
        endTime,
        days: [s.dayOfWeek as DayKey],
        count: 1,
        minutes: slotMinutes(startTime, endTime),
      });
    }
  }
  return mergeAdjacent(
    [...rows.values()].map((r) => ({
      ...r,
      days: r.days.sort((a, b) => dayIndex(a) - dayIndex(b)),
    })),
  );
}

const byStart = (a: ScheduleRow, b: ScheduleRow) =>
  a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime);

/**
 * 붙어 있는 교시를 한 줄로 잇는다 — 원장 지시(2026-07-30) *"이어지는 시간인데 그냥 이어버리면 안 되나?"*.
 * DP5 = `14:20~15:00` + `15:00~15:40` → **`14:20~15:40`**(2줄 → 1줄). 학부모·강사에게 이 반은
 * "2시 20분부터 3시 40분까지" 한 덩어리지, 40분짜리 두 개가 아니다.
 *
 * ⚠️ **여기(시각 축)는 딱 붙었을 때만 잇는다**(앞 종료 == 뒤 시작) — 이 줄들이 **시수(`minutes`)의 재료**라
 *    쉬는 시간을 건너뛰고 이으면 안 가르친 10분이 시수에 들어간다.
 * 🔑 화면에 보이는 **요일 축(`groupByDay`)은 반대로 쉬는 시간을 잇는다**(원장 2026-09-08). 두 축의 규칙이
 *    다른 건 목적이 다르기 때문이다 — 요일 축은 "언제부터 언제까지 앉아 있나", 시각 축은 "몇 분 가르치나".
 * ⚠️ **요일 집합이 같을 때만.** 월만 2교시인데 월~금을 통째로 이으면 화~금이 거짓이 된다.
 * ⚠️ 같은 요일에 같은 시각이 두 번 있는 행(`count > days.length`)은 잇지 않는다 — 어느 쪽을 이을지
 *    결정할 근거가 없다.
 * 📌 **주당 총 시수는 불변** — 붙은 구간만 이으므로 부분 합 == 이은 구간(DP5 40×10 = 80×5 = 400분).
 * 📌 교시 경계가 필요하면 시간표 화면·반 수정이 원본을 그대로 보여준다(여긴 요약이다).
 */
function mergeAdjacent(rows: ScheduleRow[]): ScheduleRow[] {
  const byDays = new Map<string, ScheduleRow[]>();
  for (const r of rows) {
    const key = r.days.join(",");
    const bucket = byDays.get(key);
    if (bucket) bucket.push(r);
    else byDays.set(key, [r]);
  }
  const out: ScheduleRow[] = [];
  for (const bucket of byDays.values()) {
    for (const row of [...bucket].sort(byStart)) {
      const open = out[out.length - 1];
      // 딱 붙었고(종료==시작) 양쪽 다 요일마다 1회씩일 때만 잇는다 — 조건 근거는 위 docblock.
      // ⚠️ `out`의 마지막 줄은 **같은 요일 집합 버킷 안에서만** 후보다(버킷이 바뀌면 days가 달라 걸러진다).
      if (
        open &&
        open.days.length === row.days.length &&
        open.days.every((d, i) => d === row.days[i]) &&
        open.endTime === row.startTime &&
        open.count === open.days.length &&
        row.count === row.days.length
      ) {
        open.endTime = row.endTime;
        open.minutes = slotMinutes(open.startTime, row.endTime);
      } else {
        out.push({ ...row });
      }
    }
  }
  return out.sort(byStart);
}

/**
 * 요일 기준 줄 — 요일마다 자리를 모아 붙은 교시를 잇고, **시각 구성이 같은 요일끼리 묶는다.**
 *
 * 🔑 시각 묶음(`groupByTime`)과 답이 다를 수 있고 그게 맞다: `월~금 14:20~15:00` + `월 15:00~15:40`은
 *    시각 축에선 요일 집합이 달라 못 이어 2줄이지만(`mergeAdjacent` 규칙), 요일 축에선
 *    **월 14:20~15:40 / 화~금 14:20~15:00**으로 각 요일의 사실을 그대로 말한다.
 * 🔴 여기서는 **쉬는 시간(<=`BREAK_GAP_MINUTES`)도 건너뛰고 잇는다**(원장 2026-09-08). 그래서 `ranges`의
 *    폭 합 != `minutes`일 수 있다 — 시수는 원래 슬롯에서 따로 더한다(아래 주석).
 * ⚠️ `mergeTimeRanges`가 완전 중복 구간을 한 번만 남긴다 — 화면 줄이 목적이라 맞다(회차·시수는
 *    여기서 만들지 않고 `current`(ScheduleRow)가 그대로 담당한다).
 */
export function groupByDay(slots: SummarySlot[]): ScheduleDayRow[] {
  const byDay = new Map<DayKey, { start: string; end: string }[]>();
  for (const s of slots) {
    if (dayIndex(s.dayOfWeek) < 0) continue; // 알 수 없는 요일 값은 버린다(raw 코드 노출 금지)
    const day = s.dayOfWeek as DayKey;
    const list = byDay.get(day) ?? [];
    list.push({ start: hm(s.startTime), end: hm(s.endTime) });
    byDay.set(day, list);
  }
  const bySig = new Map<string, ScheduleDayRow>();
  for (const day of DAY_ORDER) {
    const raw = byDay.get(day);
    if (!raw) continue;
    const ranges = mergeTimeRanges(raw);
    // 🔴 수업 분(分)은 **이어진 폭이 아니라 원래 슬롯 길이의 합**이다 — 쉬는 시간을 건너뛰고 이었으니
    //    `end - start`로 재면 안 가르친 10분이 시수에 들어간다(원장이 이으라 한 건 **표시**다).
    const seen = new Set<string>();
    const minutes = raw.reduce((n, r) => {
      const key = `${r.start}~${r.end}`;
      if (seen.has(key)) return n; // 완전 중복(이력 겹침)은 한 번만 — mergeTimeRanges와 같은 규칙
      seen.add(key);
      return n + slotMinutes(r.start, r.end);
    }, 0);
    const sig = ranges.map((r) => `${r.start}~${r.end}`).join("|");
    const row = bySig.get(sig);
    if (row) row.days.push(day);
    else bySig.set(sig, { days: [day], ranges, minutes });
  }
  // 요일 축이므로 **가장 이른 요일 순** — 시각 순으로 정렬하면 다시 시각이 주인이 된다.
  return [...bySig.values()].sort((a, b) => dayIndex(a.days[0]) - dayIndex(b.days[0]));
}

export function summarizeSchedule(slots: SummarySlot[], today: string): ScheduleSummary {
  const current: SummarySlot[] = [];
  const upcoming: SummarySlot[] = [];
  let pastCount = 0;
  let upcomingFrom: string | null = null;
  for (const s of slots) {
    const phase = slotPhase(s, today);
    if (phase === "past") {
      pastCount += 1;
    } else if (phase === "upcoming") {
      upcoming.push(s);
      const from = ymd(s.validFrom);
      if (from && (!upcomingFrom || from < upcomingFrom)) upcomingFrom = from;
    } else {
      current.push(s);
    }
  }
  const currentRows = groupByTime(current);
  const dayRows = groupByDay(current);
  const days = DAY_ORDER.filter((d) => currentRows.some((r) => r.days.includes(d)));
  return {
    current: currentRows,
    upcoming: groupByTime(upcoming),
    upcomingFrom,
    pastCount,
    days,
    sessions: dayRows.reduce((n, r) => n + r.days.length * r.ranges.length, 0),
    // ⚠️ 시수는 **시각축 그대로** 둔다 — 이어붙여도 총합이 안 변한다는 성질이 테스트로 잠겨 있고,
    //    중복 슬롯도 정직하게 더한다(회차와 달리 "두 번 적힌 40분"은 데이터 이상으로 남는 편이 낫다).
    //    실측 112반 전부 두 축의 분(分)이 같다 — 갈릴 일이 있다면 그건 중복 행이 있다는 신호다.
    minutes: currentRows.reduce((n, r) => n + r.minutes * r.count, 0),
    byDay: dayRows,
    upcomingByDay: groupByDay(upcoming),
  };
}

/**
 * 요일 묶음 라벨 — "월·목", 3일 이상 이어지면 "월~금"으로 접는다.
 * (실측 요일 조합은 월·목 28반 / 화·금 21반처럼 2일이 대부분이라 접기는 주 5일 반에서만 걸린다.)
 */
export function formatDays(days: DayKey[], lang: SheetLang = DEFAULT_SHEET_LANG): string {
  const sorted = [...new Set(days)].sort((a, b) => dayIndex(a) - dayIndex(b));
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && dayIndex(sorted[j + 1]) === dayIndex(sorted[j]) + 1) j += 1;
    const runLength = j - i + 1;
    if (runLength >= 3) {
      parts.push(`${sheetDowLabel(sorted[i], lang)}~${sheetDowLabel(sorted[j], lang)}`);
    } else {
      for (let k = i; k <= j; k += 1) parts.push(sheetDowLabel(sorted[k], lang));
    }
    i = j + 1;
  }
  return parts.join("·");
}

/** "1시간 40분" / "40분" — 주당 시수 표시용. 0이면 빈 문자열. 인자를 안 주면 한국어. */
export function formatMinutes(total: number, lang: SheetLang = DEFAULT_SHEET_LANG): string {
  if (!Number.isFinite(total) || total <= 0) return "";
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return sheetTf(lang, "cls.sch.min", { m });
  if (m === 0) return sheetTf(lang, "cls.sch.hour", { h });
  return sheetTf(lang, "cls.sch.hourMin", { h, m });
}

/** 대화형 비서·요약 텍스트용 한 줄 표기 — "월·목 14:20~15:00". */
export function formatRow(row: ScheduleRow): string {
  return `${formatDays(row.days)} ${row.startTime}~${row.endTime}`;
}

/**
 * (시작,종료) 시각 구간들을 시작시각순 정렬 후 **딱 붙은 것만** 잇는다 — mergeAdjacent와 같은 규칙의
 * 구간 버전(학생 상세 '수업' 탭 스케줄 셀용, 2026-08-18 원장 *"영어 수업을 스마트하게 보여주면 좋겠는데"*).
 * 영어는 40분 교시가 연달아 붙어 `16:20~17:20`+`17:20~18:10` 나열이 길었다 → `16:20~18:10` 한 구간.
 * 🔴 **쉬는 시간(<=`BREAK_GAP_MINUTES`)은 건너뛰고 잇는다**(원장 2026-09-08 — 2026-07-30 결정의 반전).
 *    `19:20~20:10` + `20:20~22:00` → **`19:20~22:00`**. 근거·안전 확인은 그 상수의 docblock에.
 * ⚠️ 이건 **표시용 구간**이다 — 이어진 폭(끝-시작)에는 쉬는 10분이 들어 있으니 **시수로 쓰지 말 것**.
 *    수업 분(分)은 원래 슬롯 길이를 따로 더한다(`groupByDay`의 minutes, `mergeAdjacent`의 시각 축).
 * ⚠️ 겹치는 구간(17:00~17:40 vs 17:20~18:10)은 잇지 않는다 — 겹침은 데이터 이상이라 그대로 보여야 눈에 띈다.
 */
export function mergeTimeRanges(
  ranges: Array<{ start: string; end: string }>,
  maxGapMinutes: number = BREAK_GAP_MINUTES,
): Array<{ start: string; end: string }> {
  const sorted = [...ranges]
    .map((r) => ({ start: hm(r.start), end: hm(r.end) }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  // 완전 중복(이력 행 분할)은 **병합 전에** 걸러야 한다 — 병합 후 비교(out 끝 구간)는 이미 이어진
  // 구간과 대조라 [A, B, B]에서 두 번째 B가 새 구간으로 새어 유령 겹침이 남는다(적대 리뷰 L1).
  const seen = new Set<string>();
  const out: Array<{ start: string; end: string }> = [];
  for (const r of sorted) {
    const key = `${r.start}~${r.end}`;
    if (seen.has(key)) continue; // 완전 중복(이력 중첩)은 한 번만
    seen.add(key);
    const open = out[out.length - 1];
    // 0 <= 공백 <= 허용치일 때만 잇는다. 음수(겹침)는 데이터 이상이라 안 잇고 그대로 드러낸다.
    const gap = open ? (toMinutes(r.start) ?? 0) - (toMinutes(open.end) ?? 0) : Number.NaN;
    if (open && gap >= 0 && gap <= maxGapMinutes) {
      // ⚠️ 끝을 **앞으로 되감지 않는다** — 시각이 깨진 행(종료<시작)이 섞이면 구간이 조용히 잘린다.
      if (r.end > open.end) open.end = r.end;
    } else out.push({ ...r });
  }
  return out;
}
