/**
 * 자리(랩실·JJ실) 출석부의 **순수 규칙** — 서버·클라 공용, IO 없음(Vitest).
 *
 * 랩실·JJ실은 사람이 아니라 **방**이고, 같은 시각에 여러 반 학생이 함께 들어온다
 * (실측 2026-08-14: 랩실 최대 5개 반 32명, JJ실 3개 반 20명). 그래서 이 화면의 축은
 * **자리 × 날짜 × 시작시각**이고, 반은 명단 안의 2차 그룹이다.
 *
 * 🔴 자리 판정 자체는 [`specialSlotLabel`](../../timetable/lib/teacher-label.ts)이 단일 소스다 —
 *    여기서 다시 문자열을 비교하지 말 것(별칭 `이주희`·`랩실` 등이 계속 저장돼 있다).
 */
import { LAB_ROOM_LABEL, SELF_STUDY_ROOM_LABEL, type SpecialSlotLabel } from "@/features/timetable/lib/teacher-label";

/** URL·설정에 쓰는 자리 키(소문자). DB 라벨(`LAB`/`JJ`)과 분리 — URL에 DB 원문을 노출하지 않는다. */
export const SEAT_KEYS = ["lab", "jj"] as const;
export type SeatKey = (typeof SEAT_KEYS)[number];

/** 자리 키 → DB 값(`class_schedules.slot_teacher_label` 원문 = `attendance_records.seat_label`). */
export const SEAT_DB_LABEL: Record<SeatKey, SpecialSlotLabel> = {
  lab: LAB_ROOM_LABEL,
  jj: SELF_STUDY_ROOM_LABEL,
};

/** DB 값 → 자리 키(역매핑). 자리가 아니면 null. */
export function seatKeyOf(dbLabel: string | null | undefined): SeatKey | null {
  if (dbLabel === LAB_ROOM_LABEL) return "lab";
  if (dbLabel === SELF_STUDY_ROOM_LABEL) return "jj";
  return null;
}

/**
 * 화면 표기 — `LAB`·`JJ` 같은 원문 코드를 화면에 그대로 내보내지 않는다(UI raw 코드 금지 규칙).
 * ⚠️ 단 **시간표 강사뷰의 열 이름은 시트 원문 `LAB`·`JJ` 그대로**다(원장 2026-07-30) — 그건 시트와
 *    1:1로 맞춘 표라 다른 규약이고, 여기는 사람이 읽는 문장이라 방 이름을 쓴다.
 */
export const SEAT_NAME: Record<SeatKey, string> = { lab: "랩실", jj: "JJ실" };
export const SEAT_ROOM: Record<SeatKey, string> = { lab: "603호", jj: "305호" };

/**
 * 로그인 출석부에서 **화면을 여는** 자리. 허브 카드·`/attendance/seat/:key`가 이걸 본다.
 * 랩실 + JJ실. 공개 PIN(`PIN_SEAT_KEYS`)·자리 시수(`PAYROLL_SEAT_KEYS`)와는 다른 축이다.
 */
export const USABLE_SEAT_KEYS: readonly SeatKey[] = ["lab", "jj"];

/**
 * **공개 PIN 문** — 로그인 없이 `/seat/:key`로 들어와 그 자리 오늘 명단을 찍을 수 있는 자리.
 * 랩실 + JJ실(원장 2026-08-19: *"/seat/jj 도 같은 방법으로 만들자"*).
 *
 * 🔵 이건 **문**이지 돈이 아니다 — 여기에 자리를 더해도 시수 귀속은 그대로다. 실제로 열리려면
 *    학원설정 `operations.seatPins[자리]`에 비밀번호가 들어 있어야 한다(비면 그 자리는 닫힌다).
 * 🔴 아래 급여 축과 **절대 한 배열로 합치지 말 것** — 합치는 순간 JJ 출결에 `seat_label`이 박혀
 *    담임 정산에서 빠진다. 가드: `seat-axes.test.ts`.
 */
export const PIN_SEAT_KEYS: readonly SeatKey[] = ["lab", "jj"];

/**
 * **자리 시수** — 출결을 쓸 때 `attendance_records.seat_label`을 박는 자리(0208a). 지금은 랩실만.
 *
 * 🔴 담임 시수 집계(tier-rows·settlement-queries)가 이 값이 있는 행을 **걸러 낸다**. JJ실 반엔 이미
 *    출결이 담임 시수로 쌓여 있어(실측 2026-08-19: `seat_label` 붙은 행 0 / JJ 교시 시각 출결 334)
 *    여기에 `"jj"`를 넣는 순간 그 출결이 담임 정산에서 통째로 빠진다.
 * 🔴 공개 PIN을 여는 것과 **다른 축**이다 — 문은 `PIN_SEAT_KEYS`가, 돈은 여기가 정한다.
 */
export const PAYROLL_SEAT_KEYS: readonly SeatKey[] = ["lab"];

export function isPayrollSeat(seat: SeatKey): boolean {
  return (PAYROLL_SEAT_KEYS as readonly string[]).includes(seat);
}

/** 공개 PIN 경로(`/seat/:key`)가 자리를 알아보는 문. 모르는 값·PIN 미오픈이면 null. */
export function parseSeatKey(raw: string | undefined | null): SeatKey | null {
  const v = (raw ?? "").trim().toLowerCase();
  return (PIN_SEAT_KEYS as readonly string[]).includes(v) ? (v as SeatKey) : null;
}

/** 로그인 자리 출석부 URL. 공개 PIN을 안 연 자리도 통과한다. */
export function parseUsableSeatKey(raw: string | undefined | null): SeatKey | null {
  const v = (raw ?? "").trim().toLowerCase();
  return (USABLE_SEAT_KEYS as readonly string[]).includes(v) ? (v as SeatKey) : null;
}

