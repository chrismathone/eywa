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
 * 1차 오픈 범위 — **랩실만**(원장 2026-08-14 *"랩실 먼저 오픈"*).
 *
 * 🔴 JJ실을 같이 열면 안 되는 이유는 화면이 아니라 **돈**이다: JJ실 반엔 이미 출결 484행이 쌓여 있고
 *    (반 출석부·ECS에서 찍은 것) 그 시수는 지금 **담임 몫**으로 잡힌다. 자리 화면에서 찍기 시작하면
 *    그 순간부터 `seat_label`이 붙어 담임 시수에서 빠진다 — 아무도 요청하지 않은 급여 변화다.
 *    JJ실은 "그 시수를 담임에서 뺄지"를 원장에게 확인한 뒤 이 배열에 넣을 것.
 */
export const OPEN_SEAT_KEYS: readonly SeatKey[] = ["lab"];

/** URL 파라미터 → 자리 키. 알 수 없거나 아직 안 연 자리면 null. */
export function parseSeatKey(raw: string | undefined | null): SeatKey | null {
  const v = (raw ?? "").trim().toLowerCase();
  return (OPEN_SEAT_KEYS as readonly string[]).includes(v) ? (v as SeatKey) : null;
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
