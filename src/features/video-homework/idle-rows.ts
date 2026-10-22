/**
 * **숙제 0건 반**(원장 2026-10-22 *"그래도 검색은 되어야하는거 아냐? 한건도 없으면 검색조차 되지 않는건가"* → *"그래야 배정할 수 있으니까"*) — 순수.
 * 기간에 그 반 수업은 있는데 숙제도 검사 기록도 하나 없어 장부가 반째 세우지 않는 반(회차 없는 반은 세우지 않는다 — 원장 2026-10-01)의
 * 수강생을 줄(①)과 검색 명단(②)으로 가르고, 줄의 '숙제없음' 칸(③)을 깐다. 서버(`ledger-queries.ts`)가 쓴다.
 * 🔴 예외는 둘뿐이다 — 붙지 않은 영상이 있는 학생의 줄(①)과 검색 결과(②). 반 명단을 통째로 세우지 않는다.
 */
import { kstDateOf } from "@/lib/date-kst";
import { unmatchedVideos } from "./auto-outcomes";
import { blankLessonDates } from "./issue-window";
import type { LedgerEnrollment, LedgerSchedule } from "./ledger-roster";
import type { BlankAttendanceRow, BlankFacts } from "./no-homework";
import { roundPairKey, type LedgerRound } from "./rounds";
import type { VideoArrival } from "./types";

type Pair = { classId: string; studentId: string };

/**
 * 기간 안에 **그 반으로 올라온 붙지 않은 영상**이 있는 (반 × 학생)(`반:학생`). 판정은 미배정 알림과 같다(`unmatchedVideos`) — '미배정 영상'
 * 할 일이 "영상 제출 현황에서 배정하라"고 하는 그 영상이다. `rounds`는 영상·숙제·기록을 넓혀 읽어 짠 장부 회차(기간 밖 숙제가 이미 받은 영상을
 * 미배정으로 오인하지 않게). `freeOnly` = 숙제 없이 올린 영상만 — 회차가 있는 반의 줄에 쓴다(그 줄의 ClassNote 영상은 종전 '영상 배정'
 * 버튼 판정을 따른다: 다 채운 숙제의 옛 영상 · 같은 날 둘째 영상마다 버튼이 뜨면 10-13·10-14의 오해가 돌아온다).
 */
export function pendingVideoPairs(input: {
  videos: readonly VideoArrival[]; rounds: ReadonlyMap<string, readonly LedgerRound[]>; fromDate: string; toDate: string; freeOnly?: boolean;
}): Set<string> {
  return new Set(unmatchedVideos(input.videos, input.rounds).flatMap((video) => {
    const day = kstDateOf(video.postedAt);
    return video.classId && (!input.freeOnly || video.free) && day && day >= input.fromDate && day <= input.toDate
      ? [roundPairKey({ classId: video.classId, studentId: video.studentId })] : [];
  }));
}

/** `free` = 붙지 않은 영상이 있는 학생(`pendingVideoPairs`) → 줄로 선다(①). `rest` = 나머지 → 검색 명단(②)으로만(이름·학교·학년·반 — 출결은 읽지 않는다). */
export function splitIdlePairs<T extends Pair>(idle: readonly T[], pending: ReadonlySet<string>): { free: T[]; rest: T[] } {
  return { free: idle.filter((pair) => pending.has(roundPairKey(pair))), rest: idle.filter((pair) => !pending.has(roundPairKey(pair))) };
}

/**
 * 숙제 0건 반 줄의 '숙제없음' 칸 = 그 학생의 숙제없음 수업일(③ — 배정 창 · 배정 저장과 같은 판정 `blankLessonDates`). 그 반엔 숙제가 나간 날이
 * 없으니 반 숙제일 대신 이 날짜들을 깐다. 돌려주는 값 = 줄마다 수업일 · 화면의 빈 칸 사유 지도(전부 '숙제없음' — 결석일은 애초에 빠진다).
 */
export function idleLessonDates(input: {
  pairs: readonly Pair[]; schedules: readonly LedgerSchedule[]; enrollments: readonly LedgerEnrollment[]; records: readonly BlankAttendanceRow[];
  fromDate: string; toDate: string; isHoliday: (date: string) => boolean;
  /** 반 → 종강일(`classes.closed_at`) — 배정 창 · 저장과 같은 판정이 되게 넘긴다. */
  closedOn?: (classId: string) => string | null | undefined;
}): { dates: Map<string, string[]>; facts: BlankFacts } {
  const group = <R,>(rows: readonly R[], key: (row: R) => string) => {
    const out = new Map<string, R[]>();
    for (const row of rows) out.set(key(row), [...(out.get(key(row)) ?? []), row]);
    return out;
  };
  const wanted = new Set(input.pairs.map(roundPairKey));
  const classes = new Set(input.pairs.map((pair) => pair.classId));
  const schedulesOf = group(input.schedules.filter((row) => classes.has(row.class_id)), (row) => row.class_id);
  const pairOf = (row: { class_id: string; student_id: string }) => roundPairKey({ classId: row.class_id, studentId: row.student_id });
  const enrollmentsOf = group(input.enrollments.filter((row) => wanted.has(pairOf(row))), pairOf);
  const recordsOf = group(input.records.filter((row) => wanted.has(pairOf(row))), pairOf);
  const dates = new Map<string, string[]>();
  const facts: BlankFacts = {};
  for (const pair of input.pairs) {
    const key = roundPairKey(pair);
    const list = blankLessonDates({ fromDate: input.fromDate, toDate: input.toDate, schedules: schedulesOf.get(pair.classId) ?? [],
      enrollments: enrollmentsOf.get(key) ?? [], records: recordsOf.get(key) ?? [], isHoliday: input.isHoliday, closedOn: input.closedOn?.(pair.classId) });
    dates.set(key, list);
    if (list.length) facts[key] = Object.fromEntries(list.map((date) => [date, "none" as const]));
  }
  return { dates, facts };
}
