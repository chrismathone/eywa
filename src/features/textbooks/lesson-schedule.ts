/**
 * 교재 차수 → (수업일, 교시) 배분 — **순수**(Vitest). 서버 액션·미리보기·기입이 **같은 답**을 내야 해서
 * 여기 한 곳에서만 정한다. 🔴 규칙을 SQL에도 적지 말 것 — 두 벌이 되면 화면의 미리보기와 실제 기입이
 * 갈린다(0266a RPC는 이 함수의 결과를 받아 쓰기만 한다).
 *
 * 원장 2026-09-16: *"영어 강사 시트에서 **연휴제외** 차수별로 들어가게 … 하루 수업이 2시간이면
 * **1시간씩 차수에 넣을지 2시간씩 차수 넣을지 선택** … **JJ실의 경우 자습실이라 별도**"*.
 *
 * 규칙 셋:
 *  ① **휴일은 차수를 소비하지 않는다.** 판정 자료는 학원설정 `operations.holidays` 하나
 *     ([`holiday.ts`](../class-sheets/lib/holiday.ts)) — 캘린더 탭 내장 법정공휴일 표가 아니다
 *     (법정공휴일 ≠ 학원 휴원일이고 이 학원은 실제로 공휴일에 수업한다).
 *     ⚠️ 휴일에도 **입력은 열려 있다**(ECS 규약) — 여기서 막는 건 "자동으로 차수를 밀어 넣는 것"뿐이다.
 *  ② **축(axis)이 둘이고 섞이지 않는다.** `class` = 정규 수업 교시(자리 아님) / `jj` = JJ(자습실) 교시.
 *     🔴 **LAB은 어느 축에도 안 들어간다** — ECS가 표시·집계에서 언제나 빼는 자리라, 여기서만 넣으면
 *     아무도 안 보는 칸에 기록이 쌓인다(`hiddenSeatOf`의 "LAB은 설정과 무관하게 언제나 제외").
 *  ③ **단위(pace)**: `period` = 교시 하나가 차수 하나(1시간씩) / `day` = 그 날 그 축의 **모든 교시**가
 *     같은 차수(2시간씩). 후자는 지어낸 규칙이 아니라 이미 쓰이는 패턴이다 — 실측(2026-09-16) 교시가
 *     둘 이상인 반-날짜 628건 중 **93건(15%)** 이 두 교시에 같은 (교재, 진도)를 적어 두고 있었다.
 *     `min25` = **25분 수업**(원장 2026-10-13~14). 배치는 `period`와 **똑같이 교시 하나에 차수 하나**다 —
 *     1시간 교시라도 한 차수만 넣고, 남는 25분은 **다른 교재를 같은 교시에 배정**해 채운다(원장 *"25분짜리
 *     1시간수업이라도 하나만 들어가게 … 다른 교재로 또 25분 추가할수있자나"*). 🔴 교시 길이로 차수를 여러 개
 *     밀어 넣지 말 것 — 한 번 그렇게 만들었다가 원장이 되돌렸다. 값이 따로 있는 건 배정 목록에서 "이 교재는
 *     25분짜리"라는 사실을 보이기 위해서다.
 *     → **2026-10-16 원장: 차수는 25분 고정, 단위 선택 없음.** 대신 교시마다 **몇 번째 25분 자리**(1차수·2차수)에
 *       넣을지를 고른다(`"tue|17:20|2"`). "화 1·2차 · 금 1차"면 그 교재가 한 주에 3차수 나간다 — 한 교시에
 *       차수가 둘 들어갈 수 있다(`lessonsInSlot`). 단위 선택은 화면에서 걷었고 저장값은 `min25`다.
 */
import { slotsByDateOf, type MonthScheduleRow, type MonthSlot } from "@/features/class-sheets/lib/month-assemble";
import { holidayNameOn, type HolidayMap } from "@/features/class-sheets/lib/holiday";
import { shiftDays } from "@/features/timetable/lib/week";
import { dowKeyOf } from "@/features/class-sheets/lib/week";
import { LAB_ROOM_LABEL, SELF_STUDY_ROOM_LABEL } from "@/features/timetable/lib/teacher-label";

