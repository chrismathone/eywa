import { addDays } from "@/lib/date-kst";
import { enrollmentLastDate } from "@/features/enrollments/eligibility";

export type TimelineEnrollment = {
  id: string;
  classId: string;
  className: string;
  subject: string | null;
  startDate: string;
  endDate: string | null;
  isTransferred: boolean;
  reason: string | null;
};

export type EnrollmentTimelineEvent = {
  sourceIds: string[];
  date: string;
  kind: "enrollment_start" | "enrollment_end" | "enrollment_transfer";
  title: string;
  description?: string | null;
};

/** 한 학생의 수강 이력. 종료·시작 양쪽에서 유일한 짝만 반이동으로 묶는다. */
export function enrollmentTimeline(enrollments: readonly TimelineEnrollment[]): EnrollmentTimelineEvent[] {
  const starts = new Map<string, TimelineEnrollment[]>();
  for (const e of enrollments) {
    if (!e.subject) continue;
    const key = `${e.subject}|${e.startDate}`;
    const list = starts.get(key) ?? [];
    list.push(e);
    starts.set(key, list);
  }

  const candidates = new Map<string, TimelineEnrollment[]>();
  const sourceCounts = new Map<string, number>();
  for (const from of enrollments) {
    if (!from.endDate || !from.subject) continue;
    // 일반 종료는 마지막 수강일(포함), 명시적 전출은 새 반 시작일(미포함)이다.
    const start = from.isTransferred ? from.endDate : addDays(from.endDate, 1);
    const matches = (starts.get(`${from.subject}|${start}`) ?? []).filter(
      (to) => to.id !== from.id && to.classId !== from.classId && to.startDate > from.startDate,
    );
    candidates.set(from.id, matches);
    for (const to of matches) sourceCounts.set(to.id, (sourceCounts.get(to.id) ?? 0) + 1);
  }

  const transfers = new Map<string, TimelineEnrollment>();
  const transferredStarts = new Set<string>();
  for (const [fromId, matches] of candidates) {
    if (matches.length !== 1 || sourceCounts.get(matches[0].id) !== 1) continue;
    transfers.set(fromId, matches[0]);
    transferredStarts.add(matches[0].id);
  }

  const events: EnrollmentTimelineEvent[] = [];
  for (const e of enrollments) {
    if (!transferredStarts.has(e.id)) {
      events.push({ sourceIds: [e.id], date: e.startDate, kind: "enrollment_start", title: `${e.className} 수강 시작` });
    }
    const to = transfers.get(e.id);
    if (to) {
      events.push({
        sourceIds: [e.id, to.id],
        date: to.startDate,
        kind: "enrollment_transfer",
        title: `${e.className} → ${to.className}`,
        description: e.reason,
      });
    } else if (e.endDate) {
      events.push({ sourceIds: [e.id], date: enrollmentLastDate(e.endDate, e.isTransferred)!, kind: "enrollment_end", title: `${e.className} 수강 종료`, description: e.reason });
    }
  }
  return events.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}
