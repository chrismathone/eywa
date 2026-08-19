/**
 * 오늘 면(시트 모드)이 그릴 **하루 고르기 + 그 하루에서 내 교시만 남기기** — 순수 함수 단일 소스.
 *
 * 원장 지시 2026-08-19: *"영어 강사뷰에서 본인 수업 아닌거 전부 숨기기"* → 정정 *"JJ/LAB은 떠도 될것
 * 같고"* → 최종 **"오늘 시트에서는 본인 수업만 보이고, 주간 시트는 여전히 지금처럼."**
 *
 * 🔴 **강사 축 필터는 오늘 면(`variant:"today"`) 전용**이다. 주간 시트는 반 전체를 보는 자리라 남의
 *    교시가 빠지면 담임이 반의 하루를 못 읽는다. 그래서 두 갈래를 **이 함수 하나**에서 갈라 낸다 —
 *    화면에서 각자 거르면 "주간까지 조용히 좁아지는" 회귀가 타입·테스트 없이 지나간다.
 * 🔴 서버 그리드(`grid.ts`)·`today.ts` 조회에서 거르지 않는 이유도 같다(둘은 주간과 공용이다).
 * 🔴 계획 층(today-class-sheet)과 로스터 층(today-roster-table)이 **같은 배열**을 봐야 위아래 격자가
 *    맞는다([today-columns](./today-columns.ts)의 계약) — 그래서 거르는 곳은 오케스트레이터 한 곳뿐이다.
 *
 * 판정 규칙(이 순서 그대로):
 *   ① **자리(LAB·JJ)는 남긴다** — 사람이 아니라 방이다(원장 "JJ/LAB은 떠도 된다"). 뿌리는
 *      [`isSeatSlot`](@/features/attendance/teacher-axis) 과 같은 자리 라벨 판정이다. 자리 줄은
 *      `teacher_id`가 구조적으로 null이지만, FK가 어긋나게 붙은 줄까지 라벨로 살려 둔다(숨김은 명확할 때만).
 *   ② **담당이 비어 있으면 남긴다** — 모호하면 지어내지 않는다(`resolveTaughtBy`의 `ambiguous`와 같은 결).
 *   ③ **내 교시면 남긴다** — 판정은 `teacher_id` FK 뿐이다.
 *      🔴 `slot_teacher_label`(표시명)로 판정하지 말 것: 그 값은 표시 전용이고 FK와 **다른 사람**을
 *      가리키는 슬롯이 실재한다(grid.ts `GridSlot.teacherLabel` 주석·teacher-label.ts 🔴).
 *   ④ **기록이 있으면 남긴다** — 그 교시에 출결·마크·슬롯 메모·계획 줄이 하나라도 있으면 숨기지 않는다.
 *      🔴 이유: `server/queries.ts`의 `firstSlotByDate`가 **`slot_start=null`인 옛 출결 행을 그 날 첫 교시
 *      칸에 붙인다.** 첫 교시가 남의 교시라고 숨기면 그 기록이 화면에서 **조용히 사라진다**(서버 계산은
 *      안 바뀌므로 숫자만 남고 칸이 없어진다 — 07-31에 실제로 밟은 함정, grid.ts 머리 주석).
 *
 * ⚠️ **임시 위임(0173a)으로 대신 맡은 반은 거르지 않는다.** 그 반의 교시 담당은 자리를 비운 강사라
 *    규칙 ③으로 재면 **전부 남의 것**이 되어 화면이 통째로 비는데, 위임은 애초에 "오늘 이 반을 네가
 *    맡아라"는 배정이다 — 정확히 0173a가 막으려던 조용한 실패(위임받았는데 아무것도 안 뜬다)가 된다.
 * ⚠️ 이 화면은 "보이는 교시 = 세는 교시"([view-prefs.ts](../view-prefs.ts))를 **의도적으로 벗어나는 첫
 *    사례**다: 작성률(주간 시트 머리·랜딩·요약 카드의 `계획 N/M교시`)은 **반 전체가 목적**이라 서버 계산을 그대로 두고,
 *    대신 숨긴 교시를 각주로 밝힌다(`hiddenOwnSlotsNotice`). 분모를 여기서 바꾸지 말 것.
 * ⚠️ 시수(유닛) 자동값은 손대지 않는다 — "보기 설정이 급여를 바꾸면 안 된다"(grid.ts `scheduledUnitsByDate`).
 */
