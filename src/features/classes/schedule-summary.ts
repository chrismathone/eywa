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
 * 편다. DP5 = 25줄 → 2줄. 전 반 합계 539줄 → 274줄.
 *
 * ⚠️ 숨긴 건 반드시 밝힌다 — `pastCount`/`upcoming`을 호출부가 카드 아래에 적는다. 조용히 빼면
 *    "왜 내가 넣은 교시가 없지"가 되고, 그건 지금 버그(거짓 표시)를 반대 방향으로 되풀이하는 것이다.
 * ⚠️ 강사·강의실은 묶음 키에 **넣지 않는다**. 슬롯 오버라이드(특히 강의실 132건)가 요일마다 갈려
 *    묶음이 274 → 343줄로 되레 늘고, `slot_teacher_label`은 사람이 아니라 자리(LAB·JJ)일 수 있어
 *    "강사"로 적으면 거짓이 된다. 교시별 강사/강의실은 시간표 화면의 몫.
 */

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export const DAY_ORDER: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const DAY_LABEL: Record<DayKey, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

/** 요약이 필요로 하는 최소 슬롯 모양 — `ClassScheduleSlot`이 구조적으로 만족한다. */
export type SummarySlot = {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  validFrom?: string | null;
  validTo?: string | null;
};

/** 한 줄 = 같은 시각을 쓰는 요일 묶음. */
export type ScheduleRow = {
  startTime: string;
  endTime: string;
  days: DayKey[];
  /** 이 시각의 주당 회차(요일 수와 같지만, 같은 요일 중복 행이 있으면 커질 수 있다). */
  count: number;
  /** 1회 수업 길이(분). 시각이 깨졌으면 0. */
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
  /** 주당 총 회차(= current 슬롯 수). */
  sessions: number;
  /** 주당 총 분. */
  minutes: number;
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
  return [...rows.values()]
    .map((r) => ({ ...r, days: r.days.sort((a, b) => dayIndex(a) - dayIndex(b)) }))
    .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime));
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
  const days = DAY_ORDER.filter((d) => currentRows.some((r) => r.days.includes(d)));
  return {
    current: currentRows,
    upcoming: groupByTime(upcoming),
    upcomingFrom,
    pastCount,
    days,
    sessions: currentRows.reduce((n, r) => n + r.count, 0),
    minutes: currentRows.reduce((n, r) => n + r.minutes * r.count, 0),
  };
}

/**
 * 요일 묶음 라벨 — "월·목", 3일 이상 이어지면 "월~금"으로 접는다.
 * (실측 요일 조합은 월·목 28반 / 화·금 21반처럼 2일이 대부분이라 접기는 주 5일 반에서만 걸린다.)
 */
export function formatDays(days: DayKey[]): string {
  const sorted = [...new Set(days)].sort((a, b) => dayIndex(a) - dayIndex(b));
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && dayIndex(sorted[j + 1]) === dayIndex(sorted[j]) + 1) j += 1;
    const runLength = j - i + 1;
    if (runLength >= 3) {
      parts.push(`${DAY_LABEL[sorted[i]]}~${DAY_LABEL[sorted[j]]}`);
    } else {
      for (let k = i; k <= j; k += 1) parts.push(DAY_LABEL[sorted[k]]);
    }
    i = j + 1;
  }
  return parts.join("·");
}

/** "1시간 40분" / "40분" — 주당 시수 표시용. 0이면 빈 문자열. */
export function formatMinutes(total: number): string {
  if (!Number.isFinite(total) || total <= 0) return "";
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

/** 대화형 비서·요약 텍스트용 한 줄 표기 — "월·목 14:20~15:00". */
export function formatRow(row: ScheduleRow): string {
  return `${formatDays(row.days)} ${row.startTime}~${row.endTime}`;
}