/** 차수를 태울 교시 축. LAB은 축이 아니다(위 ②). */
export type SlotAxis = "class" | "jj";
/** 차수 1개가 소비하는 단위. */
export type LessonPace = "period" | "day" | "min25";

/**
 * DB·입력의 단위 문자열 → `LessonPace`. 모르는 값은 `period`(가장 오래된 기본값).
 * 🔴 단위를 읽는 자리는 전부 이 함수를 탄다 — 자리마다 `=== "day" ? "day" : "period"`를 적으면
 *    새 단위를 더할 때 한 곳만 빠져도 그 화면만 조용히 다른 단위로 읽힌다.
 */
export function normalizeLessonPace(value: unknown): LessonPace {
  return value === "day" || value === "min25" ? value : "period";
}

/**
 * 시작일부터 몇 날까지 훑을지의 상한. 200차수를 1차수/교시로 태워도(주 6교시 기준 ≈ 233일) 닿는 길이라
 * 넉넉하지만, 무한 루프·과도한 날짜 생성은 막는다. 여기서 끊기면 `unplaced`로 정직하게 보고한다.
 */
export const MAX_LOOKAHEAD_DAYS = 400;

/**
 * 차수 하나가 앉을 자리 한 칸. 같은 `lessonNo`가 여러 칸에 앉을 수 있고(pace="day"), 한 칸에 차수가 둘
 * 앉을 수도 있다(그 교시의 1·2차수 자리를 둘 다 고른 경우 — 순서대로 붙는다).
 */
export type LessonTarget = { lessonNo: number; date: string; slotStart: string };

export type LessonSchedule = {
  /** 날짜·교시 순으로 정렬된 배치 결과. */
  targets: LessonTarget[];
  /** 자리가 모자라 배치하지 못한 차수 번호(상한까지 훑었는데도 수업일이 부족한 경우). */
  unplaced: number[];
  /** 휴일이라 건너뛴 수업일 — 화면이 "연휴 N일을 건너뛰었습니다"로 밝힌다. */
  skippedHolidays: { date: string; name: string }[];
  /** 마지막 차수가 앉은 날짜(없으면 null) — 미리보기 요약용. */
  lastDate: string | null;
};

/** 그 축에 해당하는 교시만 남긴다(시작시각 순은 `slotsByDateOf`가 이미 보장). */
export function slotsOfAxis(slots: readonly MonthSlot[], axis: SlotAxis): MonthSlot[] {
  // ⚠️ 자리 이름은 [`teacher-label.ts`]가 단일 소스다 — 여기 문자열을 박으면 이름이 바뀔 때
  //    JJ 축이 **조용히** 빈다(LAB 쪽은 `=== null`이라 그 위험이 없다).
  return slots.filter((s) => (axis === "jj" ? s.seat === SELF_STUDY_ROOM_LABEL : s.seat === null));
}

/**
 * 고른 교시 한 칸 = **`"요일|시작시각"`**(`"mon|17:20"`).
 *
 * 🔴 **요일이 꼭 붙어야 한다**(원장 제보 2026-09-18: *"추민아 선생님이 배정해도 송지혜 선생님까지 다같이
 *    배정됌"*). 처음엔 시각만으로 골랐는데, **같은 시각의 담당이 요일마다 갈린다** — `중고E_중1 MED`는
 *    월 17:20이 추민아(Jane)이고 목 17:20은 JJ(자습실)다. 시각만 고르면 추민아의 기입이 목요일 자습실
 *    칸까지 내려앉는다. 실측(2026-09-18) 이렇게 갈리는 조합이 **60개(반×시각)**라 예외가 아니라 상례다.
 * ⚠️ 옛 모양(`"17:20"`, 요일 없음)도 읽는다 — "그 시각의 모든 요일"이라는 뜻이다(0268a 적용 전 배정은
 *    없지만, 값이 한 벌이라 읽는 쪽이 관대한 편이 안전하다).
 * ⚠️ **담당은 키에 안 넣는다**(요일·시각까지만) — 넣으면 시간표가 바뀌어 담당이 교체되는 순간 그 배정이
 *    조용히 멈춘다. 칸을 가리키는 좌표는 (요일, 시각)이고 담당은 그 칸의 **지금 표시**일 뿐이다.
 *    그래서 담당이 교체되면 이어지는 차수는 새 담당의 칸에 들어간다(계획 줄 자체가 반 단위라 그게 맞다).
 */