import { isSpecialSlotLabel } from "@/features/timetable/lib/teacher-label";
import type { GridDay, GridSlot } from "./grid";

/** 오늘 면에서 숨긴 남의 교시 하나 — 각주(건수·교시·담당)용. `teacherId`는 숨김 근거인 FK다. */
export type HiddenOwnSlot = { slotStart: string; teacherId: string };

export type SheetDaysSelection = {
  /** 주간 시트(`variant:"full"`)가 그릴 날짜들 — **강사 축으로 거르지 않는다**(요일 필터만 적용). */
  days: GridDay[];
  /** 오늘 면이 그릴 하루(내 교시만 남은 슬롯) — `variant:"full"`이면 null. */
  todayDay: GridDay | null;
  /** 숨긴 남의 교시 — 비어 있지 않으면 **반드시 화면에 건수를 밝힌다**(침묵 금지). */
  hiddenOwn: HiddenOwnSlot[];
};

const SLOT_RE = /^\d{2}:\d{2}$/;

/** 이 교시를 오늘 면에 남기는가 — 위 판정 규칙 ①~④. */
function keepOwnTodaySlot(
  slot: GridSlot,
  myTeacherId: string,
  slotsWithRecords: ReadonlySet<string>,
): boolean {
  if (isSpecialSlotLabel(slot.teacherLabel)) return true; // ① 자리(LAB·JJ)
  if (!slot.teacherId) return true; // ② 모호 — 지어내지 않는다
  if (slot.teacherId === myTeacherId) return true; // ③ 내 교시(FK만)
  // ④ 기록 보존 — 계획 줄은 슬롯이 직접 들고 있고, 출결·마크·슬롯 메모는 호출부가 집합으로 넘긴다.
  return slot.lines.length > 0 || slotsWithRecords.has(slot.slotStart);
}

/**
 * 시트가 그릴 날짜·슬롯 확정 — `variant`가 두 갈래를 가른다.
 *
 * @param slotsWithRecords 그린 날짜의 기록 보유 교시(HH:MM)를 돌려주는 함수 — `slotsWithRecordsOn`.
 *        **함수로 받는 이유**: "어느 하루를 그리나"는 이 함수가 정하므로(요일 필터 → 첫 날짜) 호출부가
 *        날짜를 따로 도출하면 두 곳이 갈린다. 그 하루가 정해진 뒤 **한 번만** 불린다.
 * @param myTeacherId `effectiveTeacherId()`(겸직 강사뷰까지 커버하는 단일 소스). null이면 **아무것도
 *        숨기지 않는다** — 스코프가 없는 사람(사무실)에게 "내 수업"이라는 개념이 없다.
 * @param delegatedClass 임시 위임으로 **대신 맡은 반**인가(`ClassSheetWeekData.delegated`). true면 거르지
 *        않는다 — 오늘 그 반은 통째로 내 수업이다(위 ⚠️).
 */