/**
 * 아직 안 연 자리까지 포함한 해석 — **목록에 이름은 보이되 기록은 못 하게** 하려고 나눠 둔다.
 * 화면은 이걸로 자리를 알아보고, 공개(비로그인) 쓰기 가능 여부는 `parseSeatKey`(= PIN_SEAT_KEYS)가 정한다.
 */
export function parseAnySeatKey(raw: string | undefined | null): SeatKey | null {
  const v = (raw ?? "").trim().toLowerCase();
  return (SEAT_KEYS as readonly string[]).includes(v) ? (v as SeatKey) : null;
}

/** 강사 드롭다운에 자리를 태울 때 쓰는 값 — uuid와 안 겹치는 접두사(시간표 폼의 `seat:`와 같은 규약). */
export const SEAT_FILTER_PREFIX = "seat:";
export const seatFilterValue = (seat: SeatKey): string => `${SEAT_FILTER_PREFIX}${seat}`;
/** 강사 필터 값이 자리면 그 자리 키, 아니면 null(= uuid이거나 빈 값). */
export function parseSeatFilterValue(value: string | null | undefined): SeatKey | null {
  if (!value?.startsWith(SEAT_FILTER_PREFIX)) return null;
  return parseAnySeatKey(value.slice(SEAT_FILTER_PREFIX.length));
}

/** "16:20:00" → "16:20". 이미 짧으면 그대로. 빈 값은 빈 문자열. */
export function hhmm(time: string | null | undefined): string {
  return (time ?? "").slice(0, 5);
}

/** 한 자리·한 날짜에 열리는 수업 한 칸(스케줄 행 하나). */
export type SeatSlot = {
  classId: string;
  className: string;
  /** "HH:MM[:SS]" — 그룹 키. */
  start: string;
  /** "HH:MM[:SS]" — 같은 시작이라도 반마다 다를 수 있다(실측: JJ실 월·금 16:20 → 17:00 / 17:20). */
  end: string;
};

/** 시작시각으로 묶은 한 교시. */
export type SeatPeriod = {
  /** "HH:MM" — 화면·저장(slot_start)이 공유하는 키. */
  start: string;
  /** 이 교시에 들어오는 반들(이름순). 종료시각은 반마다 따로 들고 다닌다. */
  slots: SeatSlot[];
  /** 이 교시에서 관측된 종료시각들("HH:MM", 오름차순). 둘 이상이면 화면이 그 사실을 밝힌다. */
  ends: string[];
};

/**
 * 스케줄 행 → 교시 목록(시작시각 오름차순).
 *
 * 🔴 **묶는 키는 시작시각 하나**다. 종료가 다르다고 칸을 쪼개면 같은 순간에 같은 방에 있는 아이들이
 *    두 칸으로 갈라져, 담당자가 한 번에 볼 수 없다(이 화면의 존재 이유가 사라진다).
 * ⚠️ 저장키(`attendance_records.slot_start`)에도 종료시각이 없다 — 그래서 **같은 반**에 시작이 같고
 *    종료만 다른 슬롯이 둘 있으면 두 기록을 구분할 수 없다(실측 0건). 그 경우는 호출부가 막는다.
 */
export function groupByStart(slots: readonly SeatSlot[]): SeatPeriod[] {
  const byStart = new Map<string, SeatSlot[]>();
  for (const s of slots) {
    const key = hhmm(s.start);
    if (!key) continue;
    (byStart.get(key) ?? byStart.set(key, []).get(key)!).push(s);
  }
  return [...byStart.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([start, list]) => ({
      start,
      slots: [...list].sort((a, b) => a.className.localeCompare(b.className, "ko")),
      ends: [...new Set(list.map((s) => hhmm(s.end)).filter(Boolean))].sort(),
    }));
}

/** 같은 (반, 시작시각)에 종료가 갈리는 슬롯 — 저장키로 구분이 안 되는 조합(호출부가 입력을 막는다). */
export function ambiguousClassIds(period: SeatPeriod): string[] {
  const ends = new Map<string, Set<string>>();
  for (const s of period.slots) {
    (ends.get(s.classId) ?? ends.set(s.classId, new Set()).get(s.classId)!).add(hhmm(s.end));
  }
  return [...ends.entries()].filter(([, set]) => set.size > 1).map(([classId]) => classId);
}

/**
 * 기본으로 열 교시 — **지금 진행 중** → 없으면 **다음** → 하루가 끝났으면 **마지막**.
 * 교시가 없으면 -1. `now`는 "HH:MM"(KST는 호출부가 만든다 — 여기는 순수).
 *
 * ⚠️ '진행 중' 판정에 쓰는 종료시각은 그 교시의 **가장 늦은 종료**다(16:20~17:00과 16:20~17:20이
 *    섞이면 17:20까지가 그 칸의 수업 시간). 이르게 끝나는 반을 기준으로 잡으면 아직 방에 아이들이
 *    있는데 화면이 다음 교시로 넘어간다.
 */
export function pickPeriodIndex(periods: readonly SeatPeriod[], now: string): number {
  if (periods.length === 0) return -1;
  const live = periods.findIndex((p) => {
    const last = p.ends[p.ends.length - 1] ?? p.start;
    return p.start <= now && now < last;
  });
  if (live >= 0) return live;
  const next = periods.findIndex((p) => p.start > now);
  return next >= 0 ? next : periods.length - 1;
}

/** 화면 제목용 시간 표기 — 종료가 갈리면 "16:20 ~ 17:00·17:20". */
export function periodTimeLabel(period: SeatPeriod): string {
  if (period.ends.length === 0) return period.start;
  return `${period.start} ~ ${period.ends.join("·")}`;
}
