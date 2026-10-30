import { courseGroupOf, subjectGroupOf, type ProgramSubject } from "@/features/students/enrollment/program";
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { countedOn, type TrendEnrollment, type TrendEnrollments, type TrendPoint, type TrendStudent } from "./enrolled-trend";
import { billedExitRows } from "./trend-billing";

/**
 * **강좌수 추이**(원장 2026-10-20 *"대시보드에 강좌수도 볼 수 있으면 좋을듯. 강좌수 추이도 당연히. … 한 학생이 여러 강좌를 들을 수도
 * 있기 때문에 듣는 모든 강좌를 체크"*) — 날짜 d에 재원생으로 세어지는 학생(`countedOn` — 재원생 추이와 같은 사람들)이 그날 듣던 반을
 * **학생·과목마다 한 번** 센다(같은 과목 반이 다섯이어도 1, 2026-10-24). 순수 함수(Vitest).
 * 그날 듣던 반 = 재원생 추이 과목 판정과 같은 규약 — 시작일 ≤ d(비면 시작한 것) · 반이동은 종료일 전날까지 · 일반 종료는 종료일 포함
 * (`isEnrollmentEndedOn` — 종료일이 미래로 적힌 수강은 그날까지) · **오늘 점**은 휴원 수강도 뺀다('강좌수' 칸과 같은 규약 → 오늘 점 = 칸 숫자).
 * 장부 정리 학생을 청구로 센 날(수강은 끝났는데 그달 청구가 살아 있다)은 퇴원 무렵 함께 끝난 반을 센다(`billedExitRows` — 재원생 추이의
 * 과목 판정과 같은 14일 폭). ⚠️ 휴원 이력은 없어 지난 날짜엔 지금 휴원 중인 수강도 센다(재원생 추이와 같은 한계).
 */
export type CourseRow = TrendEnrollment;

/** 반을 가리키는 열쇠 — 반 id(옛 원본처럼 없으면 수강 줄 자체를 한 강좌로). */
const courseKey = (e: CourseRow) => e.classId ?? `${e.studentId}|${e.subject ?? ""}|${e.start ?? ""}|${e.end ?? ""}`;

/** 한 학생이 날짜 d에 듣던 강좌(반마다 한 줄) — `inRow`가 있으면 그 수강만(과목 관리자). 재원생으로 세어지는지는 부르는 쪽이 본다. */
export function coursesOn(
  s: TrendStudent,
  rows: readonly CourseRow[],
  en: TrendEnrollments,
  d: string,
  today?: string,
  inRow?: (e: CourseRow) => boolean,
): CourseRow[] {
  // 오늘 점만 휴원 수강을 뺀다(휴원 이력이 없어 지난 날짜는 되감지 못한다) · 종료일이 미래로 적힌 수강은 그날까지 센다('강좌수' 칸과 같은 규약).
  const live = rows.filter((e) => e.classId !== null && !isEnrollmentEndedOn(e.end, d, e.transferred) && !(d === today && e.onHold) && (!e.start || e.start.slice(0, 10) <= d));
  const picked = live.length ? live : (billedExitRows(s, rows, en, d) ?? []);
  const out = new Map<string, CourseRow>();
  // 반이 없는 수강(반 id null)은 세지 않는다 — '강좌수' 칸 조회가 반을 필수로 묶어 빼는 줄과 같다(옛 원본처럼 칸이 아예 없으면 줄마다).
  for (const e of picked) if (e.classId !== null && (!inRow || inRow(e))) out.set(courseKey(e), e);
  return [...out.values()];
}

/** 날짜마다 강좌수(학원 전체 · 과목 관리자는 `inRow`로 그 과목 수강만). */
export function courseTrendOf(
  students: readonly TrendStudent[],
  en: TrendEnrollments,
  enrollments: readonly CourseRow[],
  points: readonly { key: string; label: string; date: string }[],
  inRow?: (e: CourseRow) => boolean,
  today?: string,
  subjects: readonly ProgramSubject[] = [],
  /** 영어를 인재원 영어 · EiE 두 강좌로(원장 2026-10-30 — '강좌수' 칸과 같은 판정). */
  splitEnglish = false,
): TrendPoint[] {
  const byStudent = groupRows(enrollments);
  return points.map((p) => {
    let count = 0;
    for (const s of students) if (countedOn(s, en, p.date)) count += new Set(coursesOn(s, byStudent.get(s.id) ?? [], en, p.date, today, inRow).map((e) => courseGroupOf(e.subject, e.englishTrack, subjects, splitEnglish)).filter((key) => key !== null)).size;
    return { ...p, count };
  });
}

/** 날짜마다 강좌수를 과목 묶음으로 가른다 — 과목 미입력 수강은 제외한다 · `inRow` = 과목 관리자(그 과목 반만). */
export function courseBreakdownOf<K extends string>(
  students: readonly TrendStudent[],
  en: TrendEnrollments,
  enrollments: readonly CourseRow[],
  points: readonly { key: string; label: string; date: string }[],
  keys: readonly K[],
  groupOf: (e: CourseRow) => K | null,
  today?: string,
  inRow?: (e: CourseRow) => boolean,
  subjects: readonly ProgramSubject[] = [],
): { total: TrendPoint[]; groups: Record<K, TrendPoint[]> } {
  const byStudent = groupRows(enrollments);
  const total: TrendPoint[] = [];
  const groups = Object.fromEntries(keys.map((k) => [k, [] as TrendPoint[]])) as Record<K, TrendPoint[]>;
  for (const p of points) {
    let all = 0;
    const counts = new Map<K, number>();
    for (const s of students) {
      if (!countedOn(s, en, p.date)) continue;
      const seen = new Set<string>();
      const groupSeats = new Map<K, Set<string>>();
      for (const e of coursesOn(s, byStudent.get(s.id) ?? [], en, p.date, today, inRow)) {
        if (!subjectGroupOf(e.subject, subjects)) continue;
        // 강좌 한 칸 = 선 열쇠(영어를 가른 선이면 인재원 영어 · EiE가 따로 — 원장 2026-10-30 '강좌수' 칸과 같은 판정).
        const g = groupOf(e);
        const subject = g ?? subjectGroupOf(e.subject, subjects)!;
        seen.add(subject);
        if (g) {
          const seats = groupSeats.get(g) ?? new Set<string>();
          seats.add(subject);
          groupSeats.set(g, seats);
        }
      }
      all += seen.size;
      for (const [g, seats] of groupSeats) counts.set(g, (counts.get(g) ?? 0) + seats.size);
    }
    total.push({ ...p, count: all });
    for (const k of keys) groups[k].push({ ...p, count: counts.get(k) ?? 0 });
  }
  return { total, groups };
}

function groupRows(enrollments: readonly CourseRow[]): Map<string, CourseRow[]> {
  const out = new Map<string, CourseRow[]>();
  for (const e of enrollments) {
    const list = out.get(e.studentId);
    if (list) list.push(e);
    else out.set(e.studentId, [e]);
  }
  return out;
}