export function selectSheetDays(input: {
  variant: "full" | "today";
  days: readonly GridDay[];
  dayFilter: string | null;
  myTeacherId: string | null;
  delegatedClass?: boolean;
  slotsWithRecords?: (date: string) => ReadonlySet<string>;
}): SheetDaysSelection {
  const days = input.dayFilter
    ? input.days.filter((d) => d.date === input.dayFilter)
    : [...input.days];
  // 🔴 주간 시트는 종전 그대로 — 이 return 위에 강사 축 필터를 끼워 넣지 말 것.
  if (input.variant !== "today") return { days, todayDay: null, hiddenOwn: [] };
  const day = days[0] ?? null;
  if (!day || !input.myTeacherId || input.delegatedClass)
    return { days, todayDay: day, hiddenOwn: [] };

  const withRecords = input.slotsWithRecords?.(day.date) ?? new Set<string>();
  const slots: GridSlot[] = [];
  const hiddenOwn: HiddenOwnSlot[] = [];
  for (const slot of day.slots) {
    if (keepOwnTodaySlot(slot, input.myTeacherId, withRecords)) slots.push(slot);
    else hiddenOwn.push({ slotStart: slot.slotStart, teacherId: slot.teacherId! });
  }
  // 숨긴 게 없으면 **같은 객체**를 돌려준다 — 참조가 매번 바뀌면 memo된 로스터 표가 헛되게 다시 그려진다.
  return { days, todayDay: hiddenOwn.length === 0 ? day : { ...day, slots }, hiddenOwn };
}

/**
 * 그 날짜에 **기록이 남아 있는 교시**(HH:MM) 집합 — 판정 규칙 ④의 재료.
 *
 * @param cellKeys `${studentId}|${date}|${HH:MM}` — 출결(`attendanceByStudentDate`)·마크(`marks`).
 *        옛 "그날 전체" 출결 행은 서버가 이미 **그 날 첫 교시** 칸 키로 바꿔 내려보낸다(그래서 그 첫
 *        교시가 남의 교시여도 이 집합에 들어와 살아남는다 — 위 🔴).
 * @param slotMemoKeys `slot:${date}:${HH:MM}` — 교시 메모(`memos`).
 */
export function slotsWithRecordsOn(
  date: string,
  cellKeys: Iterable<string>,
  slotMemoKeys: Iterable<string> = [],
): Set<string> {
  const out = new Set<string>();
  const tag = `|${date}|`;
  for (const key of cellKeys) {
    const at = key.indexOf(tag);
    if (at < 0) continue;
    const slot = key.slice(at + tag.length);
    if (SLOT_RE.test(slot)) out.add(slot);
  }
  const memoPrefix = `slot:${date}:`;
  for (const key of slotMemoKeys) {
    if (!key.startsWith(memoPrefix)) continue;
    const slot = key.slice(memoPrefix.length);
    if (SLOT_RE.test(slot)) out.add(slot);
  }
  return out;
}

/**
 * 숨긴 교시 각주 문장 — **침묵 금지**(선례: 자리 제외 각주 `hiddenSpecial`·요약 카드의 안 그린 기록).
 * 없으면 null(아무것도 안 그린다).
 *
 * ⚠️ 담당 이름은 **FK(`teacherId`)로 찾은 표시 이름**(`data.teacherNames`)만 쓴다 — 슬롯 라벨은
 *    FK와 다른 사람을 가리킬 수 있어 각주에서까지 남의 이름을 부를 수 있다. 이름을 모르면 교시만 적는다.
 */
export function hiddenOwnSlotsNotice(
  hidden: readonly HiddenOwnSlot[],
  opts: {
    /** 교시(HH:MM) → "N교시"(표시 전용 라벨, `data.periodLabelBySlot`). 없으면 시각을 그대로 적는다. */
    periodLabelOf: (slotStart: string) => string | null;
    teacherNameOf: (teacherId: string) => string | null;
  },
): string | null {
  if (hidden.length === 0) return null;
  const parts = hidden.map((h) => {
    const period = opts.periodLabelOf(h.slotStart) ?? h.slotStart;
    const name = opts.teacherNameOf(h.teacherId);
    return name ? `${period} ${name}` : period;
  });
  return (
    `다른 선생님 담당 교시 ${hidden.length}개(${parts.join(" · ")})는 오늘 시트에서 숨겼습니다 — ` +
    `기록은 지워지지 않았고 주간 시트에서 그대로 보입니다. ` +
    `작성률(계획 N/M교시)은 반 전체가 기준이라 숨긴 교시까지 함께 셉니다.`
  );
}
