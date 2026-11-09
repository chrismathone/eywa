import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import type { AttendanceTarget, ContributionAttendance } from "./participation";
import type { BillingSeed } from "./billing";
import type { ParentEventSources } from "./parent-events/facts";

export type RankingGrade = { id: string; student_id: string; subject: string; exam_slot: string | null; exam_name: string;
  score: string | number | null; max_score: string | number | null; taken_on: string; no_exam: boolean | null; school_year?: number | null };
export type RankingFacts = {
  version: 1; asOf: string; activityFrom: string;
  billing: { months: number; subjectMonths: number; concurrentMonths: number; paid: number; extraSubjectPaid: number; concurrentPaid: number; unknownMonths: number; first: string | null; last: string | null };
  attendance: { scheduled: number; recorded: number; present: number; late: number; absent: number; early: number; rate: number | null };
  seminar: { attended: number | null; registeredOnly: number; from: string | null; pending: boolean;
    /** 이 학원에 검토 전으로 남은 명단 행 수(학생 미상). 옛 저장본에는 없다. */
    unreviewedRows?: number; connected?: boolean };
  school: { current: number | null; improvement: number | null; subjects: number; pairs: number; latest: string | null };
};
const round = (n: number) => Math.round(n * 100) / 100;
const mean = (v: number[]) => v.length ? round(v.reduce((a, b) => a + b, 0) / v.length) : null;
const DAY_MS = 86_400_000;
/** 과목의 가장 최근 학교 시험이 기준일보다 이만큼 오래됐으면 그 과목은 현재·향상 모두에서 뺀다(지난 학년 점수가 '현재'로 남지 않게). */
export const SCHOOL_STALE_DAYS = 365;
const SCHOOL_SLOTS = new Set(["midterm", "final", "listening", "school"]);
type SchoolSlot = "midterm" | "final" | "listening" | "school";
function schoolSlot(g: RankingGrade): SchoolSlot | null {
  // 시험 칸이 학교 시험이 아니라고 적혀 있으면(월말평가 등) 이름에 '기말'이 들어가도 학교 시험이 아니다.
  if (g.exam_slot && !SCHOOL_SLOTS.has(g.exam_slot)) return null;
  return /듣기/.test(g.exam_name) || g.exam_slot === "listening" ? "listening"
    : /중간/.test(g.exam_name) || g.exam_slot === "midterm" ? "midterm"
    : /기말/.test(g.exam_name) || g.exam_slot === "final" ? "final" : g.exam_slot === "school" || /내신/.test(g.exam_name) ? "school" : null;
}
/** 학년도(3월 시작). school_year가 있으면 그 값, 없으면 시험일로 — 1·2월 시험은 앞 학년도. */
function academicYear(g: RankingGrade) {
  if (g.school_year) return g.school_year;
  const y = Number(g.taken_on.slice(0, 4)), m = Number(g.taken_on.slice(5, 7));
  return m <= 2 ? y - 1 : y;
}
/**
 * 학교 시험 사실(학원 월말평가·일일테스트 제외).
 * - 현재: 과목별 가장 최근 학교 시험(지필 우선, 듣기만 있으면 듣기)의 100점 환산 평균. 기준일보다 1년 넘게 지난 과목은 뺀다.
 * - 향상: 같은 과목·같은 학년도의 지필(중간·기말) 시험을 날짜순으로 놓고 가장 최근 시험과 바로 앞 시험의 차이.
 *   학기·시험종류가 달라도 된다(1학기 기말 → 2학기 중간). 학년도가 바뀌면(중3 → 고1 등 학교가 바뀔 수 있음) 비교하지 않는다.
 *   듣기는 듣기끼리, 종류를 알 수 없는 '내신' 표기는 향상 비교에서 뺀다.
 * - 같은 날 점수가 엇갈리면: 그 줄의 최근 시험일이 엇갈리면 그 줄을 통째로 보류하고(옛 시험으로 대신하지 않는다), 지난 날짜면 그날만 뺀다.
 */