const DOW_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const HHMM_RE = /^[0-2]\d:[0-5]\d$/;

/**
 * 한 교시 안의 차수 자리 — `1`(앞 25분) · `2`(뒤 25분). 원장 2026-10-16: *"차수는 25분으로 고정 …
 * 화 1차수2차수 금1차수 이렇게 하면 해당 교재가 3차수씩 배정"*. 상한은 넉넉히 4(2시간 교시까지).
 */
export const MAX_SLOT_POSITION = 4;

/**
 * 화면·저장이 같은 글자를 쓰도록 키를 **한 곳에서** 만든다.
 * `pos`가 있으면 `"tue|17:20|2"`(그 교시의 2차수 자리), 없으면 옛 모양 `"tue|17:20"`(= 1자리).
 */
export function slotPickKey(dow: string, start: string, pos?: number): string {
  return pos ? `${dow}|${start}|${pos}` : `${dow}|${start}`;
}

/**
 * `"mon|17:20"`·`"mon|17:20|2"` → `{ dow, start, pos }`. 요일이 없으면 `dow: null`(모든 요일).
 * 자리 없는 옛 값은 `pos: null`(= 그 교시에 1차수). 모양이 틀리면 null.
 */
export function parseSlotPick(value: string): { dow: string | null; start: string; pos: number | null } | null {
  const raw = String(value ?? "").trim();
  const parts = raw.split("|");
  if (parts.length === 1) return HHMM_RE.test(raw) ? { dow: null, start: raw, pos: null } : null;
  if (parts.length > 3) return null;
  const [dow, start, posRaw] = parts as [string, string, string | undefined];
  if (!(DOW_KEYS as readonly string[]).includes(dow) || !HHMM_RE.test(start)) return null;
  if (posRaw === undefined) return { dow, start, pos: null };
  const pos = Number(posRaw);
  if (!Number.isInteger(pos) || pos < 1 || pos > MAX_SLOT_POSITION || String(pos) !== posRaw) return null;
  return { dow, start, pos };
}

/**
 * 그 (요일, 시각) 교시 한 칸에 **차수가 몇 개** 들어가는가 — 고른 자리 수. 안 골랐으면 0.
 * 옛 모양(자리 없음)은 1개로 센다 — 0268a 시절 배정은 "교시마다 1차수"였다.
 */
export function lessonsInSlot(picks: ReadonlySet<string>, dow: string, start: string): number {
  let n = 0;
  for (let pos = 1; pos <= MAX_SLOT_POSITION; pos += 1) if (picks.has(slotPickKey(dow, start, pos))) n += 1;
  if (n > 0) return n;
  return picks.has(slotPickKey(dow, start)) || picks.has(start) ? 1 : 0;
}

/**
 * 고른 칸 목록 → 화면 표기용 묶음(요일 순 → 시각 순). `positions`가 빈 배열이면 자리 없는 옛 값이다.
 * 교재목록·배정 창이 **같은 묶음**으로 적게 한 곳에 둔다.
 */
export function groupSlotPicks(picks: readonly string[]): { dow: string | null; start: string; positions: number[] }[] {
  const acc = new Map<string, { dow: string | null; start: string; positions: number[] }>();
  for (const v of picks) {
    const p = parseSlotPick(v);
    if (!p) continue;
    const key = `${p.dow ?? ""}|${p.start}`;
    const cur = acc.get(key) ?? { dow: p.dow, start: p.start, positions: [] };
    if (p.pos !== null && !cur.positions.includes(p.pos)) cur.positions.push(p.pos);
    acc.set(key, cur);
  }
  const dowRank = (d: string | null) => (d === null ? -1 : (DOW_KEYS as readonly string[]).indexOf(d));
  return [...acc.values()]
    .map((g) => ({ ...g, positions: g.positions.sort((a, b) => a - b) }))
    .sort((a, b) => dowRank(a.dow) - dowRank(b.dow) || a.start.localeCompare(b.start));
}