export function schoolRankingFacts(rows: readonly RankingGrade[], asOf?: string): RankingFacts["school"] {
  const lanes = new Map<string, { day: string; year: number; score: number }[]>();
  for (const g of rows) {
    const slot = schoolSlot(g);
    if (!slot || g.no_exam || g.score === null || g.max_score === null || !g.subject) continue;
    if (asOf && g.taken_on > asOf) continue;
    const score = Number(g.score), max = Number(g.max_score);
    if (!Number.isFinite(score) || !Number.isFinite(max) || max <= 0 || score < 0 || score > max) continue;
    // 지필(중간·기말)은 한 줄로 이어 비교한다. 듣기·종류 미상은 따로.
    const lane = slot === "midterm" || slot === "final" ? "written" : slot;
    const key = `${g.subject}:${lane}`;
    const list = lanes.get(key) ?? []; list.push({ day: g.taken_on, year: academicYear(g), score: score / max * 100 }); lanes.set(key, list);
  }
  const latestBySubject = new Map<string, { day: string; score: number; listening: boolean }>(), improvements: number[] = [];
  for (const [key, list] of lanes) {
    const days = [...new Set(list.map(r => r.day))].sort().reverse();
    const dayRows = (day: string) => list.filter(r => r.day === day);
    // Conflicting duplicate marks for the lane's latest examination day withhold the lane (no silent fallback to an older exam).
    if ([...new Set(dayRows(days[0]!).map(r => r.score))].length > 1) continue;
    const unique = days.flatMap(day => { const r = dayRows(day), scores = [...new Set(r.map(x => x.score))];
      return scores.length === 1 ? [{ day, year: r[0]!.year, score: scores[0]! }] : []; });
    const [subject, lane] = key.split(":") as [string, string], latest = unique[0]!, before = latestBySubject.get(subject);
    if (asOf && (Date.parse(asOf) - Date.parse(latest.day)) / DAY_MS > SCHOOL_STALE_DAYS) continue;
    const listening = lane === "listening";
    // 현재 성적은 지필·내신을 듣기보다 우선한다. 같은 날이면 지필(written)이 '내신'보다 앞선다.
    if (!before || (before.listening && !listening) || (before.listening === listening && (latest.day > before.day || (latest.day === before.day && lane === "written"))))
      latestBySubject.set(subject, { day: latest.day, score: latest.score, listening });
    const previous = unique[1];
    if (lane !== "school" && previous && previous.year === latest.year) improvements.push(latest.score - previous.score);
  }
  const current = [...latestBySubject.values()];
  return { current: mean(current.map(r => r.score)), improvement: mean(improvements), subjects: current.length, pairs: improvements.length,
    latest: current.map(r => r.day).sort().at(-1) ?? null };
}

/**
 * 예정 교시 ↔ 실제 기록 대조.
 * - 교시가 같은 기록이 있으면 그것을 쓴다.
 * - 교시가 비어 있는 기록(slot_start null)은 "그날 전체" 기록이다(effective-records.ts 규약). 수학은 하루에 55분 교시를
 *   여러 칸 돌아도 출결을 하루 한 번 찍으므로, 그날의 교시마다 같은 기록을 쓴다(2026-11-09 — 이 규칙이 없어 528명 중
 *   거의 전원이 '기록 0'이었다).
 * - 예정이 그날 한 칸뿐이면 교시 시각이 달라도 그날의 유일한 기록을 쓴다(시간표 시각 변경 대비).
 * - 오늘·미래 수업, 자리(seat_label) 기록, 보강·공결 등 네 상태 밖의 기록은 세지 않는다.
 */