/**
 * **그 요일에 고른 교시만** 남긴다.
 *
 * 🔴 **LAB만은 여전히 뺀다** — ECS가 표시·집계에서 언제나 빼는 자리라, 여기서만 넣으면 아무도 안 보는
 *    칸에 기록이 쌓인다. 고를 수 있는 목록 자체에 LAB을 안 올리지만, 여기서도 한 번 더 막는다.
 */
export function slotsOfPicks(
  slots: readonly MonthSlot[],
  dow: string,
  picks: ReadonlySet<string>,
): MonthSlot[] {
  return slots.filter(
    (s) => s.seat !== LAB_ROOM_LABEL && lessonsInSlot(picks, dow, s.slotStart) > 0,
  );
}

/** 시작일부터 `days`일치 날짜 문자열(오름차순). `slotsByDateOf`에 그대로 넘긴다. */
export function lookaheadDates(startDate: string, days: number): string[] {
  const n = Math.max(0, Math.min(days, MAX_LOOKAHEAD_DAYS));
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) out.push(shiftDays(startDate, i));
  return out;
}

/**
 * 그 배정이 **차수를 앉힐 수 있는 칸**(휴일 제외)을 날짜·교시 순으로 — `buildLessonSchedule`이 도는 칸과
 * 같은 거르기다. 회차 미루기·당기기가 표식을 "다음 칸"에 둘 때 쓴다(원장 2026-10-16: 화·금을 번갈아 나가는
 * 교재는 다음 칸이 다음 주 화요일이 아니라 이번 주 금요일이다).
 * 🔑 키는 `"YYYY-MM-DD|HH:MM"`(미루기 표식 키와 같다) — 문자열 순서가 곧 시간 순서다.
 */
export function planCellKeys(input: {
  startDate: string;
  schedules: readonly MonthScheduleRow[];
  holidays: HolidayMap | null | undefined;
  axis: SlotAxis;
  slotPicks?: readonly string[] | null;
  lookaheadDays?: number;
}): string[] {
  const picked = input.slotPicks && input.slotPicks.length > 0 ? new Set(input.slotPicks) : null;
  const dates = lookaheadDates(input.startDate, input.lookaheadDays ?? MAX_LOOKAHEAD_DAYS);
  const slotsByDate = slotsByDateOf(dates, input.schedules);
  const out: string[] = [];
  for (const date of dates) {
    const all = slotsByDate[date] ?? [];
    const daySlots = picked ? slotsOfPicks(all, dowKeyOf(date), picked) : slotsOfAxis(all, input.axis);
    if (daySlots.length === 0 || holidayNameOn(input.holidays, date) !== null) continue;
    for (const s of daySlots) out.push(`${date}|${s.slotStart}`);
  }
  return out;
}

/**
 * 차수 번호 목록을 수업일·교시에 차례로 앉힌다.
 *
 * @param lessonNos 앉힐 차수 번호(오름차순·중복 없음이라고 가정 — 호출부가 만든다).
 */