export function attendanceRankingFacts(targets: readonly AttendanceTarget[], rows: readonly ContributionAttendance[], asOf: string): RankingFacts["attendance"] {
  const key = (r: AttendanceTarget) => `${r.class_id}:${r.session_date}:${r.slot_start ?? ""}`;
  const unique = [...new Map(targets.filter(t => t.session_date < asOf).map(t => [key(t), t])).values()];
  const byDay = new Map<string, ContributionAttendance[]>();
  for (const r of effectiveAttendanceRecords(rows).filter(r => !r.seat_label)) {
    const day = `${r.class_id}:${r.session_date}`, list = byDay.get(day) ?? []; list.push(r); byDay.set(day, list);
  }
  const dayCounts = new Map<string, number>();
  unique.forEach(t => { const day = `${t.class_id}:${t.session_date}`; dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1); });
  const out = { scheduled: unique.length, recorded: 0, present: 0, late: 0, absent: 0, early: 0, rate: null as number | null };
  for (const t of unique) {
    const day = `${t.class_id}:${t.session_date}`, records = byDay.get(day) ?? [];
    const exact = t.slot_start ? records.filter(r => r.slot_start === t.slot_start) : [];
    const wholeDay = records.filter(r => !r.slot_start);
    const matched = exact.length ? exact : wholeDay.length ? wholeDay : dayCounts.get(day) === 1 ? records : [];
    if (matched.length !== 1) continue;
    const status = matched[0]!.status;
    if (!["present", "late", "absent", "early_leave"].includes(status)) continue;
    out.recorded++;
    if (status === "present") out.present++;
    if (status === "late") out.late++;
    if (status === "absent") out.absent++;
    if (status === "early_leave") out.early++;
  }
  // Late / early leave receive half credit. The rate is over recorded slots; unrecorded scheduled slots stay unknown, not absent.
  if (out.recorded) out.rate = round((out.present + (out.late + out.early) * 0.5) / out.recorded * 100);
  return out;
}
export function buildRankingFacts(input: { studentId: string; asOf: string; billing: readonly BillingSeed[];
  targets: readonly AttendanceTarget[]; attendance: readonly ContributionAttendance[]; grades: readonly RankingGrade[];
  events: ParentEventSources; canonical: (id: string) => string }): RankingFacts {
  const months = input.billing.filter(b => b.studentId === input.studentId && b.month <= input.asOf.slice(0, 7));
  const active = months.filter(b => b.active);
  const billing: RankingFacts["billing"] = { months: active.length, subjectMonths: 0, concurrentMonths: 0, paid: 0, extraSubjectPaid: 0, concurrentPaid: 0,
    unknownMonths: months.filter(b => b.unknownSubjects > 0).length, first: active.map(b => b.month).sort()[0] ?? null, last: active.map(b => b.month).sort().at(-1) ?? null };
  for (const b of months) {
    const subjects = new Set(b.subjects).size;
    billing.paid += b.tuitionWon;
    billing.extraSubjectPaid += b.tuitionWon * Math.max(0, subjects - 1);
    if (subjects >= 2) billing.concurrentPaid += b.tuitionWon;
    if (b.active) { billing.subjectMonths += subjects; if (subjects >= 2) billing.concurrentMonths++; }
  }
  const ownEvents = input.events.records.filter(r => input.canonical(r.studentId) === input.studentId && r.eventDate <= input.asOf);
  const attended = new Set(ownEvents.filter(r => r.attendanceBasis === "explicit_attendance").map(r => r.eventId));
  const registered = new Set(ownEvents.filter(r => !attended.has(r.eventId)).map(r => r.eventId));
  return { version: 1, asOf: input.asOf, activityFrom: "2026-01-01", billing,
    attendance: attendanceRankingFacts(input.targets, input.attendance, input.asOf),
    seminar: { attended: input.events.ready ? attended.size : null, registeredOnly: registered.size, from: input.events.coverageFrom ?? null,
      // 검토 전 명단이 남아 있으면 그 행이 누구의 참석인지 모르므로 0회로 단정하지 않는다(설명회 결정 문서: 일부 반영 ≠ 전체 확인).
      pending: !input.events.ready || !!input.events.pendingRows || registered.size > 0,
      unreviewedRows: input.events.ready ? input.events.pendingRows ?? 0 : 0, connected: input.events.ready },
    school: schoolRankingFacts(input.grades, input.asOf),
  };
}