export function buildLessonSchedule(input: {
  startDate: string;
  lessonNos: readonly number[];
  schedules: readonly MonthScheduleRow[];
  holidays: HolidayMap | null | undefined;
  /**
   * 옛 방식 — 축으로 고른다. `slotPicks`가 있으면 **안 쓴다**(0268a 이후 새 배정은 전부 칸 선택).
   * 값이 없는 옛 배정을 계속 읽기 위해 남겨 둔다([[#95]] expand/contract).
   */
  axis: SlotAxis;
  /** 고른 교시(`"mon|17:20"`). 있으면 축 대신 이걸로 거른다 — 위 `slotsOfPicks` 주석. */
  slotPicks?: readonly string[] | null;
  /**
   * 사람이 **회차를 미루거나 당긴** 칸 — `"YYYY-MM-DD|HH:MM"` → `skip` | `advance`(0282a).
   *
   * 🔴 원장 2026-09-22: *"수업 회차를 한주 미루거나 당기거나 … 미루면 차수 무시하고 수업내용 기입해서"*.
   *    · `skip`    = 그 칸은 **차수 없이** 지나간다(뒤가 한 칸 밀린다) — 그 칸 계획이 비므로 자유 기입.
   *    · `advance` = 그 칸에서 차수 하나를 **버린다**(뒤가 한 칸 당겨진다).
   * 🔑 `skip`은 **휴일과 같은 규칙**이다 — 다른 점은 휴일이 날짜 전체고 이건 교시 한 칸이라는 것뿐.
   * ⚠️ `skip`은 `skippedHolidays`에 **안 담는다** — 그건 "연휴 때문에 밀렸다"는 다른 사실이고,
   *    화면이 둘을 같은 줄로 세면 사람이 안 한 결정을 한 것처럼 읽힌다.
   */
  shifts?: Readonly<Record<string, "skip" | "advance">> | null;
  pace: LessonPace;
  /** 훑을 날 수(기본 = 상한). 테스트·짧은 미리보기에서 줄여 쓴다. */
  lookaheadDays?: number;
}): LessonSchedule {
  const { startDate, lessonNos, schedules, holidays, axis, pace } = input;
  const shifts = input.shifts ?? null;
  const picked = input.slotPicks && input.slotPicks.length > 0 ? new Set(input.slotPicks) : null;
  const dates = lookaheadDates(startDate, input.lookaheadDays ?? MAX_LOOKAHEAD_DAYS);
  const slotsByDate = slotsByDateOf(dates, schedules);

  const targets: LessonTarget[] = [];
  const skippedHolidays: { date: string; name: string }[] = [];
  let cursor = 0;
  let lastDate: string | null = null;

  for (const date of dates) {
    if (cursor >= lessonNos.length) break;
    const all = slotsByDate[date] ?? [];
    const daySlots = picked ? slotsOfPicks(all, dowKeyOf(date), picked) : slotsOfAxis(all, axis);
    // 수업이 없는 날은 휴일이어도 알리지 않는다 — 어차피 앉을 칸이 없어 "건너뛴 수업일"이 아니다.
    if (daySlots.length === 0) continue;

    const holidayName = holidayNameOn(holidays, date);
    if (holidayName !== null) {
      skippedHolidays.push({ date, name: holidayName });
      continue;
    }

    // 🔑 미루기·당기기는 **칸마다** 본다(위 `shifts`) — `pace:"day"`에서도 그 날 칸이 저마다 다를 수 있다.
    const shiftOf = (slotStart: string) => shifts?.[`${date}|${slotStart}`] ?? null;

    if (pace === "day") {
      // 하루 1차수라도 **미룬 칸엔 안 넣는다** — 그 칸은 사람이 자유로 적는 자리다.
      const live = daySlots.filter((slot) => shiftOf(slot.slotStart) !== "skip");
      if (live.length === 0) continue; // 그 날이 통째로 미뤄졌다 — 차수를 안 쓴다.
      // 당기기가 하나라도 있으면 차수 하나를 버리고 다음 것부터(그 날 한 번만 — 단위가 '하루'다).
      if (live.some((slot) => shiftOf(slot.slotStart) === "advance")) cursor += 1;
      if (cursor >= lessonNos.length) break;
      const lessonNo = lessonNos[cursor]!;
      for (const slot of live) targets.push({ lessonNo, date, slotStart: slot.slotStart });
      cursor += 1;
      lastDate = date;
      continue;
    }

    const dow = dowKeyOf(date);
    for (const slot of daySlots) {
      if (cursor >= lessonNos.length) break;
      const shift = shiftOf(slot.slotStart);
      // 미루기 — 이 칸은 비우고 차수도 **안 쓴다**(다음 수업일로 그대로 넘어간다).
      if (shift === "skip") continue;
      // 당기기 — 이 칸에 올 차수를 버리고 **다음 차수**를 넣는다.
      if (shift === "advance") {
        cursor += 1;
        if (cursor >= lessonNos.length) break;
      }
      // 🔑 한 교시에 차수가 **고른 자리 수만큼** 들어간다(25분 1차수 · 1시간 교시 = 최대 2차수, 원장
      //    2026-10-16). 축 방식(옛 배정)과 자리 없는 옛 값은 1개다.
      const count = picked ? Math.max(1, lessonsInSlot(picked, dow, slot.slotStart)) : 1;
      for (let k = 0; k < count && cursor < lessonNos.length; k += 1) {
        targets.push({ lessonNo: lessonNos[cursor]!, date, slotStart: slot.slotStart });
        cursor += 1;
      }
      lastDate = date;
    }
  }

  return { targets, unplaced: lessonNos.slice(cursor), skippedHolidays, lastDate };
}
